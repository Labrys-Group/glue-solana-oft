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

import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes'
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

// LayerZero constants
const PENDING_NONCE_SEED = 'PendingNonce'

// Function to compute discriminator (first 8 bytes of SHA-256)
function computeDiscriminator(instructionName: string): string {
    const hash = createHash('sha256').update(`global:${instructionName}`).digest('hex')
    return hash.slice(0, 16) // First 8 bytes = 16 hex chars
}

// Known LayerZero Solana instruction discriminators (computed accurately)
const knownDiscriminators: Record<string, string> = {
    [computeDiscriminator('skip')]: 'skip',
    [computeDiscriminator('send')]: 'send',
    [computeDiscriminator('verify')]: 'verify',
    [computeDiscriminator('quote')]: 'quote',
    [computeDiscriminator('clear')]: 'clear',
    [computeDiscriminator('nilify')]: 'nilify',
    [computeDiscriminator('lz_receive')]: 'lz_receive',
    [computeDiscriminator('burn')]: 'burn',
    [computeDiscriminator('init_config')]: 'init_config',
    [computeDiscriminator('set_config')]: 'set_config',
    [computeDiscriminator('init_nonce')]: 'init_nonce',
    [computeDiscriminator('register_oapp')]: 'register_oapp',
    [computeDiscriminator('set_delegate')]: 'set_delegate',
    [computeDiscriminator('init_verify')]: 'init_verify',
    [computeDiscriminator('send_compose')]: 'send_compose',
    [computeDiscriminator('clear_compose')]: 'clear_compose',
    // Add more LayerZero instructions as needed
}

// Debug: Log computed discriminators (remove in production)
console.log('🔍 Computed Discriminators:')
console.log(`  skip: ${computeDiscriminator('skip')}`)
console.log(`  send: ${computeDiscriminator('send')}`)
console.log(`  verify: ${computeDiscriminator('verify')}`)
console.log(`  quote: ${computeDiscriminator('quote')}`)
console.log('')

