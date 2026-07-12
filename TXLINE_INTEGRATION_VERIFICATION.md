# TxLINE Integration Verification

This file records the source-backed checks behind ChampChain's TxLINE
settlement path. It exists to avoid the most dangerous hackathon failure mode:
claiming an integration that cannot be traced back to the sponsor's real docs.

## Official Sources Checked

- Documentation index:
  `https://txline-docs.txodds.com/llms.txt`
- On-chain validation guide:
  `https://txline-docs.txodds.com/documentation/examples/onchain-validation`
- World Cup free tier guide:
  `https://txline.txodds.com/documentation/worldcup`
- OpenAPI source:
  `https://txline.txodds.com/docs/docs.yaml`

## Confirmed On-Chain Validation Primitive

The official on-chain validation guide documents:

- generated Anchor program type: `Txoracle`;
- validation method: `program.methods.validateStat(...)`;
- account: `dailyScoresMerkleRoots`;
- PDA seed: `daily_scores_roots`;
- API proof endpoint: `GET /api/scores/stat-validation`;
- proof objects: `fixtureSummary`, `fixtureProof`, `mainTreeProof`,
  `statToProve`, `eventStatRoot`, `statProof`;
- optional second stat and operator for two-stat validation;
- required pre-instruction:
  `ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })`;
- devnet/mainnet IDL/type pages exposed from the documentation index.

This supports ChampChain's current architecture: the program can CPI into
TxLINE's `validate_stat` instruction using Anchor-compatible Borsh arguments,
then use the returned boolean to resolve the market.

## Confirmed Network And API Flow

The World Cup free tier guide documents:

- mainnet API origin: `https://txline.txodds.com`;
- devnet API origin: `https://txline-dev.txodds.com`;
- mainnet program ID: `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`;
- devnet program ID: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`;
- `POST /auth/guest/start`;
- on-chain `subscribe(service_level_id, weeks)`;
- `POST /api/token/activate`;
- `Authorization: Bearer <jwt>` plus `X-Api-Token: <apiToken>`;
- `pricing_matrix` and `token_treasury_v2` PDA derivation for subscription.

## Devnet IDL Fetched And Verified (closes the item below)

The full devnet IDL was retrieved from
`https://txline.txodds.com/documentation/programs/devnet` and committed
verbatim to `frontend/src/idl/txoracle.json` (program `txoracle`, version
`1.5.2`, address `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`). Cross-checks
performed:

- `validate_stat` discriminator in the fetched IDL is
  `[107,197,232,90,191,136,105,185]`, matching both the value independently
  computed as `sha256("global:validate_stat")[0:8]` and the constant already
  hardcoded in `programs/prediction_market/src/lib.rs`
  (`VALIDATE_STAT_DISCRIMINATOR`). Confirmed byte-for-byte.
- `subscribe` discriminator in the fetched IDL is
  `[254,28,191,138,156,179,183,53]`, matching
  `sha256("global:subscribe")[0:8]`. Used as-is by
  `frontend/src/lib/txlineAuth.js` via `anchor.Program` (no hand-rolled
  discriminator needed there — the real IDL is loaded directly).
