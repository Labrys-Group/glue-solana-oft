#!/usr/bin/env ts-node

/**
 * LayerZero Skip Nonce Script for Solana
 *
 * PURPOSE:
 * This script skips stuck INBOUND nonces on Solana when cross-chain messages from other chains
 * fail to deliver properly. It allows the LayerZero protocol to continue processing subsequent
 * messages by marking a specific nonce as "skipped".
 *
 * WHAT IT DOES:
 * - Skips INBOUND nonces (messages coming INTO Solana from other chains)
 * - Works with TWO nonce accounts:
 *   1. Main Nonce Account (seed: "Nonce") - tracks both inbound/outbound nonces
 *   2. Pending Inbound Nonce Account (seed: "PendingNonce") - tracks pending inbound nonces
 * - Both PDAs based on: receiver (Solana OFT), source chain EID, and sender address
 *
 * NONCE TYPES EXPLAINED:
 * - Inbound Nonce: Messages received BY Solana FROM other chains (what this script skips)
 * - Outbound Nonce: Messages sent FROM Solana TO other chains (not handled by this script)
 *
 * EXAMPLE USAGE:
 * Skip nonce 8 for messages from Base Sepolia → Solana Devnet:
 * ```
 * npx ts-node scripts/skip-nonce.ts \
 *   --receiver 36UH5YRWZnrR41SuD91zWmNp8zdEKMW9yDR3vyxpH5uQ \
 *   --chain base-sepolia \
 *   --sender 0xaac5842e11637c188aa34655b98918fecd615fee \
 *   --nonce 8 \
 *   --devnet
 * ```
 *
 * EXAMPLE OUTPUT INTERPRETATION:
 * ```
 * Current Nonce State:
 *   - Inbound Nonce (received): 7    <- Messages received FROM base-sepolia TO solana
 *   - Outbound Nonce (sent): 6       <- Messages sent FROM solana TO base-sepolia
 *   - Attempting to skip: 8          <- Skipping inbound message #8 (base-sepolia → solana)
 * ```
 *
 * WHEN TO USE:
 * - Message sent from Source Chain but never delivered to Solana
 * - LayerZero pathway is stuck waiting for a specific nonce
 * - Subsequent messages are blocked because of the missing nonce
 * - You want to "give up" on a specific stuck message and continue processing
 *
 * REQUIREMENTS:
 * - Solana keypair with admin/delegate permissions for the OApp
 * - Sufficient SOL for transaction fees
 * - The nonce account must exist (created when first message is received)
 * - Use the correct OFT store address (not wallet address) as receiver
 *
 * IMPORTANT ADDRESSES:
 * - Receiver should be the OFT store address from deployment files
 * - Mainnet OFT: 5ekypahkmCtbQeu3nEvHyt5QriZNww5V3F42TKfSASqt
 * - Testnet OFT: 36UH5YRWZnrR41SuD91zWmNp8zdEKMW9yDR3vyxpH5uQ
 */

import { readFileSync } from 'fs'

import { createSignerFromKeypair, signerIdentity } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters'
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { Command } from 'commander'
import * as dotenv from 'dotenv'

import { EndpointProgram, NONCE_SEED } from '@layerzerolabs/lz-solana-sdk-v2'
import { addressToBytes32 } from '@layerzerolabs/lz-v2-utilities'

// Load environment variables
dotenv.config()

// LayerZero V2 endpoint program ID
// Use your custom endpoint for devnet/testnet
// const ENDPOINT_PROGRAM_ID = new PublicKey('4riW6rPYZoHjyA57eXVTbkMxYS3yw6hDr9zxVWsZQ4oF') // Your devnet endpoint
const ENDPOINT_PROGRAM_ID = new PublicKey('76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6') // Official LayerZero mainnet

// LayerZero constants
const PENDING_NONCE_SEED = 'PendingInboundNonce'