// Helper function to decode discriminator to readable string
function decodeDiscriminator(discriminator: Buffer): string {
    const hex = discriminator.toString('hex')

    const instructionName = knownDiscriminators[hex]
    if (instructionName) {
        return `${instructionName} (${hex})`
    }

    // Try to decode as ASCII if it's printable
    let asciiAttempt = ''
    let isPrintable = true
    for (let i = 0; i < discriminator.length; i++) {
        const byte = discriminator[i]
        if (byte >= 32 && byte <= 126) {
            asciiAttempt += String.fromCharCode(byte)
        } else {
            isPrintable = false
            break
        }
    }

    if (isPrintable && asciiAttempt.length > 0) {
        return `"${asciiAttempt}" (${hex})`
    }

    return `unknown (${hex})`
}

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
    payloadHashPDA: string
    eventAuthorityPDA: string
    payloadHashExists: boolean
    eventAuthorityExists: boolean
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

        // Derive the payload hash PDA (not needed in checkCurrentNonce, will be handled in skipNonceOnSolana)

        // Derive the event authority PDA
        const eventAuthoritySeeds = [Buffer.from('__event_authority', 'utf8')]

        // Find all required PDAs using the endpoint program
        const [mainNoncePDA] = PublicKey.findProgramAddressSync(mainNonceSeeds, ENDPOINT_PROGRAM_ID)
        const [pendingNoncePDA] = PublicKey.findProgramAddressSync(pendingNonceSeeds, ENDPOINT_PROGRAM_ID)

        // Derive payload hash and event authority PDAs (will be used in skipNonceOnSolana)
        const _payloadHashSeeds = [
            Buffer.from('PayloadHash', 'utf8'),
            receiverPublicKey.toBuffer(),
            Buffer.from(new Uint32Array([srcEid]).buffer).reverse(), // Big endian u32
            Buffer.from(senderBytes),
        ]
        const [_payloadHashPDA] = PublicKey.findProgramAddressSync(_payloadHashSeeds, ENDPOINT_PROGRAM_ID)
        const [eventAuthorityPDA] = PublicKey.findProgramAddressSync(eventAuthoritySeeds, ENDPOINT_PROGRAM_ID)

        console.log(`\n🔍 Account Analysis:`)
        console.log(`├─ Main Nonce PDA: ${mainNoncePDA.toBase58()}`)
        console.log(`├─ Pending Inbound Nonce PDA: ${pendingNoncePDA.toBase58()}`)
        console.log(`├─ Payload Hash PDA: ${_payloadHashPDA.toBase58()}`)
        console.log(`└─ Event Authority PDA: ${eventAuthorityPDA.toBase58()}`)

        // Try to fetch the main accounts
        const [mainAccountInfo, pendingAccountInfo] = await connection.getMultipleAccountsInfo([
            mainNoncePDA,
            pendingNoncePDA,
        ])

        // Check payload hash and event authority accounts (simplified for now)
        const eventAuthorityInfo = await connection.getAccountInfo(eventAuthorityPDA)

        let inboundNonce = null,
            outboundNonce = null,
            exists = false
        const payloadHashExists = false
        const eventAuthorityExists = Boolean(eventAuthorityInfo)
        if (mainAccountInfo) {
            exists = true
            // Parse the main nonce account data manually
            // Nonce account structure: [discriminator: 8 bytes, bump: 1 byte, outbound: 8 bytes, inbound: 8 bytes]
            const data = mainAccountInfo.data
            if (data.length >= 25) {
                // Skip discriminator (8 bytes) and bump (1 byte), then read the nonces
                outboundNonce = Number(data.readBigUInt64LE(9)) // bytes 9-16
                inboundNonce = Number(data.readBigUInt64LE(17)) // bytes 17-24
                console.log(` Main Nonce Account: FOUND (${data.length} bytes)`)
            } else {
                console.warn(`  Main Nonce Account: Too short (${data.length} bytes)`)
            }
        } else {
            console.log(` Main Nonce Account: NOT FOUND`)
        }

        let pendingInboundNonce = null,
            pendingExists = false
        if (pendingAccountInfo) {
            pendingExists = true
            // Parse the pending nonce account data manually
            // Pending nonce account structure: [discriminator: 8 bytes, bump: 1 byte, nonce: 8 bytes]
            const data = pendingAccountInfo.data
            if (data.length >= 17) {
                pendingInboundNonce = Number(data.readBigUInt64LE(9)) // bytes 9-16
                console.log(` Pending Inbound Nonce Account: FOUND (${data.length} bytes)`)
            } else {
                console.warn(`  Pending Inbound Nonce Account: Too short (${data.length} bytes)`)
            }
        } else {
            console.log(` Pending Inbound Nonce Account: NOT FOUND`)
        }

        // Check event authority account (simplified check)
        const _eventAuthorityExists = Boolean(eventAuthorityInfo)
        if (eventAuthorityInfo) {
            console.log(` Event Authority Account: FOUND (${eventAuthorityInfo.data.length} bytes)`)
        } else {
            console.log(` Event Authority Account: NOT FOUND`)
        }

        return {
            inboundNonce,
            outboundNonce,
            exists,
            pendingInboundNonce,
            pendingExists,
            mainNoncePDA: mainNoncePDA.toBase58(),
            pendingNoncePDA: pendingNoncePDA.toBase58(),
            payloadHashPDA: _payloadHashPDA.toBase58(),
            eventAuthorityPDA: eventAuthorityPDA.toBase58(),
            payloadHashExists: false,
            eventAuthorityExists,
        }
    } catch (error: unknown) {
        console.warn(`Warning: Failed to check nonce: ${error instanceof Error ? error.message : String(error)}`)
        return {
            inboundNonce: null,
            outboundNonce: null,
            exists: false,
            pendingInboundNonce: null,
            pendingExists: false,
            mainNoncePDA: '',
            pendingNoncePDA: '',
            payloadHashPDA: '',
            eventAuthorityPDA: '',
            payloadHashExists: false,
            eventAuthorityExists: false,
        }
    }
}

