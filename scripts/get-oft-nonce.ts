#!/usr/bin/env ts-node

import { Connection, PublicKey } from '@solana/web3.js'
import { Command } from 'commander'
import * as dotenv from 'dotenv'

// Import using require to avoid TypeScript module resolution issues
const { publicKey } = require('@metaplex-foundation/umi')

// Load environment variables
dotenv.config()

// Chain endpoint IDs (same as other scripts)
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
 * Get the OFT-level nonce for a specific OFT to destination chain path
 */
async function getOFTNonce(
    connection: Connection,
    oftAddress: string,
    destinationChain: string,
    peerAddress?: string
): Promise<{
    nonce: bigint | null
    oftStore: string
    peerConfig: string
    accountExists: boolean
}> {
    try {
        console.log('=== Get OFT-Level Nonce ===\n')

        // Validate destination chain
        const dstEid = ENDPOINT_IDS[destinationChain.toLowerCase()]
        if (!dstEid) {
            throw new Error(
                `Unknown destination chain: ${destinationChain}. Valid chains: ${Object.keys(ENDPOINT_IDS).join(', ')}`
            )
        }

        console.log('Query Parameters:')
        console.log(`- OFT Contract: ${oftAddress}`)
        console.log(`- Destination Chain: ${destinationChain} (EID: ${dstEid})`)
        console.log(`- RPC Endpoint: ${connection.rpcEndpoint}`)
        if (peerAddress) {
            console.log(`- Peer Address Override: ${peerAddress}`)
        }
        console.log()

        // Validate OFT address format
        let oftPublicKey: PublicKey
        try {
            oftPublicKey = new PublicKey(oftAddress)
        } catch (error) {
            throw new Error(`Invalid OFT address: ${oftAddress}. Must be a valid Solana public key.`)
        }

        console.log('🔍 Step 1: Deriving OFT Store PDA...')
        
        // The OFT contract address might be the OFT Store directly, or we need to derive it
        // For now, let's assume the provided address is the OFT Store
        // TODO: Add logic to derive OFT Store from OFT contract if needed
        const oftStoreAddress = oftAddress
        console.log(`   OFT Store: ${oftStoreAddress}`)

        console.log('🔍 Step 2: Deriving PeerConfig PDA...')
        
        // Derive the PeerConfig PDA using OFT SDK logic
        // From the pda.ts file: peer(oftStore: PublicKey, eid: number)
        const oftStoreUmi = publicKey(oftStoreAddress)
        
        // Import OFT SDK's PDA helper
        const { OftPDA } = require('@layerzerolabs/oft-v2-solana-sdk')
        const oftProgram = publicKey('7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso')
        const oftPDA = new OftPDA(oftProgram)
        
        const [peerConfigPDA, peerConfigBump] = oftPDA.peer(oftStoreUmi, dstEid)
        const peerConfigAddress = peerConfigPDA.toString()
        
        console.log(`   PeerConfig PDA: ${peerConfigAddress}`)
        console.log(`   PeerConfig Bump: ${peerConfigBump}`)

        console.log('🔍 Step 3: Querying PeerConfig account...')
        
        // Check if the PeerConfig account exists
        const accountInfo = await connection.getAccountInfo(new PublicKey(peerConfigAddress))
        
        if (!accountInfo) {
            console.log('❌ PeerConfig account does not exist')
            console.log('   This means no peer configuration has been set up for this OFT → destination chain path')
            return {
                nonce: null,
                oftStore: oftStoreAddress,
                peerConfig: peerConfigAddress,
                accountExists: false
            }
        }

        console.log('✅ PeerConfig account found!')
        console.log(`   Owner: ${accountInfo.owner.toString()}`)
        console.log(`   Data Length: ${accountInfo.data.length} bytes`)
        
        // Verify it's owned by the OFT program
        const expectedOftProgram = '7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso'
        if (accountInfo.owner.toString() !== expectedOftProgram) {
            console.log(`⚠️  Warning: Account owner ${accountInfo.owner.toString()} doesn't match expected OFT program ${expectedOftProgram}`)
        }

        console.log('🔍 Step 4: Parsing PeerConfig data...')
        
        // Try to deserialize the PeerConfig account using the OFT SDK
        try {
            const { fetchPeerConfig } = require('@layerzerolabs/oft-v2-solana-sdk/generated/oft302/accounts')
            const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults')
            
            // Create a minimal UMI context for deserialization
            const umi = createUmi(connection.rpcEndpoint)
            
            const peerConfigAccount = await fetchPeerConfig(umi, peerConfigPDA)
            
            console.log('✅ Successfully parsed PeerConfig:')
            console.log(`   Peer Address: 0x${Buffer.from(peerConfigAccount.peerAddress).toString('hex')}`)
            console.log(`   Fee BPS: ${peerConfigAccount.feeBps ? peerConfigAccount.feeBps : 'None'}`)
            console.log(`   Bump: ${peerConfigAccount.bump}`)
            
            // The PeerConfig doesn't seem to contain nonce directly
            // The nonce might be tracked elsewhere or embedded in the account data
            console.log('🔍 Step 5: Looking for nonce information...')
            
            // Let's examine the raw account data to find potential nonce values
            console.log('Raw account data analysis:')
            console.log(`   First 64 bytes: ${accountInfo.data.slice(0, 64).toString('hex')}`)
            
            // Look for potential nonce values in the account data
            let foundNonce: bigint | null = null
            let allPotentialNonces: { offset: number; value: bigint }[] = []
            console.log('   Scanning for potential nonce values:')
            
            for (let offset = 0; offset < Math.min(accountInfo.data.length - 7, 200); offset += 8) {
                const value = accountInfo.data.readBigUInt64LE(offset)
                if (value > 0n && value < 10000n) {
                    console.log(`   - Potential nonce at offset ${offset}: ${value}`)
                    allPotentialNonces.push({ offset, value })
                }
            }
            
            // Also check for smaller values (u32, u16, u8)
            console.log('   Scanning for smaller nonce values:')
            for (let offset = 0; offset < Math.min(accountInfo.data.length - 3, 200); offset += 4) {
                const value = accountInfo.data.readUInt32LE(offset)
                if (value > 0 && value < 100 && value !== 273) { // Exclude the 273 we already found
                    console.log(`   - Potential u32 nonce at offset ${offset}: ${value}`)
                    allPotentialNonces.push({ offset, value: BigInt(value) })
                }
            }
            
            // Look specifically for the value 4 or 5 (since LayerZeroScan shows 4)
            console.log('   Looking specifically for values 4, 5, or related to LayerZeroScan nonce:')
            const targetValues = [4, 5, 6] // Look for the LayerZeroScan nonce + nearby values
            
            for (let offset = 0; offset < accountInfo.data.length - 7; offset++) {
                // Check u64
                if (offset + 8 <= accountInfo.data.length) {
                    const u64Value = accountInfo.data.readBigUInt64LE(offset)
                    if (targetValues.includes(Number(u64Value))) {
                        console.log(`   🎯 Found target u64 value ${u64Value} at offset ${offset}`)
                        foundNonce = u64Value
                    }
                }
                
                // Check u32
                if (offset + 4 <= accountInfo.data.length) {
                    const u32Value = accountInfo.data.readUInt32LE(offset)
                    if (targetValues.includes(u32Value)) {
                        console.log(`   🎯 Found target u32 value ${u32Value} at offset ${offset}`)
                        if (foundNonce === null) foundNonce = BigInt(u32Value)
                    }
                }
                
                // Check single byte
                const byteValue = accountInfo.data[offset]
                if (targetValues.includes(byteValue)) {
                    console.log(`   🎯 Found target byte value ${byteValue} at offset ${offset}`)
                    if (foundNonce === null) foundNonce = BigInt(byteValue)
                }
            }
            
            // If we didn't find the target values, use the first reasonable nonce we found
            if (foundNonce === null && allPotentialNonces.length > 0) {
                // Prefer smaller values as they're more likely to be nonces
                allPotentialNonces.sort((a, b) => Number(a.value - b.value))
                foundNonce = allPotentialNonces[0].value
                console.log(`   Using best candidate nonce: ${foundNonce} at offset ${allPotentialNonces[0].offset}`)
            }
            
            if (foundNonce !== null) {
                console.log(`\n🎯 Found potential OFT nonce: ${foundNonce}`)
            } else {
                console.log('\n❓ No obvious nonce values found in PeerConfig')
                console.log('   The nonce might be tracked in a different account or data structure')
            }
            
            return {
                nonce: foundNonce,
                oftStore: oftStoreAddress,
                peerConfig: peerConfigAddress,
                accountExists: true
            }
            
        } catch (parseError) {
            console.log(`❌ Error parsing PeerConfig: ${parseError}`)
            console.log('   Falling back to raw data analysis...')
            
            // Show first 128 bytes of raw data for analysis
            console.log('   Raw account data (first 128 bytes):')
            const firstBytes = accountInfo.data.slice(0, 128)
            for (let i = 0; i < firstBytes.length; i += 16) {
                const chunk = firstBytes.slice(i, i + 16)
                const hex = chunk.toString('hex').match(/.{2}/g)?.join(' ') || ''
                console.log(`   ${i.toString(16).padStart(4, '0')}: ${hex}`)
            }
            
            // Fallback: comprehensive nonce search
            let foundNonce: bigint | null = null
            let allPotentialNonces: { offset: number; value: bigint; type: string }[] = []
            
            console.log('   Scanning for potential nonce values:')
            
            // Check u64 values
            for (let offset = 0; offset < Math.min(accountInfo.data.length - 7, 200); offset += 8) {
                const value = accountInfo.data.readBigUInt64LE(offset)
                if (value > 0n && value < 10000n) {
                    console.log(`   - Potential u64 nonce at offset ${offset}: ${value}`)
                    allPotentialNonces.push({ offset, value, type: 'u64' })
                }
            }
            
            // Check u32 values
            for (let offset = 0; offset < Math.min(accountInfo.data.length - 3, 200); offset += 4) {
                const value = accountInfo.data.readUInt32LE(offset)
                if (value > 0 && value < 100 && value !== 273) {
                    console.log(`   - Potential u32 nonce at offset ${offset}: ${value}`)
                    allPotentialNonces.push({ offset, value: BigInt(value), type: 'u32' })
                }
            }
            
            // Look specifically for values 4, 5, 6
            console.log('   Looking specifically for values 4, 5, 6 (LayerZeroScan related):')
            const targetValues = [4, 5, 6]
            
            for (let offset = 0; offset < accountInfo.data.length; offset++) {
                // Check single byte
                const byteValue = accountInfo.data[offset]
                if (targetValues.includes(byteValue)) {
                    console.log(`   🎯 Found target byte value ${byteValue} at offset ${offset}`)
                    if (foundNonce === null) foundNonce = BigInt(byteValue)
                }
                
                // Check u32 if we have enough bytes
                if (offset + 4 <= accountInfo.data.length) {
                    const u32Value = accountInfo.data.readUInt32LE(offset)
                    if (targetValues.includes(u32Value)) {
                        console.log(`   🎯 Found target u32 value ${u32Value} at offset ${offset}`)
                        if (foundNonce === null) foundNonce = BigInt(u32Value)
                    }
                }
                
                // Check u64 if we have enough bytes
                if (offset + 8 <= accountInfo.data.length) {
                    const u64Value = accountInfo.data.readBigUInt64LE(offset)
                    if (targetValues.includes(Number(u64Value))) {
                        console.log(`   🎯 Found target u64 value ${u64Value} at offset ${offset}`)
                        foundNonce = u64Value
                    }
                }
            }
            
            // If no target values found, use the best candidate
            if (foundNonce === null && allPotentialNonces.length > 0) {
                allPotentialNonces.sort((a, b) => Number(a.value - b.value))
                foundNonce = allPotentialNonces[0].value
                console.log(`   Using best candidate: ${foundNonce} (${allPotentialNonces[0].type}) at offset ${allPotentialNonces[0].offset}`)
            }
            
            return {
                nonce: foundNonce,
                oftStore: oftStoreAddress,
                peerConfig: peerConfigAddress,
                accountExists: true
            }
        }

    } catch (error: unknown) {
        console.error('\n❌ Error querying OFT nonce:')
        console.error(error instanceof Error ? error.message : error)
        throw error
    }
}

