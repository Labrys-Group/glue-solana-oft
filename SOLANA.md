# Solana OFT Adapting and Creating

we have deployed our OFT program at here on solana mainnet [7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso](https://solscan.io/account/7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso)

below is some handy task's you'll probably need to use, and underneath that is the whole flow end to end of deploying and wiring up an OFT on GLUE and SOL, and creating a document to insert into the hub database.

### Create OFT Adapter

when adding a new token, first we create an oft store for this mint address on solana. This can be done with:

```bash
pnpm hardhat lz:oft-adapter:solana:create
  --eid 30168
  --program-id 7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso
  --mint <TOKEN_MINT>
  --token-program <TOKEN_PROGRAM_ID>
```

### Intialise the configuration

next, we need to set the configurations for the newly created adapters. You can do this by running:

```bash
pnpm hardhat lz:oft:solana:init-config --oapp-config <PATH_TO_CONFIG>
```

Make `PATH_TO_CONFIG` a file path to the tokens deployment details. E.g. for bonkSOL, use `configs/bonksol-lz.config.ts`.

### Wire up the OApp

Once we have initialised the configuration, next we just need to wire the OApp we just deployed on Solana to other networks (GLUE). You can do this by running:

```bash
pnpm hardhat lz:oapp:wire --oapp-config <PATH_TO_CONFIG>
```

### Export to Database

Once we have our OApps wired up, we need to generate the lz-config files for them, which is what we insert into the database. To do this, run:

```bash
pnpm hardhat lz:oapp:db-export --oapp-config <PATH_TO_CONFIG>
```

# End to End Instructions

1. Deploy the OFT on glue (change the gOFT.ts file), by running:

```bash
pnpm hardhat deploy --tags <TAG_NAME> --network glue-mainnet
```

IMPORTANT!! Check the decimals you need

2. Deploy the OFT Adapter on solana with:

```bash
pnpm hardhat lz:oft-adapter:solana:create
  --eid 30168
  --program-id 7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso
  --mint <TOKEN_MINT>
  --token-program <TOKEN_PROGRAM_ID>
```

this will output a file <TAG_NAME>-oft.json to the `deployments/solana-mainnet/*` directory.

2. Create the `configs/<TAG_NAME>-lz.config.ts` file from the `configs/EMPTY-lz.config.ts` file. In `-lz.config.ts`just change the `contractName` parameter to whatever `contractName` is in `deploy/gOFT.ts`

3. Initialise the LZ OApp by running:

```bash
pnpm hardhat lz:oft:solana:init-config --oapp-config configs/<TAG_NAME>-lz.config.ts
```

4. Wire up the LZ Oapp

```bash
pnpm hardhat lz:oapp:wire --oapp-config --oapp-config configs/<TAG_NAME>-lz.config.ts
```

5. Generate the DB Files

```bash
pnpm hardhat lz:oapp:db-export --oapp-config <PATH_TO_CONFIG>
```

6. Test in the UI

Insert into the dev database and test these pathways through the UI.

Always guarantee that:

- the sent amount on chain A == the received amount on chain B
- the token images display correctly

Then send it back and ensure amounts (pay attention to decimals) are correct.

## Tokens done so far

#### bonkSOL

- name: `bonkSOL`
- symbol: `bonkSOL`
- decimals: 9
- mint address: `BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs`
- token program: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`

#### PENGU

- name: `Pudgy Penguins`
- symbol: `PENGU`
- decimals: 6
- mint address: `2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv`
- token program: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