export interface LayerZeroMessage {
    pathway: {
        srcEid: number
        dstEid: number
        sender: {
            address: string
            chain: string
        }
        receiver: {
            address: string
            chain: string
        }
        id: string
        nonce: number
    }
    source: {
        status: string
        tx: {
            txHash: string
            blockHash: string
            blockNumber: string
            blockTimestamp: number
            from: string
            payload: string
            readinessTimestamp: number
            options: {
                lzReceive: {
                    gas: string
                    value: string
                }
                nativeDrop: Array<{
                    amount: string
                    receiver: string
                }>
                ordered: boolean
            }
        }
    }
    destination: {
        nativeDrop: {
            status: string
        }
        lzCompose: {
            status: string
        }
        failedTx: Array<{
            txHash: string
            txError: string
            blockHash: string
            blockNumber: number
            revertReason: string
        }>
        status: string
    }
    verification: {
        dvn: {
            dvns: Record<
                string,
                {
                    txHash: string
                    blockHash: string
                    blockNumber: number
                    blockTimestamp: number
                    proof: {
                        packetHeader: string
                        payloadHash: string
                    }
                    optional: boolean
                    status: string
                }
            >
            status: string
        }
        sealer: {
            tx: {
                txHash: string
                blockHash: string
                blockNumber: number
                blockTimestamp: number
            }
            status: string
        }
    }
    guid: string
    config: {
        error: boolean
        receiveLibrary: string
        sendLibrary: string
        inboundConfig: {
            confirmations: number
            requiredDVNCount: number
            optionalDVNCount: number
            optionalDVNThreshold: number
            requiredDVNs: string[]
            requiredDVNNames: string[]
            optionalDVNs: string[]
            optionalDVNNames: string[]
        }
        outboundConfig: {
            confirmations: number
            requiredDVNCount: number
            optionalDVNCount: number
            optionalDVNThreshold: number
            requiredDVNs: string[]
            requiredDVNNames: string[]
            optionalDVNs: string[]
            optionalDVNNames: string[]
        }
        ulnSendVersion: string
        ulnReceiveVersion: string
    }
    status: {
        name: string
        message: string
    }
    created: string
    updated: string
}