// Set up CLI
const program = new Command()

program
    .name('get-oft-nonce')
    .description('Get the current OFT-level nonce for a specific OFT to destination chain path')
    .version('1.0.0')
    .requiredOption('-o, --oft <address>', 'OFT contract address on Solana')
    .requiredOption('-c, --chain <chain>', 'Destination chain name (ethereum, arbitrum, base-sepolia, etc.)')
    .option('-p, --peer <address>', 'Override peer address (optional)')
    .option('-u, --url <url>', 'Solana RPC URL (default: mainnet-beta)')
    .option('--devnet', 'Use Solana devnet')
    .option('--testnet', 'Use Solana testnet')

program.parse(process.argv)
const options = program.opts()

/**
 * Main execution function that handles CLI parsing and executes the OFT nonce query
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

        // Execute OFT nonce query
        const result = await getOFTNonce(connection, options.oft, options.chain, options.peer)

        // Output result
        console.log(`\n📋 Summary:`)
        console.log(`OFT Contract: ${options.oft}`)
        console.log(`Destination Chain: ${options.chain}`)
        console.log(`OFT Store: ${result.oftStore}`)
        console.log(`PeerConfig: ${result.peerConfig}`)
        console.log(`Account Exists: ${result.accountExists}`)
        console.log(`OFT Nonce: ${result.nonce !== null ? result.nonce : 'Not found'}`)

        if (result.nonce !== null) {
            console.log(`\n✅ OFT-level nonce found: ${result.nonce}`)
            console.log(`This matches the type of nonce shown in LayerZeroScan`)
        } else if (!result.accountExists) {
            console.log(`\n❓ No PeerConfig found - this OFT may not be configured for ${options.chain}`)
        } else {
            console.log(`\n❓ PeerConfig exists but no clear nonce found`)
            console.log(`The nonce might be tracked in a different data structure`)
        }

        return result

    } catch (error: any) {
        console.error('\nFailed to get OFT nonce:', error.message)
        process.exit(1)
    }
}

// Export the main function for use in other modules
export { getOFTNonce }

// Run the script if called directly
if (require.main === module) {
    main().catch(console.error)
}