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

import { createHash } from 'crypto'
import { readFileSync } from 'fs'

import { createSignerFromKeypair, signerIdentity } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters'
import { Connection, Keypair, PublicKey, SendTransactionError, Transaction } from '@solana/web3.js'
import { Command } from 'commander'
import * as dotenv from 'dotenv'

import { EndpointProgram, NONCE_SEED } from '@layerzerolabs/lz-solana-sdk-v2'
import { addressToBytes32 } from '@layerzerolabs/lz-v2-utilities'
import { DATA_DMP } from '../dmp'

// Load environment variables
dotenv.config()

// LayerZero V2 endpoint program ID
// Use your custom endpoint for devnet/testnet
// const ENDPOINT_PROGRAM_ID = new PublicKey('4riW6rPYZoHjyA57eXVTbkMxYS3yw6hDr9zxVWsZQ4oF') // Your devnet endpoint
const ENDPOINT_PROGRAM_ID = new PublicKey('76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6') // Official LayerZero mainnet

const eid = 30168

async function skipNonceOnSolana(connection: Connection, payer: Keypair, nonceToSkip: number): Promise<string> {
    try {
        console.log('=== Skip Nonce on Solana ===\n')

        const matches = DATA_DMP.filter((d) => d.pathway.srcEid === eid && d.pathway.nonce === nonceToSkip)
        if (matches.length > 2 || matches.length === 0) {
            throw new Error(
                `Found ${matches.length} matches for EID ${eid} and nonce ${nonceToSkip}. Expected 0 or 1 match.`
            )
        }

        const match = matches[0]

        // const value =

        // Create UMI instance
        const umi = createUmi(connection.rpcEndpoint)
        const payerSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(payer))
        umi.use(signerIdentity(payerSigner))

        // Initialize LayerZero endpoint
        const endpoint = new EndpointProgram.Endpoint(ENDPOINT_PROGRAM_ID)

        // Convert addresses
        const destBytes = addressToBytes32(match.pathway.sender.address)
        const destinationPublicKey = new PublicKey(destBytes)

        // Create skip instruction
        console.log('\nCreating skip instruction...')

        const skipIx = await endpoint.skip(
            payer.publicKey,
            new PublicKey(match.pathway.sender.address),
            destinationPublicKey,
            eid,
            nonceToSkip.toString()
        )

        console.log(skipIx)

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
        let signature: string
        try {
            signature = await connection.sendTransaction(transaction, [payer], {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
                maxRetries: 3,
            })

            console.log(`Transaction sent: ${signature}`)
            console.log(`Explorer: https://solscan.io/tx/${signature}`)
        } catch (error) {
            if (error instanceof SendTransactionError) {
                console.error('\n❌ SendTransactionError occurred:')
                console.error(`Message: ${error.message}`)

                // Get detailed logs from the transaction error
                try {
                    const logs = await error.getLogs(connection)
                    console.error('\n📜 Transaction Logs:')
                    if (logs && logs.length > 0) {
                        logs.forEach((log, index) => {
                            console.error(`  ${index + 1}. ${log}`)
                        })
                    } else {
                        console.error('  No logs available')
                    }
                } catch (logError) {
                    console.error(`Failed to get transaction logs: ${logError}`)
                }

                // Try to extract signature from error message or use any available signature info
                let txSignature: string | null = null

                // Check if the error message contains a signature pattern
                const signatureMatch = error.message.match(/[1-9A-HJ-NP-Za-km-z]{87,88}/)
                if (signatureMatch) {
                    txSignature = signatureMatch[0]
                }

                if (txSignature) {
                    console.error(`\nFailed transaction signature: ${txSignature}`)
                    console.error(`Explorer: https://solscan.io/tx/${txSignature}`)
                } else {
                    console.error('\nNo transaction signature available in error')
                }
            }
            throw error
        }

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
        await skipNonceOnSolana(connection, payer, options.nonce)
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
