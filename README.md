Excellente nouvelle — le cycle complet fonctionne enfin de bout en bout ! Voici le README intégral, prêt à copier-coller en entier sur GitHub :```markdown
# ChampChain — Trustless World Cup Prediction Markets

**Track:** Prediction Markets and Settlement — TxODDS World Cup Hackathon
**Program ID (Devnet):** `7QvFHwKAQQaMsERG6pYLVaeMzac79R18arTpzEc6J7u3`
**Explorer:** https://explorer.solana.com/address/7QvFHwKAQQaMsERG6pYLVaeMzac79R18arTpzEc6J7u3?cluster=devnet

## What it does

ChampChain lets anyone open binary prediction markets on World Cup matches
(e.g. "Will Argentina score > 1.5 goals?") and settle them **without any
trusted operator**. Settlement is triggered by submitting a TxLINE Merkle
proof on-chain, verified via a direct CPI into TxLINE's `validate_stat`
instruction. Anyone — user or keeper bot — can trigger settlement. The
vault unlocks only after on-chain verification passes.

Markets aren't a fixed list baked into the code — the frontend discovers
every market that exists on the deployed program directly from the chain
(`program.account.market.all()`), live, every 20 seconds. Create a market
from Solana Playground and it appears on the site automatically, no
redeploy, no code change. That's also why this README never names a
specific market as "the live one": markets get created, bet on, settled,
and eventually closed throughout the tournament — the program is what's
permanent, not any single instance of it. Check the Explorer link above
for the deployed program itself, or connect a wallet on the live site to
see whatever markets currently exist.

Two repair instructions exist for correcting a market's on-chain
parameters after creation, narrowly scoped so they can never be used to
change a market's meaning after people have bet on it:

- `set_fixture_id` — fills in a real TxLINE fixture ID once known, only
  while it's still the zero placeholder.
- `set_earliest_settle_ts` — corrects a settlement window that was set
  too early relative to TxLINE's real data, only downward, never later.

## Architecture

```
User (Phantom wallet, devnet)
  │
  ├─ place_bet()  ──────────────►  PDA Vault (per-market escrow)
  │
  └─ settle_market() ──► CPI ──►  TxLINE validate_stat
                                        │
                                   Merkle proof verified
                                   against on-chain root
                                        │
                                   market.outcome = Yes | No
                                        │
  └─ claim_winnings() ◄──────────  Vault releases SOL to winners
