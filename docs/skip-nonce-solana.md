# Skipping Nonces on Solana with LayerZero V2 SDK

## Overview

The LayerZero V2 Solana SDK provides functionality to skip nonces for inbound messages. This is crucial for handling out-of-order messages or recovering from stuck states in cross-chain messaging.

## What is Nonce Skipping?

In LayerZero's cross-chain messaging protocol, each message has a sequential nonce to ensure ordered delivery. Sometimes you may need to skip a nonce when:
- A message is stuck and blocking subsequent messages
- Messages arrive out of order
- Manual intervention is required for recovery
- A message fails permanently and needs to be bypassed

## Prerequisites

```bash
npm install @layerzerolabs/lz-solana-sdk-v2
npm install @layerzerolabs/oft-v2-solana-sdk
npm install @solana/web3.js
npm install @metaplex-foundation/umi-web3js-adapters
```

## Skip Function Details

### Function Signature

```typescript
skip(payer: Signer, params: SkipInstructionDataArgs): WrappedInstruction
```

### Parameters

- `receiver`: PublicKey - The OApp receiver account on Solana
- `srcEid`: number - Source endpoint ID (chain identifier)
- `sender`: Uint8Array - 32-byte sender address from source chain
- `nonce`: number | bigint - The specific nonce to skip

## Implementation Examples

### Basic Skip Implementation

```typescript
import { EndpointProgram, ENDPOINT_PROGRAM_ID } from '@layerzerolabs/lz-solana-sdk-v2'
import { PublicKey, Connection, Keypair, Transaction } from '@solana/web3.js'
import { 
    fromWeb3JsPublicKey, 
    fromWeb3JsKeypair, 
    toWeb3JsInstruction 
} from '@metaplex-foundation/umi-web3js-adapters'
import { createSignerFromKeypair, signerIdentity } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'

async function skipNonce(
    connection: Connection,
    payer: Keypair,
    receiver: PublicKey,
    srcEid: number,
    senderAddress: Uint8Array,
    nonceToSkip: bigint
) {
    // Create UMI instance
    const umi = createUmi(connection.rpcEndpoint)
    const payerSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(payer))
    umi.use(signerIdentity(payerSigner))
    
    // Initialize endpoint
    const endpoint = new EndpointProgram.Endpoint(fromWeb3JsPublicKey(ENDPOINT_PROGRAM_ID))
    
    // Create skip instruction
    const skipIx = endpoint.skip(payerSigner, {
        receiver: fromWeb3JsPublicKey(receiver),
        srcEid: srcEid,
        sender: senderAddress,
        nonce: nonceToSkip
    })
    
    // Convert to web3.js instruction
    const web3Instruction = toWeb3JsInstruction(skipIx.instruction)
    
    // Create and send transaction
    const transaction = new Transaction().add(web3Instruction)
    const signature = await connection.sendTransaction(transaction, [payer])
    await connection.confirmTransaction(signature)
    
    console.log(`Skipped nonce ${nonceToSkip} with transaction: ${signature}`)
    return signature
}
```

### Skip Nonce for OFT

```typescript
import { EndpointProgram, ENDPOINT_PROGRAM_ID } from '@layerzerolabs/lz-solana-sdk-v2'
import { addressToBytes32 } from '@layerzerolabs/lz-v2-utilities'
import { fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters'
import { PublicKey } from '@solana/web3.js'

async function skipNonceForOFT(
    umi: any, // UMI instance
    payer: any, // UMI Signer
    oftStoreAddress: string,
    sourceChainId: number,
    sourceOFTAddress: string, // e.g., "0x123..." for EVM chains
    nonceToSkip: bigint
) {
    const endpoint = new EndpointProgram.Endpoint(fromWeb3JsPublicKey(ENDPOINT_PROGRAM_ID))
    
    // Convert addresses
    const oftStore = fromWeb3JsPublicKey(new PublicKey(oftStoreAddress))
    const senderBytes = addressToBytes32(sourceOFTAddress)
    
    // Create skip instruction
    const skipIx = endpoint.skip(payer, {
        receiver: oftStore,
        srcEid: sourceChainId,
        sender: senderBytes,
        nonce: nonceToSkip
    })
    
    return skipIx
}
```

