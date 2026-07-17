use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::{get_return_data, invoke};
use anchor_lang::system_program;

declare_id!("7QvFHwKAQQaMsERG6pYLVaeMzac79R18arTpzEc6J7u3"); // deployed on Solana devnet via Solana Playground

pub const MAX_MATCH_ID_LEN: usize = 32;
pub const MAX_PROOF_NODES: usize = 32;

/// TxLINE on-chain program address for devnet. Replace with the production
/// address before any mainnet deployment: 9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA
pub const TXLINE_PROGRAM_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

/// Anchor discriminator for TxLINE's validate_stat instruction.
pub const VALIDATE_STAT_DISCRIMINATOR: [u8; 8] = [107, 197, 232, 90, 191, 136, 105, 185];

/// Period after `earliest_settle_ts` during which only permissionless
/// settlement can move a market out of Pending. Authority cancellation is
/// blocked during this window to prevent post-result cancellation griefing.
pub const CANCEL_GRACE_PERIOD_SECS: i64 = 24 * 60 * 60; // 24h

/// A fixed, protocol-wide floor (from `close_ts`) that a TxLINE proof's own
/// timestamp must clear to count as "fresh enough to settle on" — used
/// instead of each market's own `earliest_settle_ts` guess for this
/// specific check. `earliest_settle_ts` is a per-market estimate set once
/// at market creation (e.g. "expect extra time, add 2h15") and can turn out
/// to be a worse guess than reality (a match that finishes in regulation
/// with no extra time, say). Since a finished match's TxLINE data timestamp
/// is fixed forever once play ends, gating proof freshness on a guess that
/// landed too late made settlement permanently unreachable for anyone
/// except the market's authority (only they can lower earliest_settle_ts
/// via `set_earliest_settle_ts`) — defeating the "anyone can settle"
/// design. 80 minutes covers real halftime + regulation time with room to
/// spare (kickoff to full-time whistle, even with no stoppage at all, is
/// realistically well over 90 minutes once a 15+ minute halftime is
/// included) while staying safely short of every real match's actual
/// finish — so this floor is essentially never the reason a genuinely
/// finished match's real proof gets rejected as stale, for any caller.
pub const PROOF_FRESHNESS_FLOOR_SECS: i64 = 80 * 60; // 80 minutes

#[program]
pub mod prediction_market {
    use super::*;