const goodEID = 30168

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

        const matches = DATA_DMP.filter((d) => d.pathway.srcEid === srcEid && d.pathway.nonce === nonceToSkip)
        if (matches.length > 2 || matches.length === 0) {
            throw new Error(
                `Found ${matches.length} matches for EID ${srcEid} and nonce ${nonceToSkip}. Expected 0 or 1 match.`
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
        const senderBytes = addressToBytes32(match.pathway.sender.address)
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

        // Validate all required accounts exist
        const missingAccounts = []
        if (!nonceState.exists) missingAccounts.push('Main Nonce Account')
        if (!nonceState.pendingExists) missingAccounts.push('Pending Inbound Nonce Account')
        if (!nonceState.payloadHashExists) missingAccounts.push('Payload Hash Account')
        if (!nonceState.eventAuthorityExists) missingAccounts.push('Event Authority Account')

        if (missingAccounts.length > 0) {
            console.log(`\n❌ Cannot skip nonce ${nonceToSkip} - Missing accounts:`)
            missingAccounts.forEach((account) => console.log(`   - ${account}`))
            console.log('\n🔍 This indicates the message was never properly received on Solana')
            console.log('   The skip instruction requires all these accounts to exist')
            console.log('   Check if the message was actually sent from the source chain')
            throw new Error(`Cannot skip nonce - missing required accounts: ${missingAccounts.join(', ')}`)
        }

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
        console.log(`├─ Payload Hash Account: ${nonceState.payloadHashPDA}`)
        console.log(`└─ Event Authority Account: ${nonceState.eventAuthorityPDA}`)
        console.log(`   This will skip INBOUND nonce ${nonceToSkip} (${sourceChain} → Solana)`)

        // Create skip instruction
        console.log('\nCreating skip instruction...')
        const skipIx = await endpoint.skip(
            payer.publicKey,
            senderPublicKey,
            new PublicKey(match.pathway.receiver.address),
            srcEid,
            nonceToSkip.toString()
        )

        console.log(skipIx)
        // Decode the skip instruction data
        console.log('\n📋 Skip Instruction Analysis:')
        if (skipIx && skipIx.data) {
            const data = skipIx.data
            console.log(`├─ Instruction Data Length: ${data.length} bytes`)
            console.log(`├─ Raw Data (hex): ${data.toString('hex')}`)
            console.log(`├─ Raw Data (base58): ${bs58.encode(data)}`)

            // Decode the skip instruction structure based on LayerZero's format
            if (data.length >= 8) {
                // First 8 bytes are the discriminator
                const discriminator = data.subarray(0, 8)
                const discriminatorDecoded = decodeDiscriminator(discriminator)
                console.log(`├─ Discriminator: ${discriminatorDecoded}`)
                console.log(`│  └─ Base58: ${bs58.encode(discriminator)}`)

                if (data.length >= 40) {
                    // 8 + 32 bytes for receiver
                    // Next 32 bytes should be the receiver public key
                    const receiver = data.subarray(8, 40)
                    console.log(`├─ Receiver: ${bs58.encode(receiver)}`)

                    if (data.length >= 44) {
                        // + 4 bytes for srcEid
                        // Next 4 bytes should be srcEid (u32)
                        const srcEidBytes = data.subarray(40, 44)
                        const srcEidValue = srcEidBytes.readUInt32LE(0)
                        console.log(`├─ Source EID: ${srcEidValue}`)

                        if (data.length >= 76) {
                            // + 32 bytes for sender
                            // Next 32 bytes should be the sender address
                            const sender = data.subarray(44, 76)
                            console.log(`├─ Sender: 0x${sender.toString('hex')}`)

                            if (data.length >= 84) {
                                // + 8 bytes for nonce
                                // Next 8 bytes should be the nonce (u64)
                                const nonceBytes = data.subarray(76, 84)
                                const nonceValue = nonceBytes.readBigUInt64LE(0)
                                console.log(`└─ Nonce to Skip: ${nonceValue}`)
                            }
                        }
                    }
                }
            }
        } else {
            console.log('└─ No instruction data available')
        }

        // Analyze all accounts used in the skip instruction
        if (skipIx && skipIx.keys && skipIx.keys.length > 0) {
            console.log('\n🔑 Skip Instruction Accounts:')

            // Get account info for all keys in the instruction
            const accountKeys = skipIx.keys.map((key) => key.pubkey)
            const accountInfos = await connection.getMultipleAccountsInfo(accountKeys)

            for (let i = 0; i < skipIx.keys.length; i++) {
                const accountMeta = skipIx.keys[i]
                const accountInfo = accountInfos[i]
                const isLast = i === skipIx.keys.length - 1
                const prefix = isLast ? '└─' : '├─'

                console.log(`${prefix} Account ${i + 1}: ${accountMeta.pubkey.toBase58()}`)
                console.log(`${isLast ? '   ' : '│  '}├─ Signer: ${accountMeta.isSigner}`)
                console.log(`${isLast ? '   ' : '│  '}├─ Writable: ${accountMeta.isWritable}`)

                if (accountInfo) {
                    console.log(`${isLast ? '   ' : '│  '}├─ Owner: ${accountInfo.owner.toBase58()}`)
                    console.log(`${isLast ? '   ' : '│  '}├─ Data Length: ${accountInfo.data.length} bytes`)
                    console.log(`${isLast ? '   ' : '│  '}├─ Lamports: ${accountInfo.lamports}`)

                    // Try to identify the account type based on owner and data
                    let accountType = 'Unknown'
                    if (accountInfo.owner.equals(ENDPOINT_PROGRAM_ID)) {
                        if (accountInfo.data.length === 25) {
                            accountType = 'Nonce Account'
                        } else if (accountInfo.data.length > 0) {
                            // Try to decode discriminator for LayerZero accounts
                            const discriminator = accountInfo.data.subarray(0, 8)
                            const hex = discriminator.toString('hex')

                            // Known LayerZero account discriminators (computed)
                            const knownAccounts: Record<string, string> = {
                                [computeDiscriminator('Nonce')]: 'Nonce',
                                [computeDiscriminator('PendingInboundNonce')]: 'PendingInboundNonce',
                                [computeDiscriminator('OAppRegistry')]: 'OAppRegistry',
                                [computeDiscriminator('PayloadHash')]: 'PayloadHash',
                                [computeDiscriminator('EndpointSettings')]: 'EndpointSettings',
                                [computeDiscriminator('SendLibraryConfig')]: 'SendLibraryConfig',
                                [computeDiscriminator('ReceiveLibraryConfig')]: 'ReceiveLibraryConfig',
                                [computeDiscriminator('MessageLibInfo')]: 'MessageLibInfo',
                                [computeDiscriminator('ComposeMessageState')]: 'ComposeMessageState',
                                // Add more LayerZero account types as needed
                            }

                            const knownType = knownAccounts[hex]
                            if (knownType) {
                                accountType = `LayerZero ${knownType}`
                            } else {
                                accountType = `LayerZero Account (${hex})`
                            }
                        }
                    } else if (accountInfo.owner.equals(new PublicKey('11111111111111111111111111111111'))) {
                        accountType = 'System Account'
                    } else {
                        accountType = 'Program Account'
                    }

                    console.log(`${isLast ? '   ' : '│  '}└─ Type: ${accountType}`)
                } else {
                    console.log(`${isLast ? '   ' : '│  '}└─ Status: NOT FOUND`)
                }
            }
        }

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
