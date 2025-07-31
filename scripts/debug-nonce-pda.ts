#!/usr/bin/env ts-node

import { Connection, PublicKey } from '@solana/web3.js'
import * as dotenv from 'dotenv'

// Import using require to avoid TypeScript module resolution issues
const { publicKey } = require('@metaplex-foundation/umi')
const { EndpointPDA } = require('@layerzerolabs/lz-solana-sdk-v2/umi')

// Load environment variables
dotenv.config()

// Known values from LayerZeroScan and transaction
const TARGET_ACCOUNT = 'B1ymdhBQKyBJvzhpnbTtRSctwd6LvoytT7GWhBakmjTQ'
const RECEIVER_ADDRESS = '0xaaC5842E11637C188aA34655B98918FeCd615fEe'
const BASE_SEPOLIA_EID = 40245

// All addresses from the transaction that could be potential senders
const TRANSACTION_ADDRESSES = [
    'HcMLwhXXhSpfm2yqAJzc2EGhDf6ZwvqYUXXdRNUwJZtC', // Wallet (fee payer)
    'B1ymdhBQKyBJvzhpnbTtRSctwd6LvoytT7GWhBakmjTQ', // Target account (unlikely but test anyway)
    '36UH5YRWZnrR41SuD91zWmNp8zdEKMW9yDR3vyxpH5uQ', // OFT Store
    'FWKKPPBqvp257o6Hac85KuNsY1j534xTXdNbYvxLPvu',   // Another account from tx
    '77nWZGxybF7GCqu5vd8Rti22gLsd72ktSXb7BCAw7aNx',   // Another account from tx
    'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',   // Another account from tx
    'AynU5abfcLKiXLAHx8yBJ9kVAkNUBoNHKZF3Cu3JYE3C',   // Another account from tx
]

/**
 * Test PDA derivation with different sender addresses to find which one matches the target
 */
async function testPDADerivations() {
    console.log('=== Debug PDA Derivations ===\n')
    console.log(`Target account from transaction: ${TARGET_ACCOUNT}`)
    console.log(`Receiver address: ${RECEIVER_ADDRESS}`)
    console.log(`Destination EID: ${BASE_SEPOLIA_EID}`)
    console.log()

    // Convert receiver to 32-byte format
    let receiverBytes: Uint8Array
    if (RECEIVER_ADDRESS.startsWith('0x')) {
        const hexStr = RECEIVER_ADDRESS.slice(2).padStart(64, '0')
        receiverBytes = new Uint8Array(Buffer.from(hexStr, 'hex'))
    } else {
        throw new Error('Receiver address must be in 0x hex format')
    }

    // LayerZero endpoint program ID (correct one from anchor keys list)
    const endpointProgramId = publicKey('4riW6rPYZoHjyA57eXVTbkMxYS3yw6hDr9zxVWsZQ4oF')
    const endpointPDA = new EndpointPDA(endpointProgramId)

    console.log('Testing different sender addresses from transaction:')
    console.log()

    let foundMatch = false

    for (const senderAddress of TRANSACTION_ADDRESSES) {
        try {
            // Convert sender to UMI format
            const senderUmi = publicKey(senderAddress)
            
            // Derive nonce PDA
            const nonceAccountPDA = endpointPDA.nonce(senderUmi, BASE_SEPOLIA_EID, receiverBytes)
            const derivedAddress = nonceAccountPDA[0].toString()
            const isMatch = derivedAddress === TARGET_ACCOUNT

            console.log(`📍 Sender: ${senderAddress}`)
            console.log(`   Derived PDA: ${derivedAddress}`)
            console.log(`   Bump: ${nonceAccountPDA[1]}`)
            console.log(`   Match: ${isMatch ? '✅ YES!' : '❌ No'}`)
            
            if (isMatch) {
                foundMatch = true
                console.log(`\n🎯 FOUND MATCH!`)
                console.log(`   The correct sender for LayerZero nonce queries is: ${senderAddress}`)
                
                // Test querying this account
                const connection = new Connection('https://devnet.helius-rpc.com/?api-key=d28d2d41-6bbe-4a85-846a-720e7beeb1af', 'confirmed')
                
                try {
                    console.log(`\n🔍 Checking account data...`)
                    const accountInfo = await connection.getAccountInfo(new PublicKey(derivedAddress))
                    
                    if (accountInfo) {
                        console.log(`   Account exists: ✅`)
                        console.log(`   Owner: ${accountInfo.owner.toString()}`)
                        console.log(`   Data length: ${accountInfo.data.length}`)
                        
                        // Try to find nonce value in the account data
                        console.log(`   Looking for nonce values...`)
                        for (let offset = 0; offset < Math.min(accountInfo.data.length - 7, 64); offset += 8) {
                            const value = accountInfo.data.readBigUInt64LE(offset)
                            if (value > 0n && value < 1000n) {
                                console.log(`   Potential nonce at offset ${offset}: ${value}`)
                            }
                        }
                    } else {
                        console.log(`   Account exists: ❌`)
                    }
                } catch (error) {
                    console.log(`   Error checking account: ${error}`)
                }
            }
            console.log()
        } catch (error) {
            console.log(`❌ Error testing ${senderAddress}: ${error}`)
            console.log()
        }
    }

    if (!foundMatch) {
        console.log('❌ No matching PDA found among transaction addresses')
        console.log('\nThe account might be derived with different parameters or additional addresses not in the transaction')
    }

    return foundMatch
}

/**
 * Main execution function
 */
async function main() {
    try {
        await testPDADerivations()
    } catch (error: any) {
        console.error('Error:', error.message)
        process.exit(1)
    }
}

// Run the script if called directly
if (require.main === module) {
    main().catch(console.error)
}