    /// Creates a prediction market and permanently freezes the market predicate.
    /// Neither the authority nor a later settler can change the condition.
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        match_id: String,
        fixture_id: i64,
        stat_a_key: u32,
        stat_b_key: Option<u32>,
        period: i32,
        predicate: TraderPredicate,
        op: Option<BinaryExpression>,
        close_ts: i64,
        earliest_settle_ts: i64,
    ) -> Result<()> {
        require!(
            match_id.len() <= MAX_MATCH_ID_LEN,
            MarketError::MatchIdTooLong
        );
        require!(
            close_ts > Clock::get()?.unix_timestamp,
            MarketError::InvalidCloseTime
        );
        require!(
            stat_b_key.is_some() == op.is_some(),
            MarketError::InvalidStatCombination
        );
        // earliest_settle_ts must be a conservative estimate of when the match
        // result can be final. It is strictly after close_ts and helps prevent
        // live-score proofs from settling a market before the final result.
        require!(
            earliest_settle_ts > close_ts,
            MarketError::InvalidSettleTime
        );

        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.match_id = match_id;
        market.fixture_id = fixture_id;
        market.stat_a_key = stat_a_key;
        market.stat_b_key = stat_b_key;
        market.period = period;
        market.predicate = predicate;
        market.op = op;
        market.close_ts = close_ts;
        market.earliest_settle_ts = earliest_settle_ts;
        market.outcome = Outcome::Pending;
        market.total_yes = 0;
        market.total_no = 0;
        market.bump = ctx.bumps.market;
        market.vault_bump = ctx.bumps.vault;

        Ok(())
    }

    /// Places a bet. side = true means Yes, side = false means No.
    pub fn place_bet(ctx: Context<PlaceBet>, side: bool, amount: u64) -> Result<()> {
        let market = &mut ctx.accounts.market;

        require!(amount > 0, MarketError::ZeroAmount);
        require!(
            Clock::get()?.unix_timestamp < market.close_ts,
            MarketError::BettingClosed
        );
        require!(
            market.outcome == Outcome::Pending,
            MarketError::AlreadySettled
        );

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let bet = &mut ctx.accounts.bet;
        if bet.amount == 0 {
            bet.market = market.key();
            bet.user = ctx.accounts.user.key();
            bet.side = side;
        } else {
            require!(bet.side == side, MarketError::CannotChangeSide);
        }
        bet.amount = bet
            .amount
            .checked_add(amount)
            .ok_or(MarketError::Overflow)?;
        bet.claimed = false;

        if side {
            market.total_yes = market
                .total_yes
                .checked_add(amount)
                .ok_or(MarketError::Overflow)?;
        } else {
            market.total_no = market
                .total_no
                .checked_add(amount)
                .ok_or(MarketError::Overflow)?;
        }

        Ok(())
    }

    /// Settles the market permissionlessly with a valid TxLINE Merkle proof.
    /// There is no trusted local oracle key; trust comes from TxLINE's on-chain
    /// root and the CPI into validate_stat.
    pub fn settle_market<'info>(
        ctx: Context<'_, '_, '_, 'info, SettleMarket<'info>>,
        ts: i64,
        fixture_summary: ScoresBatchSummary,
        fixture_proof: Vec<ProofNode>,
        main_tree_proof: Vec<ProofNode>,
        stat_a: StatTerm,
        stat_b: Option<StatTerm>,
    ) -> Result<()> {
        let market = &ctx.accounts.market;
        require!(
            market.outcome == Outcome::Pending,
            MarketError::AlreadySettled
        );
        // Do not settle before the conservative finality window, even if a
        // technically valid live-score proof already exists. This gate is
        // purely wall-clock (Clock::get() always eventually exceeds any
        // earliest_settle_ts, however it was set) — it only ever delays
        // when settlement can first be attempted, it can never permanently
        // block it, so it's safe to keep tied to the market's own value.
        require!(
            Clock::get()?.unix_timestamp >= market.earliest_settle_ts,
            MarketError::TooEarlyToSettle
        );
        // Proof freshness, in contrast, is compared against a fixed
        // protocol floor (close_ts + PROOF_FRESHNESS_FLOOR_SECS) rather
        // than market.earliest_settle_ts — see PROOF_FRESHNESS_FLOOR_SECS'
        // doc comment for why: a per-market guess can land after a real,
        // already-finished match's fixed TxLINE timestamp, which would
        // otherwise make this check permanently unsatisfiable for anyone
        // but the authority.
        let proof_freshness_floor = market
            .close_ts
            .checked_add(PROOF_FRESHNESS_FLOOR_SECS)
            .ok_or(MarketError::Overflow)?;
        require_fresh_txline_batch(ts, &fixture_summary, proof_freshness_floor)?;
        require_bounded_proof(&fixture_proof)?;
        require_bounded_proof(&main_tree_proof)?;
        require_bounded_proof(&stat_a.stat_proof)?;

        require!(
            fixture_summary.fixture_id == market.fixture_id,
            MarketError::FixtureMismatch
        );
        require!(
            stat_a.stat_to_prove.key == market.stat_a_key,
            MarketError::StatKeyMismatch
        );
        require!(
            stat_a.stat_to_prove.period == market.period,
            MarketError::PeriodMismatch
        );
        match (&stat_b, market.stat_b_key) {
            (Some(sb), Some(expected_key)) => {
                require!(
                    sb.stat_to_prove.key == expected_key,
                    MarketError::StatKeyMismatch
                );
                require!(
                    sb.stat_to_prove.period == market.period,
                    MarketError::PeriodMismatch
                );
                require_bounded_proof(&sb.stat_proof)?;
            }
            (None, None) => {}
            _ => return err!(MarketError::InvalidStatCombination),
        }

        require!(ts > 0, MarketError::InvalidTime);
        let epoch_day: u16 = (ts / 86_400_000)
            .try_into()
            .map_err(|_| MarketError::InvalidTime)?;
        let (expected_roots_pda, _) = Pubkey::find_program_address(
            &[b"daily_scores_roots", &epoch_day.to_le_bytes()],
            &TXLINE_PROGRAM_ID,
        );
        require!(
            ctx.accounts.daily_scores_merkle_roots.key() == expected_roots_pda,
            MarketError::InvalidPda
        );
        require!(
            ctx.accounts.txline_program.key() == TXLINE_PROGRAM_ID,
            MarketError::InvalidProgramId
        );

        let args = ValidateStatArgs {
            ts,
            fixture_summary,
            fixture_proof,
            main_tree_proof,
            predicate: market.predicate.clone(),
            stat_a,
            stat_b,
            op: market.op.clone(),
        };

        let mut data = VALIDATE_STAT_DISCRIMINATOR.to_vec();
        data.extend(
            args.try_to_vec()
                .map_err(|_| MarketError::SerializationFailed)?,
        );

        let ix = Instruction {
            program_id: TXLINE_PROGRAM_ID,
            accounts: vec![AccountMeta::new_readonly(
                ctx.accounts.daily_scores_merkle_roots.key(),
                false,
            )],
            data,
        };

        invoke(
            &ix,
            &[
                ctx.accounts.daily_scores_merkle_roots.to_account_info(),
                ctx.accounts.txline_program.to_account_info(),
            ],
        ).map_err(|_| MarketError::CpiValidationFailed)?;

        let (returned_program_id, return_data) =
            get_return_data().ok_or(MarketError::MissingReturnData)?;
        require!(
            returned_program_id == TXLINE_PROGRAM_ID,
            MarketError::InvalidProgramId
        );
        let predicate_result =
            bool::try_from_slice(&return_data).map_err(|_| MarketError::SerializationFailed)?;

        let market = &mut ctx.accounts.market;
        market.outcome = if predicate_result {
            Outcome::Yes
        } else {
            Outcome::No
        };

        Ok(())
    }

    /// Cancels the market before settlement, with an anti-grief timing window.
    pub fn cancel_market(ctx: Context<CancelMarket>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(
            market.outcome == Outcome::Pending,
            MarketError::AlreadySettled
        );

        // Anti-grief rule: cancellation is free before close_ts, but after
        // betting closes the authority must wait until the permissionless
        // settlement grace period has elapsed.
        let now = Clock::get()?.unix_timestamp;
        let cancel_reopens_at = market
            .earliest_settle_ts
            .checked_add(CANCEL_GRACE_PERIOD_SECS)
            .ok_or(MarketError::Overflow)?;
        require!(
            now < market.close_ts || now >= cancel_reopens_at,
            MarketError::CancelWindowNotOpen
        );

        market.outcome = Outcome::Cancelled;
        Ok(())
    }

    /// Repairs a market that was created with fixture_id = 0 (a TODO
    /// placeholder that never got filled in) by setting the real TxLINE
    /// fixtureId after the fact — instead of cancelling and recreating the
    /// whole market from scratch.
    ///
    /// Deliberately narrow: only the original authority can call it, only
    /// while the market is still Pending (never after a real settlement),
    /// and only once — a market that already has a non-zero fixture_id can
    /// never be repointed at a different match after the fact. That last
    /// rule matters as much as the first two: it's what stops this
    /// instruction from becoming a backdoor to quietly swap a market's
    /// real-world meaning after people have already bet on it.
    pub fn set_fixture_id(ctx: Context<SetFixtureId>, fixture_id: i64) -> Result<()> {
        require!(fixture_id != 0, MarketError::InvalidFixtureId);
        let market = &mut ctx.accounts.market;
        require!(
            market.outcome == Outcome::Pending,
            MarketError::AlreadySettled
        );
        require!(market.fixture_id == 0, MarketError::FixtureIdAlreadySet);
        market.fixture_id = fixture_id;
        Ok(())
    }

    /// Repairs a market whose `earliest_settle_ts` was set to a guess at
    /// creation time (e.g. "close_ts + 2h15") that turned out to land
    /// *after* the real match actually finished — meaning TxLINE will
    /// never publish a proof recent enough, and the market can never be
    /// settled as-is. Deliberately narrow, same philosophy as
    /// `set_fixture_id`: only the authority, only while still Pending, and
    /// only ever DOWNWARD (never later than what was already set) — a
    /// market's settlement window can be corrected to match reality, but
    /// never pushed further out to stall winners from claiming. The floor
    /// is `close_ts`: it can never be moved so early that settlement
    /// becomes possible before betting even closed.
    pub fn set_earliest_settle_ts(
        ctx: Context<SetEarliestSettleTs>,
        new_earliest_settle_ts: i64,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(
            market.outcome == Outcome::Pending,
            MarketError::AlreadySettled
        );
        require!(
            new_earliest_settle_ts > market.close_ts,
            MarketError::InvalidSettleTime
        );
        require!(
            new_earliest_settle_ts < market.earliest_settle_ts,
            MarketError::EarliestSettleTsCanOnlyDecrease
        );
        market.earliest_settle_ts = new_earliest_settle_ts;
        Ok(())
    }

    /// Closes a market account and reclaims its rent-exempt SOL to the
    /// authority. Deliberately restrictive: only allowed once the market
    /// has left `Pending` (i.e. cancelled or settled) AND its vault is
    /// fully drained — meaning every bettor has already called
    /// `claim_winnings` (or would have nothing to claim). This ordering
    /// guarantees closing an account can never strand funds behind a
    /// market that no longer exists to reference.
    pub fn close_market(ctx: Context<CloseMarket>) -> Result<()> {
        require!(
            ctx.accounts.market.outcome != Outcome::Pending,
            MarketError::CannotCloseWhilePending
        );
        require!(
            ctx.accounts.vault.lamports() == 0,
            MarketError::VaultNotEmpty
        );
        Ok(())
    }

    /// Claims winnings, or refunds the original stake if the market was cancelled.
    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let market = &ctx.accounts.market;
        let bet = &mut ctx.accounts.bet;

        require!(!bet.claimed, MarketError::AlreadyClaimed);
        require!(bet.amount > 0, MarketError::NothingToClaim);
        require!(
            market.outcome != Outcome::Pending,
            MarketError::NotSettledYet
        );

        let payout: u64 = match market.outcome {
            Outcome::Cancelled => bet.amount,
            Outcome::Yes => {
                require!(bet.side, MarketError::LosingBet);
                compute_payout(bet.amount, market.total_yes, market.total_no)?
            }
            Outcome::No => {
                require!(!bet.side, MarketError::LosingBet);
                compute_payout(bet.amount, market.total_no, market.total_yes)?
            }
            Outcome::Pending => unreachable!(),
        };

        bet.claimed = true;

        let market_key = market.key();
        let vault_seeds: &[&[u8]] = &[b"vault", market_key.as_ref(), &[market.vault_bump]];

        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user.to_account_info(),
                },
                &[vault_seeds],
            ),
            payout,
        )?;

        Ok(())
    }
}

