# get-nonce.ts

A TypeScript script for querying the next expected nonce for LayerZero message paths on Solana.

## Overview

This script queries the LayerZero endpoint program on Solana to determine the next expected nonce for messages sent from a specified source chain to a receiver address. This is useful for debugging message ordering issues and ensuring proper nonce sequencing in cross-chain applications.

## Usage

### Command Line Interface

```bash
# Run with required parameters
npx ts-node scripts/get-nonce.ts --receiver <solana-address> --chain <chain-name> --sender <sender-address>

# Example
npx ts-node scripts/get-nonce.ts --receiver So11111111111111111111111111111111111111112 --chain ethereum --sender 0x1234567890123456789012345678901234567890

# Use different Solana networks
npx ts-node scripts/get-nonce.ts --receiver <address> --chain ethereum --sender <sender> --devnet
npx ts-node scripts/get-nonce.ts --receiver <address> --chain ethereum --sender <sender> --testnet

# Use custom RPC URL
npx ts-node scripts/get-nonce.ts --receiver <address> --chain ethereum --sender <sender> --url https://your-rpc-url.com

# Show help
npx ts-node scripts/get-nonce.ts --help
```

### CLI Options

- `-r, --receiver <address>` - Receiver address on Solana (OApp/OFT store) [Required]
- `-c, --chain <chain>` - Source chain name (ethereum, arbitrum, optimism, etc.) [Required]
- `-s, --sender <address>` - Sender address from source chain (0x... format) [Required]
- `-u, --url <url>` - Solana RPC URL (default: mainnet-beta)
- `--devnet` - Use Solana devnet
- `--testnet` - Use Solana testnet
- `-h, --help` - Display help for command

## Function: getNextNonceOnSolana

### Parameters

- `connection` - Solana RPC connection instance
- `receiverAddress` - The OApp/OFT contract address on Solana that receives cross-chain messages
- `sourceChain` - Source chain name (see supported chains below)
- `senderAddress` - The OApp/OFT contract address on the source chain that sends cross-chain messages

### Returns

- `Promise<bigint>` - The next expected nonce for the message path

### Supported Chains

The script supports the following source chains with their corresponding endpoint IDs:

**Mainnet:**
- `ethereum` / `ethereum-mainnet`: 30101
- `bsc` / `bsc-mainnet`: 30102
- `avalanche` / `avalanche-mainnet`: 30106
- `polygon` / `polygon-mainnet`: 30109
- `arbitrum` / `arbitrum-mainnet`: 30110
- `optimism` / `optimism-mainnet`: 30111
- `base` / `base-mainnet`: 30184

**Testnet:**
- `ethereum-sepolia` / `sepolia`: 40161
- `arbitrum-sepolia`: 40231
- `optimism-sepolia`: 40232
- `base-sepolia`: 40245

## Example

### Using as a Module

```typescript
import { Connection } from '@solana/web3.js';
import { getNextNonceOnSolana } from './scripts/get-nonce';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const receiverAddress = 'YourReceiverAddressHere';
const sourceChain = 'ethereum';
const senderAddress = '0xYourSenderAddressHere';

const nonce = await getNextNonceOnSolana(
  connection,
  receiverAddress,
  sourceChain,
  senderAddress
);
console.log('Next expected nonce:', nonce.toString());
```

### Command Line Usage

```bash
# Check nonce for a message path
npx ts-node scripts/get-nonce.ts \
  --receiver So11111111111111111111111111111111111111112 \
  --chain ethereum \
  --sender 0x1234567890123456789012345678901234567890

# Output will show:
# === Get Next Nonce on Solana ===
# 
# Query Parameters:
# - Receiver (Solana): So11111111111111111111111111111111111111112
# - Source Chain: ethereum (EID: 30101)
# - Sender: 0x1234567890123456789012345678901234567890
# - RPC Endpoint: https://api.mainnet-beta.solana.com
# 
# ✅ Next expected nonce: 5
# 
# This means:
# - The receiver is expecting nonce 5 next
# - All nonces 0 to 4 have been processed or skipped
```

## Error Handling

The function will throw an error if:
- An invalid source chain name is provided
- The RPC connection fails
- The LayerZero endpoint program is not found

## Dependencies