// Chain endpoint IDs
const ENDPOINT_IDS: Record<string, number> = {
    ethereum: 30101,
    'ethereum-mainnet': 30101,
    arbitrum: 30110,
    'arbitrum-mainnet': 30110,
    optimism: 30111,
    'optimism-mainnet': 30111,
    polygon: 30109,
    'polygon-mainnet': 30109,
    bsc: 30102,
    'bsc-mainnet': 30102,
    avalanche: 30106,
    'avalanche-mainnet': 30106,
    base: 30184,
    'base-mainnet': 30184,

    // Testnet IDs
    'ethereum-sepolia': 40161,
    sepolia: 40161,
    'arbitrum-sepolia': 40231,
    'optimism-sepolia': 40232,
    'base-sepolia': 40245,

    // Solana testnet EID for reference
    'solana-testnet': 40168,
    'solana-devnet': 40168,
}

async function checkCurrentNonce(
    connection: Connection,
    receiverAddress: string,
    sourceChain: string,
    senderAddress: string
): Promise<{
    inboundNonce: number | null
    outboundNonce: number | null
    exists: boolean
    pendingInboundNonce: number | null
    pendingExists: boolean
    mainNoncePDA: string
    pendingNoncePDA: string
}> {
    try {
        const srcEid = ENDPOINT_IDS[sourceChain.toLowerCase()]
        if (!srcEid) {
            throw new Error(`Unknown source chain: ${sourceChain}`)
        }

        // Convert addresses to the format needed for PDA derivation
        const senderBytes = addressToBytes32(senderAddress)
        const receiverPublicKey = new PublicKey(receiverAddress)

        // Derive the main nonce PDA using LayerZero's pattern
        const mainNonceSeeds = [
            Buffer.from(NONCE_SEED, 'utf8'),
            receiverPublicKey.toBuffer(),
            Buffer.from(new Uint32Array([srcEid]).buffer).reverse(), // Big endian u32
            Buffer.from(senderBytes),
        ]

        // Derive the pending inbound nonce PDA
        const pendingNonceSeeds = [
            Buffer.from(PENDING_NONCE_SEED, 'utf8'),
            receiverPublicKey.toBuffer(),
            Buffer.from(new Uint32Array([srcEid]).buffer).reverse(), // Big endian u32
            Buffer.from(senderBytes),
        ]

        // Find both PDAs using the endpoint program
        const [mainNoncePDA] = PublicKey.findProgramAddressSync(mainNonceSeeds, ENDPOINT_PROGRAM_ID)
        const [pendingNoncePDA] = PublicKey.findProgramAddressSync(pendingNonceSeeds, ENDPOINT_PROGRAM_ID)

        console.log(`\n🔍 Account Analysis:`)
        console.log(`├─ Main Nonce PDA: ${mainNoncePDA.toBase58()}`)
        console.log(`└─ Pending Inbound Nonce PDA: ${pendingNoncePDA.toBase58()}`)

        // Try to fetch both accounts
        const [mainAccountInfo, pendingAccountInfo] = await connection.getMultipleAccountsInfo([
            mainNoncePDA,
            pendingNoncePDA,
        ])

        let inboundNonce = null,
            outboundNonce = null,
            exists = false
        if (mainAccountInfo) {
            exists = true
            // Parse the main nonce account data manually
            // Nonce account structure: [discriminator: 8 bytes, bump: 1 byte, outbound: 8 bytes, inbound: 8 bytes]
            const data = mainAccountInfo.data
            if (data.length >= 25) {
                // Skip discriminator (8 bytes) and bump (1 byte), then read the nonces
                outboundNonce = Number(data.readBigUInt64LE(9)) // bytes 9-16
                inboundNonce = Number(data.readBigUInt64LE(17)) // bytes 17-24
                console.log(`✅ Main Nonce Account: FOUND (${data.length} bytes)`)
            } else {
                console.warn(`⚠️  Main Nonce Account: Too short (${data.length} bytes)`)
            }
        } else {
            console.log(`❌ Main Nonce Account: NOT FOUND`)
        }

        let pendingInboundNonce = null,
            pendingExists = false
        if (pendingAccountInfo) {
            pendingExists = true
            // Parse pending inbound nonce account (structure may be different)
            const data = pendingAccountInfo.data
            console.log(`✅ Pending Inbound Nonce Account: FOUND (${data.length} bytes)`)

            // Try to parse as u64 at different offsets to find the nonce value
            if (data.length >= 16) {
                // Try different offsets to find the nonce value
                try {
                    pendingInboundNonce = Number(data.readBigUInt64LE(8)) // Skip discriminator
                } catch (e) {
                    console.warn(`⚠️  Could not parse pending nonce data`)
                }
            }
        } else {
            console.log(`❌ Pending Inbound Nonce Account: NOT FOUND`)
        }

        return {
            inboundNonce,
            outboundNonce,
            exists,
            pendingInboundNonce,
            pendingExists,
            mainNoncePDA: mainNoncePDA.toBase58(),
            pendingNoncePDA: pendingNoncePDA.toBase58(),
        }
    } catch (error: any) {
        console.warn(`Warning: Failed to check nonce: ${error.message}`)
        return {
            inboundNonce: null,
            outboundNonce: null,
            exists: false,
            pendingInboundNonce: null,
            pendingExists: false,
            mainNoncePDA: 'unknown',
            pendingNoncePDA: 'unknown',
        }
    }
}