fn compute_payout(stake: u64, winning_pool: u64, losing_pool: u64) -> Result<u64> {
    if winning_pool == 0 {
        return Ok(stake);
    }
    let total_pool = winning_pool
        .checked_add(losing_pool)
        .ok_or(MarketError::Overflow)?;
    let payout = (stake as u128)
        .checked_mul(total_pool as u128)
        .ok_or(MarketError::Overflow)?
        .checked_div(winning_pool as u128)
        .ok_or(MarketError::Overflow)?;
    Ok(payout as u64)
}

fn require_fresh_txline_batch(
    ts: i64,
    fixture_summary: &ScoresBatchSummary,
    earliest_settle_ts: i64,
) -> Result<()> {
    require!(ts > 0, MarketError::InvalidTime);
    let earliest_settle_ms = earliest_settle_ts
        .checked_mul(1_000)
        .ok_or(MarketError::Overflow)?;

    // TxLINE timestamps are millisecond-based. A wall-clock gate alone is not
    // enough: otherwise a stale live-match proof could be submitted after
    // earliest_settle_ts and settle the market on an intermediate score.
    require!(ts >= earliest_settle_ms, MarketError::StaleProof);
    require!(
        fixture_summary.update_stats.max_timestamp >= earliest_settle_ms,
        MarketError::StaleProof
    );
    require!(
        fixture_summary.update_stats.max_timestamp >= fixture_summary.update_stats.min_timestamp,
        MarketError::InvalidTime
    );

    Ok(())
}

