#!/usr/bin/env ts-node

import { Connection, PublicKey } from '@solana/web3.js'
import { Command } from 'commander'
import * as dotenv from 'dotenv'

// Import using require to avoid TypeScript module resolution issues
const { publicKey } = require('@metaplex-foundation/umi')

const { EndpointPDA, fetchNonce, getEndpointProgramId } = require('@layerzerolabs/lz-solana-sdk-v2/umi')

// Load environment variables
dotenv.config()

// Chain endpoint IDs (same as skip-nonce.ts)
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
}

/**
 * Get the next expected nonce for a LayerZero message path on Solana
 */
async function getNextNonceOnSolana(
    connection: Connection,
    receiverAddress: string,
    sourceChain: string,
    senderAddress: string
): Promise<bigint> {
    try {
        console.log('=== Get Next Nonce on Solana ===\n')

        // Validate source chain
        const srcEid = ENDPOINT_IDS[sourceChain.toLowerCase()]
        if (!srcEid) {
            throw new Error(
                `Unknown source chain: ${sourceChain}. Valid chains: ${Object.keys(ENDPOINT_IDS).join(', ')}`
            )
        }

        console.log('Query Parameters:')
        console.log(`- Receiver (Solana): ${receiverAddress}`)
        console.log(`- Source Chain: ${sourceChain} (EID: ${srcEid})`)
        console.log(`- Sender: ${senderAddress}`)
        console.log(`- RPC Endpoint: ${connection.rpcEndpoint}\n`)

        // Validate receiver address format
        let receiverPublicKey: PublicKey
        try {
            receiverPublicKey = new PublicKey(receiverAddress)
        } catch (error) {
            throw new Error(`Invalid receiver address: ${receiverAddress}. Must be a valid Solana public key.`)
        }

        console.log('Querying next expected nonce...')

        // Get LayerZero endpoint program ID and create PDA helper
        // Use the correct endpoint program ID from anchor keys list
        const endpointProgramId = publicKey('4riW6rPYZoHjyA57eXVTbkMxYS3yw6hDr9zxVWsZQ4oF')
        const endpointPDA = new EndpointPDA(endpointProgramId)

        // Convert sender address to Uint8Array (32 bytes for LayerZero)
        let senderBytes: Uint8Array
        if (senderAddress.startsWith('0x')) {
            // Remove 0x prefix and convert hex to bytes, pad to 32 bytes
            const hexStr = senderAddress.slice(2).padStart(64, '0')
            senderBytes = new Uint8Array(Buffer.from(hexStr, 'hex'))
        } else {
            throw new Error('Sender address must be in 0x hex format for non-Solana chains')
        }

        // Convert receiver to UMI format and derive the nonce account PDA
        const receiverUmi = publicKey(receiverAddress)
        const nonceAccountPDA = endpointPDA.nonce(receiverUmi, srcEid, senderBytes)
        console.log('Nonce account PDA:', nonceAccountPDA[0].toString())

        // Query the nonce account directly
        let expectedNonce: bigint
        try {
            const nonceAccount = await fetchNonce(connection, nonceAccountPDA[0], 'confirmed')
            expectedNonce = nonceAccount ? nonceAccount.outboundNonce : BigInt(0)
        } catch (accountError) {
            // If account doesn't exist, nonce is 0 (first message)
            console.log('Nonce account not found, assuming first message (nonce 0)')
            expectedNonce = BigInt(0)
        }

        console.log(`\n✅ Next expected nonce: ${expectedNonce}`)
        console.log(`\nThis means:`)
        console.log(`- The receiver is expecting nonce ${expectedNonce} next`)
        if (expectedNonce > BigInt(0)) {
            console.log(`- All nonces 0 to ${expectedNonce - BigInt(1)} have been processed or skipped`)
        } else {
            console.log(`- This is the first message from this source chain/sender`)
        }

        return expectedNonce
    } catch (error: unknown) {
        console.error('\n❌ Error querying nonce on Solana:')
        console.error(error instanceof Error ? error.message : error)

        // Provide helpful error messages specific to Solana
        if (
            (error instanceof Error && error.message?.includes('Account not found')) ||
            (error instanceof Error && error.message?.includes('Account does not exist'))
        ) {
            console.error('\n💡 Solana-specific tips:')
            console.error('- This could mean no messages have been sent from this source chain/sender yet')
            console.error('- The receiver address might be incorrect')
            console.error('- This would be the first message (nonce 0) for this path')
        } else if (error instanceof Error && error.message?.includes('Invalid receiver address')) {
            console.error('\n💡 Address format issue:')
            console.error('- Make sure the receiver address is a valid Solana public key')
            console.error('- Solana addresses are base58 encoded and ~44 characters long')
        } else if (error instanceof Error && error.message?.includes('RPC')) {
            console.error('\n💡 Connection issue:')
            console.error('- Check your RPC URL is correct and accessible')
            console.error('- Try using a different RPC endpoint')
        }

        throw error
    }
}

// Set up CLI
const program = new Command()

program
    .name('get-nonce')
    .description('Get the next expected nonce for a LayerZero message path on Solana')
    .version('1.0.0')
    .requiredOption('-r, --receiver <address>', 'Receiver address on Solana (OApp/OFT store)')
    .requiredOption('-c, --chain <chain>', 'Source chain name (ethereum, arbitrum, optimism, etc.)')
    .requiredOption('-s, --sender <address>', 'Sender address from source chain (0x... format)')
    .option('-u, --url <url>', 'Solana RPC URL (default: mainnet-beta)')
    .option('--devnet', 'Use Solana devnet')
    .option('--testnet', 'Use Solana testnet')

program.parse(process.argv)
const options = program.opts()

/**
 * Main execution function that handles CLI parsing and executes the nonce query
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

        // Create Solana connection (read-only, no keypair needed)
        const connection = new Connection(rpcUrl, {
            commitment: 'confirmed',
            confirmTransactionInitialTimeout: 60000,
        })

        // Test connection
        console.log('Testing Solana connection...')
        const version = await connection.getVersion()
        console.log(`Connected to Solana ${version['solana-core']}\n`)

        // Execute nonce query on Solana
        const nonce = await getNextNonceOnSolana(connection, options.receiver, options.chain, options.sender)

        // Output result in a format that can be easily parsed by other scripts
        console.log(`\n📋 Summary:`)
        console.log(`Receiver: ${options.receiver}`)
        console.log(`Source Chain: ${options.chain}`)
        console.log(`Sender: ${options.sender}`)
        console.log(`Next Nonce: ${nonce}`)

        return nonce
    } catch (error: any) {
        console.error('\nFailed to get nonce on Solana:', error.message)
        process.exit(1)
    }
}

// Export the main function for use in other modules
export { getNextNonceOnSolana }

// Run the script if called directly
if (require.main === module) {
    main().catch(console.error)
}
