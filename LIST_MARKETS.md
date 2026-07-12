# Lister tous les marchés existant sur la blockchain en ce moment

À exécuter dans Solana Playground (onglet Client), lecture seule, ne
modifie rien. À lancer en tout premier, avant toute autre action.

```ts
const all = await pg.program.account.market.all();

console.log(`${all.length} marché(s) trouvé(s) on-chain :\n`);

for (const { publicKey, account } of all) {
  console.log({
    matchId:    account.matchId,
    pda:        publicKey.toBase58(),
    fixtureId:  account.fixtureId.toNumber(),
    outcome:    Object.keys(account.outcome)[0],
    closeTs:    new Date(account.closeTs.toNumber() * 1000).toISOString(),
    totalYes:   account.totalYes.toNumber() / anchor.web3.LAMPORTS_PER_SOL,
    totalNo:    account.totalNo.toNumber() / anchor.web3.LAMPORTS_PER_SOL,
  });
}
```

Copiez tout le résultat affiché et envoyez-le-moi tel quel — je l'examine
avant qu'on décide quoi faire pour chacun (réparer avec `set_fixture_id`,
annuler, ou laisser tel quel).
