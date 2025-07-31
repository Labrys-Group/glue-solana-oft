#!/usr/bin/env ts-node

import { Connection, PublicKey } from '@solana/web3.js'
import { Command } from 'commander'
import * as dotenv from 'dotenv'

// Import using require to avoid TypeScript module resolution issues
const { publicKey } = require('@metaplex-foundation/umi')

const { EndpointPDA, fetchNonce, getEndpointProgramId } = require('@layerzerolabs/lz-solana-sdk-v2/umi')

// Load environment variables
dotenv.config()

// Destination chain endpoint IDs (for Solana -> other chains)
const DESTINATION_ENDPOINT_IDS: Record<string, number> = {
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

// Solana endpoint IDs (for reference, but we always query on Solana)
const SOLANA_ENDPOINT_IDS = {
    mainnet: 40168,
    testnet: 40245,
    devnet: 40245, // Same as testnet
}

/**
 * Get the next expected nonce for messages FROM Solana TO other chains
 */
async function getNextNonceFromSolana(
    connection: Connection,
    senderAddress: string,
    destinationChain: string,
    receiverAddress: string
): Promise<bigint> {
    try {
        console.log('=== Get Next Nonce FROM Solana ===\n')

        // Validate destination chain
        const dstEid = DESTINATION_ENDPOINT_IDS[destinationChain.toLowerCase()]
        if (!dstEid) {
            throw new Error(
                `Unknown destination chain: ${destinationChain}. Valid chains: ${Object.keys(DESTINATION_ENDPOINT_IDS).join(', ')}`
            )
        }

        console.log('Query Parameters:')
        console.log(`- Sender (Solana): ${senderAddress}`)
        console.log(`- Destination Chain: ${destinationChain} (EID: ${dstEid})`)
        console.log(`- Receiver: ${receiverAddress}`)
        console.log(`- RPC Endpoint: ${connection.rpcEndpoint}\n`)

        // Validate sender address format (Solana)
        let senderPublicKey: PublicKey
        try {
            senderPublicKey = new PublicKey(senderAddress)
        } catch (error) {
            throw new Error(`Invalid sender address: ${senderAddress}. Must be a valid Solana public key.`)
        }

        // Validate receiver address format (EVM-style for most chains)
        if (!receiverAddress.startsWith('0x') || receiverAddress.length !== 42) {
            throw new Error(
                `Invalid receiver address: ${receiverAddress}. Must be a valid EVM address (0x... format, 42 characters).`
            )
        }

        console.log('Querying next expected nonce...')

        // Get LayerZero endpoint program ID and create PDA helper
        // Use the correct endpoint program ID from anchor keys list
        const endpointProgramId = publicKey('4riW6rPYZoHjyA57eXVTbkMxYS3yw6hDr9zxVWsZQ4oF')
        const endpointPDA = new EndpointPDA(endpointProgramId)

        // Convert receiver address to Uint8Array (32 bytes for LayerZero)
        let receiverBytes: Uint8Array
        if (receiverAddress.startsWith('0x')) {
            // Remove 0x prefix and convert hex to bytes, pad to 32 bytes
            const hexStr = receiverAddress.slice(2).padStart(64, '0')
            receiverBytes = new Uint8Array(Buffer.from(hexStr, 'hex'))
            console.log('🔧 DEBUG: Receiver address conversion:')
            console.log('   - Original:', receiverAddress)
            console.log('   - Hex (padded):', hexStr)
            console.log('   - Bytes length:', receiverBytes.length)
            console.log('   - Bytes (first 8):', Array.from(receiverBytes.slice(0, 8)))
        } else {
            throw new Error('Receiver address must be in 0x hex format for EVM chains')
        }

        // Convert sender to UMI format and derive the nonce account PDA
        // For reverse direction: sender=Solana, dstEid=destination chain, receiver=destination address
        const senderUmi = publicKey(senderAddress)
        console.log('🔧 DEBUG: PDA derivation parameters:')
        console.log('   - Sender (Solana):', senderAddress)
        console.log('   - Sender UMI format:', senderUmi.toString())
        console.log('   - Destination EID:', dstEid)
        console.log('   - Receiver bytes length:', receiverBytes.length)
        console.log('   - Endpoint program ID:', endpointProgramId.toString())

        const nonceAccountPDA = endpointPDA.nonce(senderUmi, dstEid, receiverBytes)
        console.log('🎯 DEBUG: Derived nonce account PDA:', nonceAccountPDA[0].toString())
        console.log('🎯 DEBUG: PDA bump:', nonceAccountPDA[1])

        // Query the outbound nonce account directly using fetchNonce
        let expectedNonce: bigint
        try {
            console.log('🔍 DEBUG: Attempting to fetch nonce account...')
            const nonceAccount = await fetchNonce(connection, nonceAccountPDA[0], 'confirmed')

            if (nonceAccount) {
                console.log('✅ DEBUG: Nonce account found!')
                console.log('📊 DEBUG: Account data structure:')
                console.log('   - outboundNonce:', nonceAccount.outboundNonce?.toString())
                console.log(
                    '   - Full account data:',
                    JSON.stringify(
                        nonceAccount,
                        (key, value) => (typeof value === 'bigint' ? value.toString() : value),
                        2
                    )
                )

                expectedNonce = nonceAccount.outboundNonce || BigInt(0)
                console.log('📈 DEBUG: Using outboundNonce:', expectedNonce.toString())
            } else {
                console.log('❌ DEBUG: fetchNonce returned null')
                expectedNonce = BigInt(0)
            }
        } catch (accountError) {
            console.log('💥 DEBUG: fetchNonce failed:', accountError)

            // Fallback: try to get raw account data to see if account exists
            try {
                console.log('🔍 DEBUG: Checking raw account with getAccountInfo...')
                const rawAccount = await connection.getAccountInfo(new PublicKey(nonceAccountPDA[0].toString()))
                if (rawAccount) {
                    console.log('✅ DEBUG: Raw PDA account exists!')
                    console.log('   - Owner:', rawAccount.owner.toString())
                    console.log('   - Data length:', rawAccount.data.length)
                    console.log('   - Lamports:', rawAccount.lamports)
                    console.log('   - Data (hex):', rawAccount.data.toString('hex'))

                    // Try to manually parse the account data
                    // LayerZero nonce accounts typically have the nonce as a u64 at some offset
                    if (rawAccount.data.length >= 8) {
                        console.log('   - Trying to parse nonce from raw data...')
                        // Try reading u64 at different offsets
                        for (let offset = 0; offset <= rawAccount.data.length - 8; offset += 8) {
                            const nonce = rawAccount.data.readBigUInt64LE(offset)
                            console.log(`   - Potential nonce at offset ${offset}: ${nonce}`)
                        }
                        // Use the most likely nonce (often at offset 8 after discriminator)
                        expectedNonce = rawAccount.data.readBigUInt64LE(8)
                        console.log('📈 DEBUG: Using parsed nonce from offset 8:', expectedNonce.toString())
                    } else {
                        expectedNonce = BigInt(0)
                    }
                } else {
                    console.log('❌ DEBUG: Raw PDA account does not exist')
                    expectedNonce = BigInt(0)
                }
            } catch (rawError) {
                console.log('💥 DEBUG: Error getting raw account:', rawError)
                expectedNonce = BigInt(0)
            }
        }

        console.log(`\n✅ Next expected nonce: ${expectedNonce}`)
        console.log(`\nThis means:`)
        console.log(`- The next message FROM Solana will use nonce ${expectedNonce}`)
        if (expectedNonce > BigInt(0)) {
            console.log(`- All nonces 0 to ${expectedNonce - BigInt(1)} have been sent or skipped from Solana`)
        } else {
            console.log(`- This would be the first message sent from Solana to this destination`)
        }

        return expectedNonce
    } catch (error: unknown) {
        console.error('\n❌ Error querying nonce FROM Solana:')
        console.error(error instanceof Error ? error.message : error)

        // Provide helpful error messages specific to reverse direction
        if (
            (error instanceof Error && error.message?.includes('Account not found')) ||
            (error instanceof Error && error.message?.includes('Account does not exist'))
        ) {
            console.error('\n💡 Reverse direction tips:')
            console.error('- This could mean no messages have been sent FROM this Solana sender yet')
            console.error('- The sender address might be incorrect')
            console.error('- This would be the first message (nonce 0) from Solana to destination')
        } else if (error instanceof Error && error.message?.includes('Invalid sender address')) {
            console.error('\n💡 Sender address format issue:')
            console.error('- Make sure the sender address is a valid Solana public key')
            console.error('- Solana addresses are base58 encoded and ~44 characters long')
        } else if (error instanceof Error && error.message?.includes('Invalid receiver address')) {
            console.error('\n💡 Receiver address format issue:')
            console.error('- Make sure the receiver address is a valid EVM address')
            console.error('- EVM addresses start with 0x and are 42 characters long')
        } else if (error instanceof Error && error.message?.includes('RPC')) {
            console.error('\n💡 Connection issue:')
            console.error('- Check your Solana RPC URL is correct and accessible')
            console.error('- Try using a different RPC endpoint')
        }

        throw error
    }
}

// Set up CLI
const program = new Command()

program
    .name('get-nonce-reverse')
    .description('Get the next expected nonce for messages FROM Solana TO other chains')
    .version('1.0.0')
    .requiredOption('-s, --sender <address>', 'Sender address on Solana (OApp/OFT contract)')
    .requiredOption('-c, --chain <chain>', 'Destination chain name (ethereum, arbitrum, base, etc.)')
    .requiredOption('-r, --receiver <address>', 'Receiver address on destination chain (0x... format)')
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
        // Determine Solana RPC URL (always query Solana for reverse direction)
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

        // Execute nonce query FROM Solana
        const nonce = await getNextNonceFromSolana(connection, options.sender, options.chain, options.receiver)

        // Output result in a format that can be easily parsed by other scripts
        console.log(`\n📋 Summary:`)
        console.log(`Sender (Solana): ${options.sender}`)
        console.log(`Destination Chain: ${options.chain}`)
        console.log(`Receiver: ${options.receiver}`)
        console.log(`Next Nonce: ${nonce}`)

        return nonce
    } catch (error: any) {
        console.error('\nFailed to get nonce FROM Solana:', error.message)
        process.exit(1)
    }
}

// Export the main function for use in other modules
export { getNextNonceFromSolana }

// Run the script if called directly
if (require.main === module) {
    main().catch(console.error)
}