async function skipNonceOnSolana(
    connection: Connection,
    payer: Keypair,
    receiverAddress: string,
    sourceChain: string,
    senderAddress: string,
    nonceToSkip: number
): Promise<string> {
    try {
        console.log('=== Skip Nonce on Solana ===\n')

        // Validate source chain
        const srcEid = ENDPOINT_IDS[sourceChain.toLowerCase()]
        if (!srcEid) {
            throw new Error(
                `Unknown source chain: ${sourceChain}. Valid chains: ${Object.keys(ENDPOINT_IDS).join(', ')}`
            )
        }

        // Create UMI instance
        const umi = createUmi(connection.rpcEndpoint)
        const payerSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(payer))
        umi.use(signerIdentity(payerSigner))

        // Initialize LayerZero endpoint
        const endpoint = new EndpointProgram.Endpoint(ENDPOINT_PROGRAM_ID)

        // Convert addresses
        const senderBytes = addressToBytes32(senderAddress)
        const senderPublicKey = new PublicKey(senderBytes)

        console.log('Skip Parameters:')
        console.log(`- Source Chain: ${sourceChain} (EID: ${srcEid})`)
        console.log(
            `- Destination Chain: Solana (${options.devnet ? 'devnet' : options.testnet ? 'testnet' : 'mainnet'})`
        )
        console.log(`- Sender: ${senderAddress}`)
        console.log(`- Receiver (Solana): ${receiverAddress}`)
        console.log(`- Nonce to Skip: ${nonceToSkip}`)
        console.log(`- Payer: ${payer.publicKey.toBase58()}\n`)

        // Check payer balance
        const balance = await connection.getBalance(payer.publicKey)
        console.log(`Payer balance: ${balance / 1e9} SOL`)

        if (balance < 0.01 * 1e9) {
            throw new Error('Insufficient balance. Need at least 0.01 SOL for transaction fees.')
        }

        // Check current nonce state
        console.log('\nChecking current nonce state...')
        const nonceState = await checkCurrentNonce(connection, receiverAddress, sourceChain, senderAddress)

        if (!nonceState.exists) {
            console.log('❌ Main Nonce Account Status: NOT FOUND')
            console.log('💡 This means:')
            console.log('  - No messages have been received from this pathway yet')
            console.log(`  - No messages from ${sourceChain} → Solana`)
            console.log(`  - Sender: ${senderAddress}`)
            console.log(`  - Receiver: ${receiverAddress}`)
            console.log(`  - Cannot skip nonce ${nonceToSkip} because it doesn't exist`)
            console.log('\n🔍 To fix this:')
            console.log('  1. Verify a message was actually sent from the source chain')
            console.log('  2. Check if the sender/receiver addresses are correct')
            console.log('  3. Wait for the first message to create the nonce account')
            throw new Error('Nonce account does not exist - no messages received from this pathway')
        }

        console.log('\n📊 Current Nonce State:')
        console.log(`├─ Main Nonce Account:`)
        console.log(`│  ├─ Inbound Nonce (FROM ${sourceChain} TO Solana): ${nonceState.inboundNonce}`)
        console.log(`│  └─ Outbound Nonce (FROM Solana TO ${sourceChain}): ${nonceState.outboundNonce}`)
        if (nonceState.pendingExists) {
            console.log(`├─ Pending Inbound Nonce Account: ${nonceState.pendingInboundNonce}`)
        } else {
            console.log(`├─ Pending Inbound Nonce Account: NOT FOUND`)
        }
        console.log(`└─ Attempting to skip: ${nonceToSkip}`)

        // Validate the nonce to skip
        if (nonceState.inboundNonce !== null && nonceToSkip > nonceState.inboundNonce + 1) {
            console.log(
                `\n⚠️  Warning: Trying to skip nonce ${nonceToSkip} but current inbound nonce is ${nonceState.inboundNonce}`
            )
            console.log(`   This might indicate the nonce doesn't exist yet.`)
        } else if (nonceState.inboundNonce !== null && nonceToSkip <= nonceState.inboundNonce) {
            console.log(
                `\n⚠️  Warning: Trying to skip nonce ${nonceToSkip} but it may already be processed (current: ${nonceState.inboundNonce})`
            )
        }

        // Show what accounts the skip instruction will use
        console.log(`\n🎯 Skip Instruction Will Use:`)
        console.log(`├─ Main Nonce Account: ${nonceState.mainNoncePDA}`)
        console.log(`├─ Pending Inbound Nonce Account: ${nonceState.pendingNoncePDA}`)
        console.log(`└─ This will skip INBOUND nonce ${nonceToSkip} (${sourceChain} → Solana)`)

        // Create skip instruction
        console.log('\nCreating skip instruction...')
        const skipIx = await endpoint.skip(
            payer.publicKey,
            senderPublicKey,
            new PublicKey(receiverAddress),
            srcEid,
            nonceToSkip.toString()
        )

        if (!skipIx) {
            throw new Error('Failed to create skip instruction')
        }

        // Create transaction with the skip instruction
        const web3Instruction = skipIx
        const transaction = new Transaction().add(web3Instruction)

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
        transaction.recentBlockhash = blockhash
        transaction.feePayer = payer.publicKey

        // Send transaction
        console.log('Sending skip transaction...')
        const signature = await connection.sendTransaction(transaction, [payer], {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
            maxRetries: 3,
        })

        console.log(`Transaction sent: ${signature}`)
        console.log(`Explorer: https://solscan.io/tx/${signature}`)

        // Wait for confirmation
        console.log('\nWaiting for confirmation...')
        const confirmation = await connection.confirmTransaction(
            {
                signature,
                blockhash,
                lastValidBlockHeight,
            },
            'confirmed'
        )

        if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
        }

        console.log('\n✅ Successfully skipped nonce on Solana!')
        console.log(`Nonce ${nonceToSkip} from ${sourceChain} has been skipped.`)
        console.log(`This allows subsequent nonces to be processed.`)

        return signature
    } catch (error: any) {
        console.error('\n❌ Error skipping nonce on Solana:')
        console.error(error.message || error)

        // Provide helpful error messages specific to Solana
        if (error.message?.includes('Account does not exist') || error.message?.includes('AccountNotInitialized')) {
            console.error('\n💡 Nonce Account Issue:')
            console.error('- The nonce account may not be initialized yet')
            console.error('- This happens when no messages have been received from this pathway')
            console.error('- Run the script again to see current nonce state')
            console.error('- Verify the sender/receiver addresses are correct')
        } else if (error.message?.includes('Unauthorized')) {
            console.error('\n💡 Permission issue:')
            console.error('- The payer must be the admin or delegate of the OApp on Solana')
            console.error('- Verify the payer has the right to skip nonces')
        } else if (error.message?.includes('InsufficientFundsForTransaction')) {
            console.error('\n💡 Solana transaction fee issue:')
            console.error('- Need more SOL for transaction fees')
            console.error('- Current balance may be too low')
        } else if (error.message?.includes('Nonce account does not exist')) {
            console.error('\n💡 No messages received yet:')
            console.error('- The nonce tracking account is created when the first message is received')
            console.error('- Send a test message from the source chain first')
            console.error('- Then you can skip nonces as needed')
        }

        throw error
    }
}