```

## TxLINE Integration

| Element          | Value                                          |
| ---------------- | ---------------------------------------------- |
| Program (devnet) | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |
| Instruction      | `validate_stat`                                |
| Discriminator    | `[107, 197, 232, 90, 191, 136, 105, 185]`      |
| Compute budget   | 1,400,000 CU (via `ComputeBudgetProgram`)      |
| Roots PDA seeds  | `["daily_scores_roots", epoch_day_le_u16]`     |
| Return value     | `bool` — `true` = predicate satisfied          |

The discriminator and PDA seeds were verified on-chain against the live
TxLINE devnet IDL before writing the CPI (see `TXLINE_INTEGRATION_VERIFICATION.md`).

## TxLINE Access Activation (real, not simulated)

Every TxLINE HTTP endpoint (`/api/scores/*`) requires `Authorization: Bearer <jwt>` + `X-Api-Token: <apiToken>`. The frontend gets
both through the exact flow documented at `https://txline.txodds.com/documentation/worldcup`, wired end-to-end:

1. Connect a devnet wallet, click **"Validate live data"** in the header.
2. `subscribeOnChain()` sends a real `subscribe(service_level_id=1, weeks=4)` transaction to the TxLINE program, built from the actual fetched devnet
   IDL (`frontend/src/idl/txoracle.json`) — not a hand-encoded instruction.
3. `guestAuthStart()` calls `POST /auth/guest/start` for a guest JWT.
4. The wallet signs `${txSig}:${leagues}:${jwt}` via `wallet.signMessage()`.
5. `activateApiToken()` calls `POST /api/token/activate` and the resulting
   API token is cached in `localStorage` for the 4-week subscription window.

Once activated, `ProofFeed.jsx` switches from a clearly-labeled
"SIMULATED — ACTIVATE TXLINE" feed to the real authenticated `GET /api/scores/stream` (via `fetch` + `ReadableStream`, since `EventSource` cannot send custom headers), and `attemptSettlement()` can call `GET /api/scores/stat-validation` with the required headers. See `frontend/src/lib/txlineAuth.js`, `txlineStream.js`, `txlineConfig.js`, and `frontend/src/hooks/useTxlineAuth.js`.

## Security highlights

Sixteen-plus attack vectors are documented in `SECURITY_NOTES.md`. Key points:

- **Predicate locked at creation** — the winning condition is immutable
  after `initialize_market`. A settler cannot forge a result by choosing
  a trivially-true predicate.
- **No trusted oracle** — `settle_market` has no authority check; the
  Merkle proof is the sole trust anchor.
- **PDA substitution prevented** — `settle_market` re-derives the expected
  `daily_scores_roots` PDA and rejects any other account.
- **Check-Effects-Interaction** — `bet.claimed = true` is written before
  the vault transfer in `claim_winnings`, preventing double-claim.
- **Checked arithmetic throughout** — `checked_add`, `checked_mul`, `u128` intermediate for payout calculation.
- **Repair instructions can't be misused** — `set_fixture_id` only writes
  once (blocked once a real fixture ID is set); `set_earliest_settle_ts`
  can only move a settlement window earlier, never later, and never before
  `close_ts` — neither can be used to retroactively change what a market
  is betting on.

## Running the frontend locally

```
cd frontend
npm install
npm run dev
# → http://localhost:5173
# Connect Phantom on devnet to place real bets.
# To activate real TxLINE streaming/settlement (optional — the app runs in
# a clearly-labeled simulation mode without it), the wallet needs devnet SOL
# for the subscribe() transaction fee and, depending on the World Cup free
# tier's on-chain price row, a small amount of the TxLINE devnet token
# (mint 4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG).
```

## Deploying the frontend

```
cd frontend
npm run build
npx vercel --prod
```

## Creating and repairing markets

See `PLAYGROUND_CREATE_MARKETS.md` for the fixture-first market creation
flow, `LIST_MARKETS_WITH_SETTLE_TS.md` / `DIAGNOSE_SETTLEMENT_WINDOWS.md`
for auditing existing markets against real TxLINE data, and
`REPAIR_EARLIEST_SETTLE_TS.md` for fixing a settlement window that was
set too early.

## Submission checklist

- [x] Program deployed on Solana Devnet
- [x] Markets created and settled on-chain via real TxLINE proofs
- [x] Full user cycle verified end-to-end: bet → settle → claim
- [x] Public GitHub repo
- [x] TxLINE as primary data source (validate_stat CPI + SSE stream)
- [x] Security audit — 16+ vectors documented
- [ ] Demo video (5 min max)

## TxLINE endpoints/primitives used

- `validate_stat` (on-chain program instruction, CPI from `settle_market`)
- `subscribe` (on-chain program instruction, free World Cup tier activation)
- `POST /auth/guest/start` (guest JWT)
- `POST /api/token/activate` (signed activation -> API token)
- `GET /api/scores/stream` (authenticated SSE — live match updates for the
  header badge and `ProofFeed`)
- `GET /api/scores/stat-validation` (authenticated REST — Merkle proof fetch
  for settlement)
- PDAs: `daily_scores_roots`, `pricing_matrix`, `token_treasury_v2`

## Team feedback on TxLINE API

The on-chain `validate_stat` design is excellent. The discriminator,
account structure, and Borsh types are consistent between devnet and
mainnet (verified by fetching the live IDL). The Merkle proof structure
maps cleanly to Rust structs. The free World Cup tier's subscribe -> guest
JWT -> signed activation flow is a genuinely nice no-payment onboarding path.

Main friction points: (1) the `subscribe()` TypeScript snippet in the World
Cup guide doesn't show argument widths, (2) nothing on the streaming
page warns that plain `EventSource` silently can't carry the required auth
headers, and (3) there's no documented way to discover the latest available
`seq` for a fixture's `stat-validation` endpoint — both (1) and (2) were only
resolved by pulling the actual devnet IDL from `/documentation/programs/devnet`
and reading the raw SSE bytes by hand; (3) required a doubling-then-binary-search
probe against the endpoint itself.
