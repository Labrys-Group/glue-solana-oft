#!/usr/bin/env ts-node

import { Command } from 'commander'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// Chain to Endpoint ID mapping (includes Solana)
const ENDPOINT_IDS: Record<string, number> = {
    // Mainnet EIDs
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
    solana: 30168,
    'solana-mainnet': 30168,

    // Testnet EIDs
    'ethereum-sepolia': 40161,
    sepolia: 40161,
    'arbitrum-sepolia': 40231,
    'optimism-sepolia': 40232,
    'base-sepolia': 40245,
    'solana-testnet': 40168,
    'solana-devnet': 40168, // Solana testnet/devnet use same EID
}

// LayerZero Scan API configuration
const API_ENDPOINTS = {
    mainnet: 'https://scan.layerzero.network/api/v1',
    testnet: 'https://scan-testnet.layerzero.network/api/v1'
}

// Types for LayerZero endpoint metadata
interface EndpointMetadata {
    [chainId: string]: {
        name: string
        symbol: string
        chainId: number
        rpc?: string
    }
}

// Types for API responses (based on actual API structure)
interface LayerZeroMessage {
    src_chain_id?: number
    dst_chain_id?: number
    srcChainId?: number  // Alternative field name
    dstChainId?: number  // Alternative field name
    nonce: number
    status: string
    src_tx_hash?: string
    dst_tx_hash?: string
    srcTxHash?: string   // Alternative field name
    dstTxHash?: string   // Alternative field name
    sender?: string
    receiver?: string
    src_address?: string // Alternative field name
    dst_address?: string // Alternative field name
    timestamp: string
    created_at?: string  // Alternative field name
    guid?: string
    message_id?: string  // Alternative field name
}

interface ApiResponse {
    messages: LayerZeroMessage[]
    pagination?: {
        limit: number
        offset: number
        total: number
    }
}

/**
 * Fetch LayerZero endpoint metadata from official API
 */
async function fetchEndpointMetadata(): Promise<EndpointMetadata> {
    try {
        const response = await fetch('https://endpoints-api.layerzero.network/v1/endpoint-metadata.json')
        if (!response.ok) {
            throw new Error(`Failed to fetch endpoint metadata: ${response.status}`)
        }
        return await response.json()
    } catch (error) {
        console.log('⚠️  Could not fetch latest endpoint metadata, using fallback mapping')
        return {}
    }
}

/**
 * Get chain ID with fallback to static mapping
 */
async function getChainId(chainName: string, isTestnet: boolean): Promise<number | null> {
    // First try static mapping
    let chainId = ENDPOINT_IDS[chainName.toLowerCase()]
    
    if (isTestnet) {
        // Try testnet-specific mappings
        const testnetKey = chainName.toLowerCase() + '-testnet'
        const devnetKey = chainName.toLowerCase() + '-devnet'
        const sepoliaKey = chainName.toLowerCase() + '-sepolia'
        
        chainId = ENDPOINT_IDS[testnetKey] || ENDPOINT_IDS[devnetKey] || ENDPOINT_IDS[sepoliaKey]
        
        // Special case for solana - use testnet EID when --testnet flag is used
        if (chainName.toLowerCase() === 'solana' && !chainId) {
            chainId = ENDPOINT_IDS['solana-testnet'] // 40168
        }
        
        // Fallback to mainnet if no testnet version found
        if (!chainId) {
            chainId = ENDPOINT_IDS[chainName.toLowerCase()]
        }
    }
    
    if (chainId) {
        return chainId
    }

    // If not found in static mapping, try dynamic metadata
    try {
        const metadata = await fetchEndpointMetadata()
        
        // Search through metadata for chain name match
        for (const [id, info] of Object.entries(metadata)) {
            if (info.name.toLowerCase().includes(chainName.toLowerCase()) || 
                info.symbol.toLowerCase().includes(chainName.toLowerCase())) {
                return parseInt(id)
            }
        }
    } catch (error) {
        console.log('Could not fetch dynamic endpoint metadata')
    }
    
    return null
}