- `subscribe` args are `service_level_id: u16`, `weeks: u8` — confirmed
  against the fetched IDL (this was previously an open question; the World
  Cup guide's TypeScript snippet does not show the argument widths).
- On-chain error `6041 InvalidWeeks: "Weeks must be a multiple of 4"`
  confirms the guide's "Subscribe for 4 weeks at a time" is a hard
  requirement, not just a suggestion — `TXLINE_SUBSCRIPTION_WEEKS = 4` in
  `frontend/src/lib/txlineConfig.js` is set accordingly.
- Account list/order for `subscribe`: `user`, `pricing_matrix`, `token_mint`,
  `user_token_account`, `token_treasury_vault`, `token_treasury_pda`,
  `token_program`, `system_program`, `associated_token_program` — matches
  `subscribeOnChain()` in `frontend/src/lib/txlineAuth.js` exactly.

## Real Auth + Streaming Wiring (frontend)

Closing the gap flagged in `BOUNTY_GAP_ANALYSIS.md` item 3/4: every TxLINE
HTTP call in the frontend now carries `Authorization: Bearer <jwt>` and
`X-Api-Token: <apiToken>`, sourced from a real activation flow instead of
being called unauthenticated (which would 401 against the live API):

- `frontend/src/lib/txlineAuth.js` — `runTxlineActivation()` performs the
  full documented flow: on-chain `subscribe()`, `POST /auth/guest/start`,
  `wallet.signMessage()` over `${txSig}:${leagues.join(",")}:${jwt}`, then
  `POST /api/token/activate`. Successful grants are persisted in
  `localStorage` (keyed by wallet + network) so the app doesn't re-subscribe
  every reload within the 4-week subscription window.
- `frontend/src/lib/txlineStream.js` — authenticated SSE client, ported
  line-for-line from the Streaming Data guide's `parseSseBlock` /
  `readSseMessages` / `parseSseData` helpers (plain `EventSource` cannot set
  the required headers, hence `fetch` + manual `ReadableStream` parsing).
- `frontend/src/hooks/useTxlineAuth.js` — React hook wiring the above to the
  connected wallet-adapter wallet, exposed as an "Activate TxLINE access"
  control in `App.jsx`'s header.
- `frontend/src/App.jsx`'s `attemptSettlement()` now calls
  `GET /api/scores/stat-validation` with the real auth headers and refuses
  to run before activation, instead of silently hitting a 401.
- `frontend/src/components/ProofFeed.jsx` uses the authenticated stream when
  credentials are present, and falls back to a feed that is explicitly
  labeled "SIMULATED — ACTIVATE TXLINE" (never silently pretends to be live).

## Cross-Checked Against github.com/txodds/tx-on-chain And txline-docs Quickstart

Two more official sources were checked line-by-line against our code:

1. `https://txline-docs.txodds.com/documentation/quickstart` — this is the
   canonical, most current TxLINE docs site (same domain family as the World
   Cup guide) and it hands over a **complete, runnable TypeScript reference**
   for network config, purchase, subscribe, and activation. Diffed against
   `frontend/src/lib/txlineConfig.js` / `txlineAuth.js`:
   - `apiOrigin` devnet `https://txline-dev.txodds.com`, mint
     `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` — **matches exactly**,
     no change needed.
   - `subscribe(1, 4)` account list, PDA seeds, and the
     `${txSig}:${leagues}:${jwt}` signing message — **matches exactly**.
   - The doc's own activation snippet feature-detects `wallet.signMessage`
     and falls back to a local Anchor keypair (`nacl.sign.detached`) only
     when there is no browser wallet — confirms `wallet.signMessage()` is
     the correct browser-wallet path we already use; the local-keypair
     fallback doesn't apply to this project (browser-only dApp).
   - Confirmed **the free World Cup tiers (service levels 1 and 12) require
     no TxL purchase at all** — the "Purchase TxL" section is explicitly
     optional and only applies to paid tiers. Nothing to add here for
     ChampChain, which uses service level 1.

2. `https://github.com/txodds/tx-on-chain` — the sponsor's dedicated
   examples repo. It documents a **parallel/older API host naming**
   (`oracle-dev.txodds.com` / `oracle.txodds.com`, devnet mint
   `GYdhNurtx2EgiTPRHVGuFWKHPycdpUqgedVkwEVUWVTC`) for the same on-chain
   program (`6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` — identical
   program ID confirms it's the same underlying system). This repo's
   examples predate the World Cup event (dated around September 2025, and
   cover NCAA football/basketball + a handful of domestic soccer leagues —
   no explicit World Cup track). We deliberately did **not** switch to the
   `oracle-*` hostnames or that older mint, because the current
   `txline-docs.txodds.com` site is more specific to this event, is
   internally self-consistent (it explicitly warns against mixing
   `txline.txodds.com` and `txline-dev.txodds.com`), and is what the World
   Cup hackathon listing itself links to. If the live demo ever gets a 404
   or auth mismatch against `txline-dev.txodds.com`, `oracle-dev.txodds.com`
   is the documented fallback worth trying — see `frontend/src/lib/txlineConfig.js`
   for where to swap it.

No other discrepancy was found. Nothing named "Starkey" appears anywhere in
TxLINE's docs, the tx-on-chain repo, or general Solana wallet-adapter
material — if this refers to a specific wallet or term, it wasn't found by
searching; happy to check again with more context (e.g. a link or exact
spelling).

## Remaining Pre-Submission Check

- Run the real activation flow against `txline-dev.txodds.com` with a funded
  devnet wallet and record the resulting `txSig` / `apiToken` lifecycle in the
  demo video — the code path is real, but it has not been executed against
  the live sponsor backend from this sandboxed environment (no outbound
  network access here beyond documentation fetches).
- Confirm the sponsor's `/auth/guest/start` and `/api/token/activate`
  response bodies match the `{ token }` shape assumed in
  `guestAuthStart()` / `activateApiToken()`; adjust the small
  `body.token ?? body.apiToken ?? body` fallback in `txlineAuth.js` if the
  live response differs.
