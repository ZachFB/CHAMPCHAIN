# ChampChain — Security Audit Notes

This document records every attack vector identified during the design and
implementation of ChampChain's on-chain prediction market. Each entry
explains the risk, the mitigation applied in `lib.rs`, and any known
residual limitation. Documenting residual limitations explicitly is more
credible than pretending every edge-case is fully solved.

---

## #1 — [RESOLVED] Trusted oracle key replaced by permissionless CPI

**Risk:** An earlier design used a designated oracle key to call
`settle_market`. A compromised or malicious key could post any outcome.

**Mitigation:** `settle_market` has no authority check. Settlement is
triggered by any caller who provides a valid TxLINE Merkle proof. Trust
comes from the cryptographic proof itself, not from a key we control.

---

## #2 — Front-running: bet placed after result is known off-chain

**Risk:** A user (or the oracle itself) could place a bet moments before
the market closes, already knowing the likely result from off-chain data.

**Mitigation:** `place_bet` rejects any call where
`Clock::get()?.unix_timestamp >= market.close_ts`. No bet is accepted after
`close_ts`, which must be set before the match ends.

---

## #3 — Double settlement

**Risk:** A bug or replay could settle the market twice, changing the
outcome after winners have already been determined.

**Mitigation:** `settle_market` requires `market.outcome == Outcome::Pending`.
Once settled, no instruction can revert the state back to `Pending`.

---

## #4 — Division by zero / empty winning pool

**Risk:** If nobody bet on the winning side, the standard payout formula
`stake * total_pool / winning_pool` divides by zero.

**Mitigation:** `compute_payout` handles an empty winning pool explicitly
and refunds each bettor's original stake rather than panicking.

---

## #5 — Arithmetic overflow

**Risk:** Large bet amounts could overflow `u64` during addition or
multiplication in the payout calculation.

**Mitigation:** All arithmetic uses `checked_add`, `checked_mul`, and
`checked_div`. The payout is computed in `u128` before being cast back to
`u64` to prevent intermediate overflow.

---

## #6 — Double-claim (replay on claim_winnings)

**Risk:** A winner calls `claim_winnings` twice, draining the vault a
second time.

**Mitigation:** The `Bet` account carries a `claimed: bool` flag. It is
set to `true` **before** the SOL transfer (check-effects-interaction
pattern), so even if the transaction is retried the second call fails with
`AlreadyClaimed`.

---

## #7 — Account substitution (confused deputy)

**Risk:** An attacker passes a fake `market` or `vault` account to
redirect funds.

**Mitigation:** Every sensitive account (`market`, `vault`, `bet`) is a
PDA derived from deterministic seeds verified by Anchor's `seeds = [...]`
constraint. An arbitrary account cannot satisfy the constraint.

---

## #8 — Changing bet side on an existing position

**Risk:** A user tries to flip their YES bet to NO after seeing the market
move, by re-using the same `Bet` PDA.

**Mitigation:** `place_bet` checks `bet.side == side` when the account
already exists and rejects any attempt to change sides with
`CannotChangeSide`.

---

## #9 — Cancelled market (match abandoned / invalid TxLINE data)

**Risk:** Funds could be permanently locked if a match never produces a
valid TxLINE proof.

**Mitigation:** `cancel_market` (authority-only) sets
`outcome = Outcome::Cancelled`. `claim_winnings` on a cancelled market
refunds the original stake in full, no payout calculation involved.

---

## #10 — [RESOLVED] Predicate substitution at settlement time

**Risk:** In an earlier version the caller of `settle_market` supplied the
winning condition (`predicate`) at call time. A malicious settler could
pass a trivially-true predicate (e.g. threshold = -999999) to force a
"YES" result regardless of the real score.

**Mitigation:** `fixture_id`, `stat_a_key`, `stat_b_key`, `period`,
`predicate`, and `op` are stored immutably in the `Market` account at
`initialize_market` time. `settle_market` reads them from the account —
the caller cannot override them. Any proof whose `fixture_id` or stat keys
do not match the stored values is rejected with `FixtureMismatch` /
`StatKeyMismatch`.

---

## #11 — [RESOLVED] Centralized oracle key eliminated

See #1. The whole class of "who controls the oracle key" attacks is
eliminated by making settlement permissionless through on-chain CPI
verification.

---

## #12 — daily_scores_roots PDA substitution