/**
 * Query nonces using LayerZero Scan API
 */
async function queryLayerZeroScanAPI(
    sourceChain: string,
    destChain: string,
    options: {
        limit?: number
        testnet?: boolean
        sender?: string
        receiver?: string
    } = {}
): Promise<{
    latestNonce: number | null
    messages: LayerZeroMessage[]
    pathway: string
}> {
    try {
        console.log('=== LayerZero Scan API Query ===\n')

        // Get source and destination chain IDs
        console.log('🔍 Resolving chain IDs...')
        const srcEid = await getChainId(sourceChain, options.testnet || false)
        const dstEid = await getChainId(destChain, options.testnet || false)

        if (!srcEid) {
            throw new Error(
                `Unknown source chain: ${sourceChain}. Could not resolve chain ID. Try chains like: ethereum, solana, arbitrum, base, etc.`
            )
        }

        if (!dstEid) {
            throw new Error(
                `Unknown destination chain: ${destChain}. Could not resolve chain ID. Try chains like: base-sepolia, ethereum-sepolia, etc.`
            )
        }

        console.log('Query Parameters:')
        console.log(`- Source Chain: ${sourceChain} (EID: ${srcEid})`)
        console.log(`- Destination Chain: ${destChain} (EID: ${dstEid})`)
        console.log(`- Limit: ${options.limit || 1}`)
        console.log(`- Network: ${options.testnet ? 'Testnet' : 'Mainnet'}`)
        if (options.sender) console.log(`- Sender Filter: ${options.sender}`)
        if (options.receiver) console.log(`- Receiver Filter: ${options.receiver}`)
        console.log()

        // Select API endpoint
        const baseUrl = options.testnet ? API_ENDPOINTS.testnet : API_ENDPOINTS.mainnet
        
        // Build query parameters (using camelCase as suggested by Perplexity research)
        const params = new URLSearchParams({
            srcChainId: srcEid.toString(),
            dstChainId: dstEid.toString(),
            limit: (options.limit || 1).toString()
        })

        if (options.sender) {
            params.append('srcAddress', options.sender)
        }
        if (options.receiver) {
            params.append('dstAddress', options.receiver)
        }

        const apiUrl = `${baseUrl}/messages?${params.toString()}`
        
        console.log(`🔍 Querying LayerZero Scan API...`)
        console.log(`   URL: ${apiUrl}`)

        // Make API request
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'LayerZero-Nonce-Query-Script/1.0'
            }
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`API request failed: ${response.status} ${response.statusText}\nResponse: ${errorText}`)
        }

        const apiResponse: ApiResponse = await response.json()
        return processApiResponse(apiResponse, sourceChain, destChain, srcEid, dstEid)

    } catch (error: unknown) {
        console.error('\n❌ Error querying LayerZero Scan API:')
        console.error(error instanceof Error ? error.message : error)
        
        if (error instanceof Error) {
            if (error.message.includes('fetch')) {
                console.error('\n💡 Network issue:')
                console.error('- Check your internet connection')
                console.error('- The API endpoint might be temporarily unavailable')
                console.error('- Try again in a few moments')
            } else if (error.message.includes('404') || error.message.includes('400')) {
                console.error('\n💡 API endpoint issue:')
                console.error('- The API endpoint structure might have changed')
                console.error('- Try with different parameters or check LayerZero documentation')
            }
        }

        throw error
    }
}

/**
 * Process API response and extract nonce information
 */
