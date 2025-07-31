#!/usr/bin/env ts-node

import { Connection, PublicKey } from '@solana/web3.js'
import { Command } from 'commander'
import * as dotenv from 'dotenv'

import { NONCE_SEED } from '@layerzerolabs/lz-solana-sdk-v2'
import { addressToBytes32 } from '@layerzerolabs/lz-v2-utilities'

// Load environment variables
dotenv.config()

// LayerZero V2 endpoint program ID
// Use your custom endpoint for devnet/testnet
// const ENDPOINT_PROGRAM_ID = new PublicKey('4riW6rPYZoHjyA57eXVTbkMxYS3yw6hDr9zxVWsZQ4oF') // Your devnet endpoint
const ENDPOINT_PROGRAM_ID = new PublicKey('76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6') // Official LayerZero mainnet

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

/**
 * Check the current nonce state for a LayerZero message path on Solana
 * This function is based on the checkCurrentNonce method from skip-nonce.ts
 */
async function checkCurrentNonce(
    connection: Connection,
    receiverAddress: string,
    sourceChain: string,
    senderAddress: string
): Promise<{ inboundNonce: number | null; outboundNonce: number | null; exists: boolean }> {
    try {
        const srcEid = ENDPOINT_IDS[sourceChain.toLowerCase()]
        if (!srcEid) {
            throw new Error(`Unknown source chain: ${sourceChain}`)
        }

        // Convert addresses to the format needed for PDA derivation
        const senderBytes = addressToBytes32(senderAddress)
        const receiverPublicKey = new PublicKey(receiverAddress)

        // Derive the nonce PDA using LayerZero's pattern
        const seeds = [
            Buffer.from(NONCE_SEED, 'utf8'),
            receiverPublicKey.toBuffer(),
            Buffer.from(new Uint32Array([srcEid]).buffer).reverse(), // Big endian u32
            Buffer.from(senderBytes),
        ]

        // Find the PDA using the endpoint program
        const [noncePDA] = PublicKey.findProgramAddressSync(seeds, ENDPOINT_PROGRAM_ID)

        console.log(`Checking nonce PDA: ${noncePDA.toBase58()}`)

        // Try to fetch the nonce account
        const accountInfo = await connection.getAccountInfo(noncePDA)
        if (!accountInfo) {
            return { inboundNonce: null, outboundNonce: null, exists: false }
        }

        // Parse the account data manually
        // Nonce account structure: [discriminator: 8 bytes, bump: 1 byte, outbound: 8 bytes, inbound: 8 bytes]
        const data = accountInfo.data
        if (data.length < 25) {
            console.warn('Account data too short to be a nonce account')
            return { inboundNonce: null, outboundNonce: null, exists: false }
        }

        // Skip discriminator (8 bytes) and bump (1 byte), then read the nonces
        const outboundNonce = Number(data.readBigUInt64LE(9)) // bytes 9-16
        const inboundNonce = Number(data.readBigUInt64LE(17)) // bytes 17-24

        return {
            inboundNonce,
            outboundNonce,
            exists: true,
        }
    } catch (error: any) {
        if (error.message?.includes('Unable to find Nonce account')) {
            return { inboundNonce: null, outboundNonce: null, exists: false }
        }
        console.warn(`Warning: Failed to check nonce: ${error.message}`)
        return { inboundNonce: null, outboundNonce: null, exists: false }
    }
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
        try {
            new PublicKey(receiverAddress)
        } catch (error) {
            throw new Error(`Invalid receiver address: ${receiverAddress}. Must be a valid Solana public key.`)
        }

        console.log('Querying current nonce state...')

        // Use the checkCurrentNonce method to get nonce information
        const nonceResult = await checkCurrentNonce(connection, receiverAddress, sourceChain, senderAddress)
        
        let expectedNonce: bigint
        if (!nonceResult.exists) {
            console.log('Nonce account does not exist yet - next nonce will be 0')
            expectedNonce = BigInt(0)
        } else {
            // Account exists, use the inbound nonce as the next expected nonce
            expectedNonce = BigInt(nonceResult.inboundNonce || 0)
            console.log(`Current inbound nonce: ${nonceResult.inboundNonce}`)
            console.log(`Current outbound nonce: ${nonceResult.outboundNonce}`)
        }

        console.log(`\nNext expected nonce: ${expectedNonce}`)
        return expectedNonce
    } catch (error: any) {
        console.error('Error getting next nonce:', error.message)
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

// Export the functions for use in other modules
export { getNextNonceOnSolana, checkCurrentNonce }

// Run the script if called directly
if (require.main === module) {
    main().catch(console.error)
}