fn require_bounded_proof(proof: &[ProofNode]) -> Result<()> {
    require!(proof.len() <= MAX_PROOF_NODES, MarketError::ProofTooLarge);
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StatTerm {
    pub stat_to_prove: ScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum BinaryExpression {
    Add,
    Subtract,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ValidateStatArgs {
    pub ts: i64,
    pub fixture_summary: ScoresBatchSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub predicate: TraderPredicate,
    pub stat_a: StatTerm,
    pub stat_b: Option<StatTerm>,
    pub op: Option<BinaryExpression>,
}

#[account]
pub struct Market {
    pub authority: Pubkey,
    pub match_id: String,
    pub fixture_id: i64,
    pub stat_a_key: u32,
    pub stat_b_key: Option<u32>,
    pub period: i32,
    pub predicate: TraderPredicate,
    pub op: Option<BinaryExpression>,
    pub close_ts: i64,
    pub earliest_settle_ts: i64,
    pub outcome: Outcome,
    pub total_yes: u64,
    pub total_no: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Market {
    pub const MAX_SIZE: usize = 32
        + (4 + MAX_MATCH_ID_LEN)
        + 8
        + 4
        + (1 + 4)
        + 4
        + (4 + 1)
        + (1 + 1)
        + 8
        + 8 // earliest_settle_ts
        + 1
        + 8
        + 8
        + 1
        + 1;
}

#[account]
pub struct Bet {
    pub market: Pubkey,
    pub user: Pubkey,
    pub side: bool,
    pub amount: u64,
    pub claimed: bool,
}

impl Bet {
    pub const MAX_SIZE: usize = 32 + 32 + 1 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Pending,
    Yes,
    No,
    Cancelled,
}

#[derive(Accounts)]
#[instruction(match_id: String)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Market::MAX_SIZE,
        seeds = [b"market", match_id.as_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(seeds = [b"vault", market.key().as_ref()], bump)]
    /// CHECK: PDA vault validated by seeds/bump; no data is stored.
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = market.vault_bump)]
    /// CHECK: PDA vault validated by seeds/bump.
    pub vault: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Bet::MAX_SIZE,
        seeds = [b"bet", market.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleMarket<'info> {
    #[account(mut)]
    pub settler: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: manually verified against the expected TxLINE PDA.
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,
    /// CHECK: must equal TXLINE_PROGRAM_ID, verified in the instruction.
    pub txline_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelMarket<'info> {
    #[account(constraint = authority.key() == market.authority @ MarketError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct SetFixtureId<'info> {
    #[account(constraint = authority.key() == market.authority @ MarketError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct SetEarliestSettleTs<'info> {
    #[account(constraint = authority.key() == market.authority @ MarketError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct CloseMarket<'info> {
    #[account(mut, constraint = authority.key() == market.authority @ MarketError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        close = authority,
        seeds = [b"market", market.match_id.as_bytes()],
        bump = market.bump
    )]
    pub market: Account<'info, Market>,
    #[account(seeds = [b"vault", market.key().as_ref()], bump = market.vault_bump)]
    /// CHECK: PDA vault validated by seeds/bump; balance checked in the handler.
    pub vault: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = market.vault_bump)]
    /// CHECK: PDA vault validated by seeds/bump.
    pub vault: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"bet", market.key().as_ref(), user.key().as_ref()],
        bump,
        constraint = bet.user == user.key() @ MarketError::Unauthorized
    )]
    pub bet: Account<'info, Bet>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum MarketError {
    #[msg("Match identifier is too long")]
    MatchIdTooLong,
    #[msg("close_ts must be in the future")]
    InvalidCloseTime,
    #[msg("earliest_settle_ts must be strictly after close_ts")]
    InvalidSettleTime,
    #[msg("Too early to settle: earliest_settle_ts has not been reached")]
    TooEarlyToSettle,
    #[msg("TxLINE proof is too stale to settle this market")]
    StaleProof,
    #[msg("Merkle proof is too large")]
    ProofTooLarge,
    #[msg("Cancellation is blocked during the permissionless settlement window")]
    CancelWindowNotOpen,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Betting is closed for this market")]
    BettingClosed,
    #[msg("Market is already resolved")]
    AlreadySettled,
    #[msg("Cannot change side on an existing bet")]
    CannotChangeSide,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Winnings already claimed")]
    AlreadyClaimed,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Market is not resolved yet")]
    NotSettledYet,
    #[msg("This bet did not win")]
    LosingBet,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Proof does not match this market fixture")]
    FixtureMismatch,
    #[msg("Stat key does not match this market")]
    StatKeyMismatch,
    #[msg("Stat period does not match this market")]
    PeriodMismatch,
    #[msg("Invalid stat combination")]
    InvalidStatCombination,
    #[msg("Invalid timestamp")]
    InvalidTime,
    #[msg("Merkle roots account does not match the expected PDA")]
    InvalidPda,
    #[msg("Invalid program id")]
    InvalidProgramId,
    #[msg("Serialization failed")]
    SerializationFailed,
    #[msg("TxLINE CPI validation failed")]
    CpiValidationFailed,
    #[msg("No return data received from TxLINE")]
    MissingReturnData,
    #[msg("Cannot close a market that is still Pending — cancel or settle it first")]
    CannotCloseWhilePending,
    #[msg("Cannot close: vault still holds funds owed to bettors")]
    VaultNotEmpty,
    #[msg("fixture_id is already set and cannot be changed again")]
    FixtureIdAlreadySet,
    #[msg("fixture_id must be non-zero")]
    InvalidFixtureId,
    #[msg("earliest_settle_ts can only be moved earlier, never later")]
    EarliestSettleTsCanOnlyDecrease,
}