### Complete Example with Error Handling

```typescript
import { EndpointProgram, ENDPOINT_PROGRAM_ID } from '@layerzerolabs/lz-solana-sdk-v2'
import { addressToBytes32 } from '@layerzerolabs/lz-v2-utilities'
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { 
    fromWeb3JsPublicKey, 
    fromWeb3JsKeypair, 
    toWeb3JsInstruction 
} from '@metaplex-foundation/umi-web3js-adapters'
import { createSignerFromKeypair, signerIdentity } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'

// Chain endpoint IDs (verify these values with @layerzerolabs/lz-definitions)
const ENDPOINT_IDS = {
    ETHEREUM_MAINNET: 30101,
    ARBITRUM_MAINNET: 30110,
    OPTIMISM_MAINNET: 30111,
    POLYGON_MAINNET: 30109,
    BSC_MAINNET: 30102,
    AVALANCHE_MAINNET: 30106,
}

async function skipStuckMessage(
    connection: Connection,
    payer: Keypair,
    oftProgramId: string,
    oftStoreAddress: string,
    sourceChain: keyof typeof ENDPOINT_IDS,
    sourceOFTAddress: string,
    stuckNonce: number
) {
    try {
        // Setup
        const umi = createUmi(connection.rpcEndpoint)
        const payerSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(payer))
        umi.use(signerIdentity(payerSigner))
        
        const endpoint = new EndpointProgram.Endpoint(fromWeb3JsPublicKey(ENDPOINT_PROGRAM_ID))
        
        // Prepare parameters
        const skipParams = {
            receiver: fromWeb3JsPublicKey(new PublicKey(oftStoreAddress)),
            srcEid: ENDPOINT_IDS[sourceChain],
            sender: addressToBytes32(sourceOFTAddress),
            nonce: BigInt(stuckNonce)
        }
        
        console.log('Skipping nonce with params:', {
            receiver: oftStoreAddress,
            srcEid: ENDPOINT_IDS[sourceChain],
            sender: sourceOFTAddress,
            nonce: stuckNonce
        })
        
        // Create skip instruction
        const skipIx = endpoint.skip(payerSigner, skipParams)
        
        // Build and send transaction
        const web3Ix = toWeb3JsInstruction(skipIx.instruction)
        const transaction = new Transaction().add(web3Ix)
        
        const signature = await connection.sendTransaction(transaction, [payer], {
            skipPreflight: false,
            preflightCommitment: 'confirmed'
        })
        
        // Wait for confirmation
        const confirmation = await connection.confirmTransaction(signature, 'confirmed')
        
        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${confirmation.value.err}`)
        }
        
        console.log(`Successfully skipped nonce ${stuckNonce}`)
        console.log(`Transaction signature: ${signature}`)
        
        return signature
        
    } catch (error) {
        console.error('Failed to skip nonce:', error)
        throw error
    }
}

