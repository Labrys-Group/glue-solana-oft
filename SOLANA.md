# Solana OFT Adapting and Creating

we have deployed our OFT program at here on solana mainnet [7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso](https://solscan.io/account/7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso)

when adding a new token, first we initialise a oft store for this mint address on solana. This can be done with:

```bash
pnpm hardhat lz:oft-adapter:solana:create
  --eid 30168
  --program-id 7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso
  --mint <TOKEN_MINT>
  --token-program <TOKEN_PROGRAM_ID>
```

next, we need to set the configurations for the newly created adapters. You can do this by running:

```bash
pnpm hardhat lz:oft:solana:init-config --oapp-config <PATH_TO_CONFIG>
```

Make `PATH_TO_CONFIG` a file path to the tokens deployment details. E.g. for bonkSOL, use `configs/bonksol-lz.config.ts`.

Once we have initialised the configuration, next we just need to wire the OApp we just deployed on Solana to other networks (GLUE). You can do this by running:

```bash
pnpm hardhat lz:oapp:wire --oapp-config <PATH_TO_CONFIG>
```

Once we have our OApps wired up, we need to generate the lz-config files for them, which is what we insert into the database. To do this, run:

```bash
pnpm hardhat lz:oapp:db-export --oapp-config <PATH_TO_CONFIG>
```

# TODO Tokens

#### bonkSOL

name: `bonkSOL`
symbol: `bonkSOL`
decimals: 9
mint address: `BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs`
token program: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`

#### PENGU

name: `Pudgy Penguins`
symbol: `PENGU`
decimals: 6
mint address: `2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv`
token program: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`

```

```
