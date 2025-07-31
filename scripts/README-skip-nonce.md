# LayerZero Nonce Skip Script

This script allows you to skip a nonce for LayerZero messages on Solana.

## Prerequisites

Install required dependencies:

```bash
npm install @layerzerolabs/lz-solana-sdk-v2 @layerzerolabs/oft-v2-solana-sdk @layerzerolabs/lz-v2-utilities
npm install @solana/web3.js @metaplex-foundation/umi @metaplex-foundation/umi-bundle-defaults @metaplex-foundation/umi-web3js-adapters
npm install commander dotenv
```

For TypeScript version:
```bash
npm install -D typescript ts-node @types/node
```

## Setup

1. **Keypair**: Place your Solana keypair JSON file in the project root as `keypair.json` or specify a custom path
2. **Environment Variables** (optional): Create a `.env` file:
   ```
   RPC_URL=https://api.mainnet-beta.solana.com
   KEYPAIR_PATH=./keypair.json
   ```

## Usage

### JavaScript Version

```bash
node scripts/skip-nonce.js \
  --receiver YOUR_OFT_STORE_ADDRESS \
  --chain ethereum \
  --sender 0x1234567890123456789012345678901234567890 \
  --nonce 42
```

### TypeScript Version

```bash
npx ts-node scripts/skip-nonce.ts \
  --receiver YOUR_OFT_STORE_ADDRESS \
  --chain ethereum \
  --sender 0x1234567890123456789012345678901234567890 \
  --nonce 42
```

## Command Line Options

- `-r, --receiver <address>` (required): Receiver address (OApp/OFT store on Solana)
- `-c, --chain <chain>` (required): Source chain name (see supported chains below)
- `-s, --sender <address>` (required): Sender address from source chain
- `-n, --nonce <number>` (required): Nonce to skip
- `-k, --keypair <path>`: Path to keypair file (default: ./keypair.json or env KEYPAIR_PATH)
- `-u, --url <url>`: Solana RPC URL (default: env RPC_URL or mainnet-beta)
- `-e, --env <network>`: Network environment: mainnet, devnet, testnet (default: mainnet)

## Supported Chains

### Mainnet
- `ethereum` or `ethereum-mainnet` (EID: 30101)
- `arbitrum` or `arbitrum-mainnet` (EID: 30110)
- `optimism` or `optimism-mainnet` (EID: 30111)
- `polygon` or `polygon-mainnet` (EID: 30109)
- `bsc` or `bsc-mainnet` (EID: 30102)
- `avalanche` or `avalanche-mainnet` (EID: 30106)
- `base` or `base-mainnet` (EID: 30184)

### Testnet
- `ethereum-sepolia` or `sepolia` (EID: 40161)
- `arbitrum-sepolia` (EID: 40231)
- `optimism-sepolia` (EID: 40232)
- `base-sepolia` (EID: 40245)

## Examples

### Skip nonce from Ethereum mainnet
```bash
node scripts/skip-nonce.js \
  --receiver 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM \
  --chain ethereum \
  --sender 0x1234567890123456789012345678901234567890 \
  --nonce 5
```

### Skip nonce from Arbitrum with custom RPC
```bash
node scripts/skip-nonce.js \
  --receiver 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM \
  --chain arbitrum \
  --sender 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd \
  --nonce 10 \
  --url https://your-custom-rpc.com
```

### Skip nonce on testnet
```bash
node scripts/skip-nonce.js \
  --receiver 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM \
  --chain sepolia \
  --sender 0x1234567890123456789012345678901234567890 \
  --nonce 1 \
  --env testnet
```

## What the Script Does

1. **Validates inputs**: Checks that the source chain is supported
2. **Loads keypair**: From the specified file path
3. **Checks balance**: Ensures you have at least 0.01 SOL for fees
4. **Creates skip instruction**: Using the LayerZero Endpoint program
5. **Sends transaction**: Submits to Solana network
6. **Waits for confirmation**: Ensures the transaction is confirmed

## Troubleshooting

### "Account does not exist" Error
- The nonce account may not be initialized yet
- No messages have been sent from this source chain/sender
- The receiver address might be incorrect

### "Unauthorized" Error
- The payer account doesn't have permission to skip nonces
- Make sure the payer is the admin or delegate of the OApp

### "Insufficient balance" Error
- The payer needs at least 0.01 SOL for transaction fees

## Security Notes

- Keep your keypair file secure and never commit it to version control
- Only skip nonces when absolutely necessary
- Document why each nonce was skipped for audit purposes
- Consider using a multisig for production environments