**Risk:** An attacker passes a fake `daily_scores_merkle_roots` account
containing a root that validates any forged proof.

**Mitigation:** `settle_market` re-derives the expected PDA from
`TXLINE_PROGRAM_ID + epoch_day` and enforces strict equality before the
CPI. Passing any other account triggers `InvalidPda`.

---

## #13 — get_return_data program ID spoofing

**Risk:** An intermediate instruction between the CPI and the
`get_return_data` call could overwrite the return buffer with a fake
`true` value.

**Mitigation:** The returned `program_id` from `get_return_data` is
checked against `TXLINE_PROGRAM_ID` before the bool is decoded. Because
`get_return_data` is read immediately after `invoke` with no intervening
instructions, the attack surface is minimal.

---

## #14 — Stale or unavailable daily_scores_roots

**Risk:** If TxLINE has not yet published the Merkle root for the relevant
`epoch_day`, settlement will fail until it does.

**Known limitation (assumed):** Root availability depends entirely on
TxLINE's publishing schedule. Settlement can be retried by anyone, as many
times as needed, until the root is published. This is documented
transparently rather than hidden.

---

## #15 — Caller-supplied `ts` determines epoch_day

**Risk:** A caller could supply a `ts` from a different day than the
actual match, pointing at a root that happens to validate a forged proof.

**Residual risk (low):** The `fixture_id` stored in `Market` bounds the
scope — even with a chosen `ts`, the Merkle proof must still be valid for
that exact fixture under the chosen root. Exploitability in practice is
very low. Documented here as a known trade-off, not an oversight.

---

## #16 — No per-user bet cap

**Risk:** A single large bettor can monopolize 99% of the YES pool just
before close, making the market economically uninteresting for everyone
else and potentially manipulating implied odds.

**Known limitation (assumed):** No `max_bet` is implemented. Adding a
configurable cap at `initialize_market` is the natural fix and is left
as a post-hackathon improvement. Documented here as a deliberate scoping
decision, not an oversight.

---

## #17 — TxLINE grant (JWT + api-token) stored in `localStorage`

**Risk:** `frontend/src/lib/txlineAuth.js` persists the activated TxLINE
grant (`jwt`, `apiToken`, `expiresAt`) in `localStorage`, keyed per
wallet/network. Anyone with script execution in the page's origin (e.g.
an XSS bug introduced elsewhere in the app, or a malicious browser
extension) could read it and impersonate the user's TxLINE session until
`expiresAt`. This does **not** expose funds directly — the grant only
authorizes reading TxLINE's data API, it holds no signing authority over
the wallet or the on-chain program — but it is a real confidentiality
weakness worth naming rather than leaving implicit.

**Mitigation in place:** the grant is scoped to a single wallet+network
key, checked against `expiresAt` on every read (`loadPersistedGrant`),
and never sent anywhere except as `Authorization`/`X-Api-Token` headers
directly to `txlineConfig().apiOrigin` — it is never put in a URL, query
string, or third-party call, so it cannot leak via browser history,
referrer headers, or server access logs.

**Known limitation (assumed):** a stricter design would keep the grant
in memory only (re-activating on every reload) or behind a short-lived
session store; that trade-off was intentionally not made here because
re-signing on every page refresh materially hurts the demo/judging
experience. Left as a post-hackathon improvement, not an oversight.

---

## #18 — `close_market`: rent reclamation gated to prevent fund-stranding

**Risk:** an instruction that closes a `Market` account and returns its
rent to the authority could, if built carelessly, let an authority delete
a market while bettor funds still sit in its vault — those bettors would
then have no account left to reference in `claim_winnings`, permanently
stranding their SOL.

**Mitigation:** `close_market` requires two conditions before the account
constraint (`close = authority`) is allowed to fire: `outcome != Pending`
(the market must already be cancelled or settled — an active market can
never be closed out from under active bettors) AND the vault's lamport
balance must be exactly `0` (every bettor has already been paid out via
`claim_winnings`). Both are `require!` checks that run before Anchor
processes the `close` constraint, so a market with any remaining vault
balance simply fails to close (`VaultNotEmpty`) rather than closing anyway.

**Authority scope:** same signer constraint as `cancel_market` —
`authority.key() == market.authority`. Only the wallet that created a
given market can close it; this does not introduce a new privileged key
that didn't already exist for `cancel_market`.