- `@solana/web3.js` - Solana blockchain interaction
- `@layerzerolabs/lz-solana-sdk-v2` - LayerZero Solana SDK (specifically the `/umi` subpath export)
- `commander` - CLI argument parsing
- `dotenv` - Environment variable loading
- TypeScript configuration with `moduleResolution: "nodenext"` or `"node16"`

## Technical Notes

### Import Method
The script uses `require()` to import the `nextNonce` function from the LayerZero SDK to avoid TypeScript module resolution issues with subpath exports:

```typescript
const { nextNonce } = require('@layerzerolabs/lz-solana-sdk-v2/umi')
```

This works at runtime while avoiding TypeScript compilation errors.

### Network Support
The script automatically detects the correct Solana network based on CLI flags:
- Default: Solana mainnet-beta
- `--devnet`: Solana devnet  
- `--testnet`: Solana testnet
- `--url <url>`: Custom RPC URL

## Understanding Receiver and Sender Addresses

### What Are These Addresses?

In LayerZero cross-chain messaging, the **sender** and **receiver** addresses are the smart contract addresses that participate in cross-chain communication:

- **Sender Address**: The smart contract address on the source chain (like Ethereum, Arbitrum, etc.) that initiates cross-chain messages. This is typically an OApp (Omnichain Application) or OFT (Omnichain Fungible Token) contract.

- **Receiver Address**: The smart contract address on Solana that is designated to receive and process the cross-chain messages. This is your deployed OApp/OFT contract on Solana.

### Contract Types

| Contract Type | Description | Role |
|---------------|-------------|------|
| **OApp** | Omnichain Application - Custom contracts using LayerZero for arbitrary cross-chain messaging | Can send/receive any custom data |
| **OFT** | Omnichain Fungible Token - Token bridge contracts following LayerZero's standard | Send/receive token transfers |

### How to Find These Addresses

#### Method 1: From LayerZeroScan
1. Go to [LayerZeroScan](https://layerzeroscan.com) (or [testnet version](https://testnet.layerzeroscan.com))
2. Search for your transaction hash
3. In the transaction details, look for:
   - **Sender Contract**: The contract address on the source chain
   - **Receiver Contract**: The contract address on Solana
   - **Source Chain**: The originating blockchain
   - **Nonce**: The message sequence number for this path

#### Method 2: From Your Deployment
- **Receiver Address**: This is the address of your deployed OFT/OApp contract on Solana
- **Sender Address**: This is the address of your deployed OFT/OApp contract on the source chain (Ethereum, Arbitrum, etc.)

### Nonce Channels

Nonces are tracked **per channel**, where a channel is uniquely defined by:
- Sender contract address
- Receiver contract address  
- Source chain endpoint ID
- Destination chain endpoint ID

Each unique sender → receiver path maintains its own independent nonce sequence starting from 0.

### Example Usage with Real Addresses

```bash
# Example: Check nonce for an OFT bridge from Ethereum to Solana
npx ts-node scripts/get-nonce.ts \
  --receiver "9w8Z8qoQL3kG7YVR8YFvQvziCGK7V8B9DfAJ5YxQqJ2F" \  # Your Solana OFT contract
  --chain ethereum \
  --sender "0x1234567890123456789012345678901234567890"         # Your Ethereum OFT contract

# This will tell you the next expected nonce for messages sent from
# the Ethereum OFT contract to the Solana OFT contract
```

### Finding Your Contract Addresses

1. **For Receiver (Solana)**:
   - Check your deployment logs/scripts
   - Look in your `deployments/` folder
   - Use `solana address` if you have the keypair
   - Check LayerZeroScan for recent transactions

2. **For Sender (Source Chain)**:
   - Check your deployment logs/scripts on the source chain
   - Look in your Hardhat/Foundry deployment artifacts
   - Check Etherscan/block explorer for the source chain
   - Look up your OFT/OApp contract deployment transaction

### Troubleshooting Nonces

If you're troubleshooting stuck or failed cross-chain messages:

1. **Check the current nonce** with this script
2. **Compare with LayerZeroScan** to see what nonce was last sent
3. **Look for gaps** - if the next expected nonce is 5 but you only sent up to nonce 3, nonce 4 might be stuck
4. **Use the skip-nonce script** if you need to skip a stuck nonce
