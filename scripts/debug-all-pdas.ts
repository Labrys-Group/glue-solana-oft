#!/usr/bin/env ts-node

import * as dotenv from 'dotenv'

// Import using require to avoid TypeScript module resolution issues
const { publicKey } = require('@metaplex-foundation/umi')
const { EndpointPDA, MessageLibPDA } = require('@layerzerolabs/lz-solana-sdk-v2/umi')

// Load environment variables
dotenv.config()

// Known values from LayerZeroScan and transaction
const TARGET_ACCOUNT = 'B1ymdhBQKyBJvzhpnbTtRSctwd6LvoytT7GWhBakmjTQ'
const RECEIVER_ADDRESS = '0xaaC5842E11637C188aA34655B98918FeCd615fEe'
const BASE_SEPOLIA_EID = 40245

// All addresses from the transaction
const TRANSACTION_ADDRESSES = [
    'HcMLwhXXhSpfm2yqAJzc2EGhDf6ZwvqYUXXdRNUwJZtC', // Wallet (fee payer)
    '36UH5YRWZnrR41SuD91zWmNp8zdEKMW9yDR3vyxpH5uQ', // OFT Store
    'FWKKPPBqvp257o6Hac85KuNsY1j534xTXdNbYvxLPvu',   
    '77nWZGxybF7GCqu5vd8Rti22gLsd72ktSXb7BCAw7aNx',   
    'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',   
    'AynU5abfcLKiXLAHx8yBJ9kVAkNUBoNHKZF3Cu3JYE3C',   
]

/**
 * Test all possible PDA types that could match the target account
 */