// Usage example
async function main() {
    const connection = new Connection('https://api.mainnet-beta.solana.com')
    const payer = Keypair.fromSecretKey(/* your secret key */)
    
    await skipStuckMessage(
        connection,
        payer,
        'YOUR_OFT_PROGRAM_ID',
        'YOUR_OFT_STORE_ADDRESS',
        'ETHEREUM_MAINNET',
        '0x1234567890123456789012345678901234567890', // Source OFT address
        42 // Nonce to skip
    )
}
```

## Querying Next Expected Nonce

Before skipping, you might want to check the current expected nonce:

```typescript
import { nextNonce } from '@layerzerolabs/lz-solana-sdk-v2'
import { fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters'

async function checkNextNonce(
    connection: Connection,
    payer: PublicKey,
    receiver: PublicKey,
    srcEid: number,
    senderAddress: string
) {
    const packet = {
        sender: senderAddress,
        srcEid: srcEid,
        receiver: receiver.toBase58()
    }
    
    const expectedNonce = await nextNonce(
        connection,
        fromWeb3JsPublicKey(payer),
        packet,
        'confirmed'
    )
    
    console.log(`Next expected nonce: ${expectedNonce}`)
    return expectedNonce
}
```

## Important Considerations

1. **Permissions**: Only authorized accounts (admin/delegate) can skip nonces
2. **Payload Hash**: The payload hash for the nonce must be initialized before skipping
3. **Event Emission**: Successful skip operations emit an `InboundNonceSkippedEvent`
4. **Irreversibility**: Skipping a nonce is permanent - the skipped message cannot be processed later
5. **Order Preservation**: Skipping a nonce allows subsequent messages to be processed

## Common Use Cases

### 1. Recovering from Stuck Messages
```typescript
// If nonce 5 is stuck, skip it to allow nonce 6+ to process
await skipNonce(connection, payer, receiver, srcEid, sender, 5n)
```

### 2. Handling Failed Cross-Chain Transactions
```typescript
// When a source transaction fails after message emission
// but before destination processing
await skipStuckMessage(
    connection,
    payer,
    oftProgramId,
    oftStore,
    'ETHEREUM_MAINNET',
    sourceOFTAddress,
    failedNonce
)
```

### 3. Emergency Recovery
```typescript
// Skip multiple nonces in sequence if needed
for (const nonce of [10, 11, 12]) {
    await skipNonce(connection, payer, receiver, srcEid, sender, BigInt(nonce))
}
```

## Error Handling

Common errors when skipping nonces:

- `Unauthorized`: The signer doesn't have permission to skip nonces
- `Account does not exist`: The nonce account hasn't been initialized
- `Invalid nonce`: Trying to skip a nonce that's already been processed
- `Payload hash not initialized`: The message hasn't been received yet

## Monitoring Skip Events

```typescript
import { toWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters'

connection.onLogs(
    toWeb3JsPublicKey(ENDPOINT_PROGRAM_ID),
    (logs) => {
        if (logs.logs.some(log => log.includes('InboundNonceSkipped'))) {
            console.log('Nonce skipped event detected:', logs.signature)
        }
    },
    'confirmed'
)
```

## Security Best Practices

1. **Restrict Access**: Implement proper access controls for skip functionality
2. **Audit Trail**: Log all skip operations with reasons
3. **Verification**: Always verify the stuck state before skipping
4. **Documentation**: Document why each nonce was skipped
5. **Multi-sig**: Consider requiring multiple signatures for skip operations

## Ready-to-Use Scripts

We've provided two complete TypeScript scripts for managing nonces on Solana:

### 1. Skip Nonce Script

Complete TypeScript script for skipping nonces on Solana:

**File**: `scripts/skip-nonce.ts`  
**Purpose**: Skip a specific nonce to unblock message processing

### Usage

```bash
# Skip a nonce on Solana mainnet
npx ts-node scripts/skip-nonce.ts \
  --receiver 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM \
  --chain ethereum \
  --sender 0x1234567890123456789012345678901234567890 \
  --nonce 42

# Skip a nonce on Solana devnet
npx ts-node scripts/skip-nonce.ts \
  --receiver YOUR_SOLANA_RECEIVER_ADDRESS \
  --chain ethereum \
  --sender 0x1234567890123456789012345678901234567890 \
  --nonce 42 \
  --devnet

# Skip a nonce on Solana testnet
npx ts-node scripts/skip-nonce.ts \
  --receiver YOUR_SOLANA_RECEIVER_ADDRESS \
  --chain sepolia \
  --sender 0x1234567890123456789012345678901234567890 \
  --nonce 1 \
  --testnet
```

### Command Options

- `-r, --receiver <address>` (required): Receiver address on Solana (OApp/OFT store)
- `-c, --chain <chain>` (required): Source chain name (ethereum, arbitrum, optimism, etc.)
- `-s, --sender <address>` (required): Sender address from source chain (0x... format)
- `-n, --nonce <number>` (required): Nonce to skip
- `-k, --keypair <path>`: Path to Solana keypair file (default: ./keypair.json)
- `-u, --url <url>`: Solana RPC URL (default: mainnet-beta)
- `--devnet`: Use Solana devnet
- `--testnet`: Use Solana testnet

### Script Features

1. **Solana-Focused**: Specifically designed for skipping nonces on Solana
2. **Network Support**: Mainnet, devnet, and testnet support
3. **Balance Checking**: Ensures sufficient SOL for transaction fees
4. **Transaction Confirmation**: Waits for confirmation and provides explorer links
5. **Error Handling**: Solana-specific error messages and troubleshooting tips
6. **Connection Testing**: Verifies Solana connection before proceeding

### Prerequisites for Script

```bash
# Install dependencies
npm install @layerzerolabs/lz-solana-sdk-v2 @layerzerolabs/lz-v2-utilities
npm install @solana/web3.js @metaplex-foundation/umi @metaplex-foundation/umi-bundle-defaults @metaplex-foundation/umi-web3js-adapters
npm install commander dotenv typescript ts-node
```

### Environment Setup

Create a `.env` file (optional):
```
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_KEYPAIR_PATH=./keypair.json
```

### Supported Source Chains

The script supports messages from these source chains:
- **Mainnet**: ethereum, arbitrum, optimism, polygon, bsc, avalanche, base
- **Testnet**: ethereum-sepolia, arbitrum-sepolia, optimism-sepolia, base-sepolia

### 2. Get Nonce Script

Complete TypeScript script for querying the next expected nonce on Solana:

**File**: `scripts/get-nonce.ts`  
**Purpose**: Query the next expected nonce for a message path (read-only)

#### Usage

```bash
# Get next nonce on Solana mainnet
npx ts-node scripts/get-nonce.ts \
  --receiver 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM \
  --chain ethereum \
  --sender 0x1234567890123456789012345678901234567890

# Get next nonce on Solana devnet
npx ts-node scripts/get-nonce.ts \
  --receiver YOUR_SOLANA_RECEIVER_ADDRESS \
  --chain ethereum \
  --sender 0x1234567890123456789012345678901234567890 \
  --devnet

# Get next nonce on Solana testnet
npx ts-node scripts/get-nonce.ts \
  --receiver YOUR_SOLANA_RECEIVER_ADDRESS \
  --chain sepolia \
  --sender 0x1234567890123456789012345678901234567890 \
  --testnet
```

#### Command Options

- `-r, --receiver <address>` (required): Receiver address on Solana (OApp/OFT store)
- `-c, --chain <chain>` (required): Source chain name (ethereum, arbitrum, optimism, etc.)
- `-s, --sender <address>` (required): Sender address from source chain (0x... format)
- `-u, --url <url>`: Solana RPC URL (default: mainnet-beta)
- `--devnet`: Use Solana devnet
- `--testnet`: Use Solana testnet

#### Script Features

1. **Read-Only Operation**: No keypair required, just queries the blockchain
2. **Network Support**: Mainnet, devnet, and testnet support
3. **Error Handling**: Helpful messages for missing accounts or invalid addresses
4. **Connection Testing**: Verifies Solana connection before querying
5. **Clear Output**: Shows current expected nonce with explanations

#### Typical Workflow

```bash
# 1. Check current nonce before taking action
npx ts-node scripts/get-nonce.ts \
  --receiver YOUR_RECEIVER \
  --chain ethereum \
  --sender 0x123...

# Output: Next expected nonce: 5
# This means nonces 0-4 have been processed/skipped

# 2. If needed, skip the stuck nonce
npx ts-node scripts/skip-nonce.ts \
  --receiver YOUR_RECEIVER \
  --chain ethereum \
  --sender 0x123... \
  --nonce 5

# 3. Verify the nonce was skipped
npx ts-node scripts/get-nonce.ts \
  --receiver YOUR_RECEIVER \
  --chain ethereum \
  --sender 0x123...

# Output: Next expected nonce: 6
```

## Conclusion

The LayerZero V2 Solana SDK provides critical nonce management functionality for cross-chain messaging. The provided TypeScript scripts make it easy to both query and skip nonces on Solana:

- **`get-nonce.ts`**: Query the next expected nonce (read-only, no keypair needed)
- **`skip-nonce.ts`**: Skip a specific nonce to unblock message processing (requires admin/delegate permissions)

Use the get-nonce script to check the current state before taking action, and the skip-nonce script judiciously with proper authorization and documentation when recovery is needed.