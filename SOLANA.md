# Solana OFT Adapting and Creating

we have deployed our OFT program at here on solana mainnet [7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso](https://solscan.io/account/7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso)

when adding a new token, first we initialise a oft store for this mint address on solana. This can be done with:

```
# init command
```

then once we have init'ed, we just need to wire them up with:

```bash
pnpm hardhat lz:oft-adapter:solana:create
  --eid 30168
  --program-id 7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso
  --mint <TOKEN_MINT>
  --token-program <TOKEN_PROGRAM_ID>
```

pnpm hardhat lz:oft-adapter:solana:create --eid 30168 --program-id 7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso --mint BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs --token-program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

pnpm hardhat lz:oapp:wire --oapp-config configs/bonksol-lz.config.ts

```
# wire up commands
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