// Set up CLI
const program = new Command()

program
    .name('skip-nonce')
    .description('Skip a LayerZero nonce on Solana')
    .version('1.0.0')
    .requiredOption('-r, --receiver <address>', 'Receiver address on Solana (OApp/OFT store)')
    .requiredOption('-c, --chain <chain>', 'Source chain name (ethereum, arbitrum, optimism, etc.)')
    .requiredOption('-s, --sender <address>', 'Sender address from source chain (0x... format)')
    .requiredOption('-n, --nonce <number>', 'Nonce to skip', parseInt)
    .option('-k, --keypair <path>', 'Path to Solana keypair file (default: ./keypair.json)')
    .option('-u, --url <url>', 'Solana RPC URL (default: mainnet-beta)')
    .option('--devnet', 'Use Solana devnet')
    .option('--testnet', 'Use Solana testnet')

program.parse(process.argv)
const options = program.opts()

/**
 * Main execution function that handles CLI parsing and executes the skip nonce operation
 */
async function main() {
    try {
        // Determine Solana RPC URL
        let rpcUrl = options.url || process.env.SOLANA_RPC_URL
        if (!rpcUrl) {
            if (options.devnet) {
                rpcUrl = 'https://api.devnet.solana.com'
                console.log('Using Solana devnet')
            } else if (options.testnet) {
                rpcUrl = 'https://api.testnet.solana.com'
                console.log('Using Solana testnet')
            } else {
                rpcUrl = 'https://api.mainnet-beta.solana.com'
                console.log('Using Solana mainnet-beta')
            }
        }

        // Load Solana keypair
        const keypairPath = options.keypair || process.env.SOLANA_KEYPAIR_PATH || './keypair.json'
        let payer: Keypair

        try {
            const keypairData = JSON.parse(readFileSync(keypairPath, 'utf-8'))
            payer = Keypair.fromSecretKey(new Uint8Array(keypairData))
        } catch (error) {
            throw new Error(
                `Failed to load Solana keypair from ${keypairPath}. Make sure the file exists and contains a valid Solana keypair.`
            )
        }

        // Create Solana connection
        const connection = new Connection(rpcUrl, {
            commitment: 'confirmed',
            confirmTransactionInitialTimeout: 60000,
        })

        // Test connection
        console.log('Testing Solana connection...')
        const version = await connection.getVersion()
        console.log(`Connected to Solana ${version['solana-core']}\n`)

        // Execute skip on Solana
        await skipNonceOnSolana(connection, payer, options.receiver, options.chain, options.sender, options.nonce)
    } catch (error: any) {
        console.error('\nFailed to skip nonce on Solana:', error.message)
        process.exit(1)
    }
}

// Export the main function for use in other modules
export { skipNonceOnSolana }

// Run the script if called directly
if (require.main === module) {
    main().catch(console.error)
}
