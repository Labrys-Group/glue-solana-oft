Check your config is correct (for dev or mainnet)
solana config get

######## UPDATE THE EIDS!!!!!!!!! ########

### UPDATE the env key path

const GLUE_V2_MAINNET_EID = 30342
const SOLANA_MAINNET_EID = 30168

const GLUE_V2_TESTNET_EID = 40296
const SOLANA_TESTNET_EID = 40168
const BASE_SEPOLIA_EID = 40245

Check layerzero.config.ts is correct!

anchor keys list

endpoint: 4riW6rPYZoHjyA57eXVTbkMxYS3yw6hDr9zxVWsZQ4oF
oft: 7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso

# make sure we are using Solana 1.17.31

solana-install init v1.17.31

```bash
anchor build -v -e OFT_ID=<OFT_PROGRAM_ID>
```

solana-install init v1.18.26

# get gas from https://www.quicknode.com/gas-tracker/solana

# Run the deploy command (only required once)

solana program deploy --program-id target/deploy/oft-keypair.json target/verifiable/oft.so --with-compute-unit-price <COMPUTE_UNIT_PRICE_IN_MICRO_LAMPORTS>

### if you mess up you can refund the rent

solana program close <ACTUAL_PROGRAM_ACCOUNT_ADDRESS> --keypair ./keypair.json
Then follow the prompts

# Switch back to Solana 1.17.31

solana-install init v1.17.31

### Create the Solana OFT

# For OFTAdapter:

# UPDATE THIS with the token mint address and eids

pnpm hardhat lz:oft-adapter:solana:create --eid 30168 --program-id <PROGRAM_ID> --mint <TOKEN_MINT> --token-program <TOKEN_PROGRAM_ID>

eg:
pnpm hardhat lz:oft-adapter:solana:create --eid 30168 --program-id 7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso --mint 9wK8yN6iz1ie5kEJkvZCTxyN1x5sTdNfx8yeMY8Ebonk --token-program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

### Deploy a OFT peer

Don't forget to update the decimals in the oft contract, not just the deploy script!
Update tokenConfig in the deploy script

pnpm hardhat lz:deploy
Follow prompts

### Initialize the OFT Program's SendConfig and ReceiveConfig Accounts

# :warning: Do this only when initializing the OFT for the first time.

npx hardhat lz:oft:solana:init-config --oapp-config layerzero.config.ts

### Wire

# Run the following to wire the pathways specified in your layerzero.config.ts

npx hardhat lz:oapp:wire --oapp-config layerzero.config.ts

### Now create a token account for the token

## this is required as we don't have any token accounts for the token yet

spl-token create-account <MINT_ADDRESS>

### Send

### Send SOL -> GLUE

### NOTE THE EIDS HERE

npx hardhat lz:oft:solana:send --amount <AMOUNT> --from-eid 30168 --to <TO> --to-eid 30342

eg:

npx hardhat lz:oft:solana:send --amount 1 --from-eid 30168 --to 0x57424C70A1383e6F4BB15ebCf874303E5D3BcC8a --to-eid 30342

### Send Glue -> SOL

npx hardhat --network sepolia-testnet send --dst-eid 30168 --amount <AMOUNT> --to <TO>

npx hardhat --network glue-mainnet send --dst-eid 30168 --amount 1 --to 6hrbvstzahgkMbACzwjZRcZpWGgA2HLWCpg194w1fsQi <TOKEN_ACCOUNT_MADE_ABOVE>

6hrbvstzahgkMbACzwjZRcZpWGgA2HLWCpg194w1fsQi