function processApiResponse(
    apiResponse: ApiResponse,
    sourceChain: string,
    destChain: string,
    srcEid: number,
    dstEid: number
): {
    latestNonce: number | null
    messages: LayerZeroMessage[]
    pathway: string
} {
    console.log('✅ API Response received!')
    
    const messages = apiResponse.messages || []
    const pathway = `${sourceChain}(${srcEid}) → ${destChain}(${dstEid})`

    console.log(`   Messages found: ${messages.length}`)
    
    if (messages.length === 0) {
        console.log('❓ No messages found for this pathway')
        console.log('   This could mean:')
        console.log('   - No messages have been sent on this route yet')
        console.log('   - The pathway doesn\'t exist or has different EIDs')
        console.log('   - Try with different chain names or check for typos')
        
        return {
            latestNonce: null,
            messages: [],
            pathway
        }
    }

    // Sort messages by nonce (descending) to get the latest first
    const sortedMessages = messages.sort((a, b) => b.nonce - a.nonce)
    const latestMessage = sortedMessages[0]
    const latestNonce = latestMessage.nonce

    console.log('\n📋 Message Details:')
    sortedMessages.forEach((message, index) => {
        console.log(`\n   Message ${index + 1}:`)
        console.log(`   - Nonce: ${message.nonce}`)
        console.log(`   - Status: ${message.status}`)
        
        // Handle different field name variations
        const sender = message.sender || message.src_address
        const receiver = message.receiver || message.dst_address
        const srcTx = message.srcTxHash || message.src_tx_hash
        const dstTx = message.dstTxHash || message.dst_tx_hash
        const timestamp = message.timestamp || message.created_at
        const guid = message.guid || message.message_id
        
        if (sender) console.log(`   - Sender: ${sender}`)
        if (receiver) console.log(`   - Receiver: ${receiver}`)
        if (srcTx) console.log(`   - Source Tx: ${srcTx}`)
        if (dstTx) console.log(`   - Dest Tx: ${dstTx}`)
        if (timestamp) console.log(`   - Timestamp: ${new Date(timestamp).toLocaleString()}`)
        if (guid) console.log(`   - GUID/ID: ${guid}`)
        
        // Debug: show raw message structure for first message
        if (index === 0) {
            console.log(`   - Raw message keys: ${Object.keys(message).join(', ')}`)
        }
    })

    return {
        latestNonce,
        messages: sortedMessages,
        pathway
    }
}

// Set up CLI
const program = new Command()

program
    .name('get-nonce-api')
    .description('Get nonces using LayerZero Scan API (same data as LayerZeroScan website)')
    .version('1.0.0')
    .requiredOption('-s, --source-chain <chain>', 'Source chain name (ethereum, solana, arbitrum, etc.)')
    .requiredOption('-d, --dest-chain <chain>', 'Destination chain name (base-sepolia, ethereum, etc.)')
    .option('-l, --limit <number>', 'Number of messages to fetch (default: 1)', '1')
    .option('--testnet', 'Use testnet API endpoint')
    .option('--sender <address>', 'Filter by sender address (optional)')
    .option('--receiver <address>', 'Filter by receiver address (optional)')

program.parse(process.argv)
const options = program.opts()

/**
 * Main execution function
 */
async function main() {
    try {
        const limit = parseInt(options.limit) || 1
        
        const result = await queryLayerZeroScanAPI(
            options.sourceChain,
            options.destChain,
            {
                limit,
                testnet: options.testnet,
                sender: options.sender,
                receiver: options.receiver
            }
        )

        // Output summary
        console.log(`\n📊 Summary:`)
        console.log(`Pathway: ${result.pathway}`)
        console.log(`Latest Nonce: ${result.latestNonce !== null ? result.latestNonce : 'None found'}`)
        console.log(`Messages Retrieved: ${result.messages.length}`)

        if (result.latestNonce !== null) {
            console.log(`\n✅ Latest nonce from LayerZero Scan API: ${result.latestNonce}`)
            console.log(`This is the authoritative nonce data from LayerZero's official API`)
            
            const nextNonce = result.latestNonce + 1
            console.log(`Next expected nonce: ${nextNonce}`)
        } else {
            console.log(`\n❓ No messages found for this pathway`)
            console.log(`The next message would use nonce: 0`)
        }

        return result

    } catch (error: any) {
        console.error('\nFailed to query LayerZero Scan API:', error.message)
        process.exit(1)
    }
}

// Export functions for use in other modules
export { queryLayerZeroScanAPI, LayerZeroMessage }

// Run the script if called directly
if (require.main === module) {
    main().catch(console.error)
}