async function testAllPDATypes() {
    console.log('=== Debug All LayerZero PDA Types ===\n')
    console.log(`Target account: ${TARGET_ACCOUNT}`)
    console.log()

    // Convert receiver to 32-byte format
    let receiverBytes: Uint8Array
    if (RECEIVER_ADDRESS.startsWith('0x')) {
        const hexStr = RECEIVER_ADDRESS.slice(2).padStart(64, '0')
        receiverBytes = new Uint8Array(Buffer.from(hexStr, 'hex'))
    } else {
        throw new Error('Receiver address must be in 0x hex format')
    }

    // LayerZero endpoint program ID
    const endpointProgramId = publicKey('7aJdnmHwaRWU4E9Fz5dREB8XiwDDxb4Jz3E2FvjGRnso')
    const endpointPDA = new EndpointPDA(endpointProgramId)

    let foundMatch = false

    // Test different PDA types
    console.log('🔍 Testing EndpointPDA types...\n')

    // 1. Test setting (global endpoint config)
    try {
        const settingPDA = endpointPDA.setting()
        if (settingPDA[0].toString() === TARGET_ACCOUNT) {
            console.log('✅ MATCH: Endpoint Settings PDA')
            foundMatch = true
        } else {
            console.log(`❌ Endpoint Settings: ${settingPDA[0].toString()}`)
        }
    } catch (error) {
        console.log(`❌ Error testing Endpoint Settings: ${error}`)
    }

    // 2. Test send library configs
    for (const sender of TRANSACTION_ADDRESSES) {
        try {
            const senderUmi = publicKey(sender)
            const sendLibConfigPDA = endpointPDA.sendLibraryConfig(senderUmi, BASE_SEPOLIA_EID)
            if (sendLibConfigPDA[0].toString() === TARGET_ACCOUNT) {
                console.log(`✅ MATCH: Send Library Config PDA for sender ${sender}`)
                foundMatch = true
                break
            } else {
                console.log(`❌ Send Library Config (${sender.slice(0,8)}...): ${sendLibConfigPDA[0].toString()}`)
            }
        } catch (error) {
            console.log(`❌ Error testing Send Library Config for ${sender}: ${error}`)
        }
    }

    // 3. Test default send library config
    try {
        const defaultSendLibConfigPDA = endpointPDA.defaultSendLibraryConfig(BASE_SEPOLIA_EID)
        if (defaultSendLibConfigPDA[0].toString() === TARGET_ACCOUNT) {
            console.log('✅ MATCH: Default Send Library Config PDA')
            foundMatch = true
        } else {
            console.log(`❌ Default Send Library Config: ${defaultSendLibConfigPDA[0].toString()}`)
        }
    } catch (error) {
        console.log(`❌ Error testing Default Send Library Config: ${error}`)
    }

    // 4. Test receive library configs  
    for (const receiver of TRANSACTION_ADDRESSES) {
        try {
            const receiverUmi = publicKey(receiver)
            const receiveLibConfigPDA = endpointPDA.receiveLibraryConfig(receiverUmi, BASE_SEPOLIA_EID)
            if (receiveLibConfigPDA[0].toString() === TARGET_ACCOUNT) {
                console.log(`✅ MATCH: Receive Library Config PDA for receiver ${receiver}`)
                foundMatch = true
                break
            } else {
                console.log(`❌ Receive Library Config (${receiver.slice(0,8)}...): ${receiveLibConfigPDA[0].toString()}`)
            }
        } catch (error) {
            console.log(`❌ Error testing Receive Library Config for ${receiver}: ${error}`)
        }
    }

    // 5. Test default receive library config
    try {
        const defaultReceiveLibConfigPDA = endpointPDA.defaultReceiveLibraryConfig(BASE_SEPOLIA_EID)
        if (defaultReceiveLibConfigPDA[0].toString() === TARGET_ACCOUNT) {
            console.log('✅ MATCH: Default Receive Library Config PDA')
            foundMatch = true
        } else {
            console.log(`❌ Default Receive Library Config: ${defaultReceiveLibConfigPDA[0].toString()}`)
        }
    } catch (error) {
        console.log(`❌ Error testing Default Receive Library Config: ${error}`)
    }

    // 6. Test OApp registries
    for (const oapp of TRANSACTION_ADDRESSES) {
        try {
            const oappUmi = publicKey(oapp)
            const oappRegistryPDA = endpointPDA.oappRegistry(oappUmi)
            if (oappRegistryPDA[0].toString() === TARGET_ACCOUNT) {
                console.log(`✅ MATCH: OApp Registry PDA for ${oapp}`)
                foundMatch = true
                break
            } else {
                console.log(`❌ OApp Registry (${oapp.slice(0,8)}...): ${oappRegistryPDA[0].toString()}`)
            }
        } catch (error) {
            console.log(`❌ Error testing OApp Registry for ${oapp}: ${error}`)
        }
    }

    // 7. Test message library info accounts
    console.log('\n🔍 Testing MessageLib PDA types...\n')
    
    // Common message library program IDs (you might need to find the actual ones used)
    const commonMsgLibPrograms = [
        'BsVCLFmzgj18gV8RdMDGn1BQEQ8LmUtbYdKP46c97qc7', // Example ULN program
        '76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6', // From transaction logs
        '7a4WjyR8VZ7yZz5XJAKm39BUGn5iT9CKcv2pmG9tdXVH', // From transaction logs
    ]

    for (const msgLibProgram of commonMsgLibPrograms) {
        try {
            const msgLibUmi = publicKey(msgLibProgram)
            const messageLibPDA = new MessageLibPDA(msgLibUmi)
            const msgLibInfo = endpointPDA.messageLibraryInfo(messageLibPDA.messageLib()[0])
            
            if (msgLibInfo[0].toString() === TARGET_ACCOUNT) {
                console.log(`✅ MATCH: Message Library Info PDA for program ${msgLibProgram}`)
                foundMatch = true
                break
            } else {
                console.log(`❌ Message Library Info (${msgLibProgram.slice(0,8)}...): ${msgLibInfo[0].toString()}`)
            }
        } catch (error) {
            console.log(`❌ Error testing Message Library Info for ${msgLibProgram}: ${error}`)
        }
    }

    // 8. Test payload hash accounts (for different nonces)
    console.log('\n🔍 Testing PayloadHash PDAs for different nonces...\n')
    
    // Try nonces 0-10 to see if any match
    for (let nonce = 0; nonce <= 10; nonce++) {
        for (const receiver of TRANSACTION_ADDRESSES.slice(0, 3)) { // Test first few addresses
            try {
                const receiverUmi = publicKey(receiver)
                const payloadHashPDA = endpointPDA.payloadHash(receiverUmi, BASE_SEPOLIA_EID, receiverBytes, nonce)
                
                if (payloadHashPDA[0].toString() === TARGET_ACCOUNT) {
                    console.log(`✅ MATCH: Payload Hash PDA for receiver ${receiver}, nonce ${nonce}`)
                    foundMatch = true
                    break
                } else if (nonce === 4) {
                    // Only log nonce 4 to avoid spam
                    console.log(`❌ Payload Hash (${receiver.slice(0,8)}..., nonce ${nonce}): ${payloadHashPDA[0].toString()}`)
                }
            } catch (error) {
                if (nonce === 4) {
                    console.log(`❌ Error testing Payload Hash for ${receiver}, nonce ${nonce}: ${error}`)
                }
            }
        }
        if (foundMatch) break
    }

    if (!foundMatch) {
        console.log('\n❌ Target account does not match any known LayerZero PDA patterns')
        console.log('This account might be:')
        console.log('- A different type of LayerZero account not covered here')
        console.log('- Derived with parameters we haven\'t tested')
        console.log('- Not a LayerZero PDA at all (could be from a different program)')
    }

    return foundMatch
}

/**
 * Main execution function
 */
async function main() {
    try {
        await testAllPDATypes()
    } catch (error: any) {
        console.error('Error:', error.message)
        process.exit(1)
    }
}

// Run the script if called directly
if (require.main === module) {
    main().catch(console.error)
}