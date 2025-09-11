import fs from 'fs'
import path from 'path'

import { fetchMetadataFromSeeds } from '@metaplex-foundation/mpl-token-metadata'
import { publicKey } from '@metaplex-foundation/umi'
import { getMint } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import { ethers } from 'ethers'
import { task } from 'hardhat/config'

import { EndpointId } from '@layerzerolabs/lz-definitions'

import { ERC_20_ABI } from '../../helpers/erc-20'
import { deriveConnection, getSolanaDeployment } from '../solana'

interface LzConfigExportTaskArgs {
    configFile: string
}

// EID to Network ID mapping
const EID_TO_NETWORK_ID: Record<number, number> = {
    30168: 101, // Solana Mainnet
    30342: 1300, // Glue Mainnet
}

// EID to RPC URL mapping
// EID to network name mapping for deployment files
const EID_TO_NETWORK_NAME: Record<number, string> = {
    30342: 'glue-mainnet',
    30168: 'solana-mainnet',
    // Add more as needed
}

const EID_TO_RPC: Record<number, string> = {
    30342: 'https://rpc.glue.net',
    30168: 'https://api.mainnet-beta.solana.com', // Solana Mainnet
    // Add more as needed
}

const getEVMContractAddress = (eid: EndpointId, contractName: string): string => {
    try {
        const networkName = EID_TO_NETWORK_NAME[eid]
        if (!networkName) {
            throw new Error(`No network name mapping for EID ${eid}`)
        }

        const deploymentPath = path.join(process.cwd(), 'deployments', networkName, `${contractName}.json`)
        if (!fs.existsSync(deploymentPath)) {
            throw new Error(`Deployment file not found: ${deploymentPath}`)
        }

        const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'))
        return deployment.address || ''
    } catch (error) {
        console.error(error)
        throw new Error(`Failed to get EVM contract address for ${contractName} on EID ${eid}:`)
    }
}

const getCoinGeckoTokenData = async (contractAddress: string, platform = 'solana') => {
    try {
        const response = await fetch(`https://api.coingecko.com/api/v3/coins/${platform}/contract/${contractAddress}`)
        if (!response.ok) {
            throw new Error(`CoinGecko API returned ${response.status}`)
        }
        const data = await response.json()
        return {
            assetId: data.id || '',
            image: data.image?.large || data.image?.small || '',
        }
    } catch (error) {
        console.error(error)
        throw new Error(`Failed to get EVM contract address for ${contractAddress} on platform ${platform}:`)
    }
}

const getEVMContractDetails = async (contractAddress: string, rpcUrl: string) => {
    try {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
        const contract = new ethers.Contract(contractAddress, ERC_20_ABI, provider)

        const [name, symbol, decimals] = await Promise.all([contract.name(), contract.symbol(), contract.decimals()])

        return { name, symbol, decimals: Number(decimals) }
    } catch (error) {
        console.warn(`Failed to fetch EVM contract details for ${contractAddress}:`, error)
        return { name: '', symbol: '', decimals: 18 }
    }
}

const getSolanaTokenDetails = async (eid: EndpointId, contractName?: string) => {
    try {
        const deployment = getSolanaDeployment(eid, contractName || 'OFT.json')
        const rpcUrl = EID_TO_RPC[eid]

        if (!rpcUrl) {
            throw new Error(`No RPC URL configured for EID ${eid}`)
        }

        const { connection, umi } = await deriveConnection(eid)
        const mintPublicKey = new PublicKey(deployment.mint)

        // Fetch mint account info for decimals
        const mintInfo = await getMint(connection, mintPublicKey)

        // Fetch metadata using Metaplex
        let name = ''
        let symbol = ''

        try {
            const mintUmi = publicKey(deployment.mint)
            const metadata = await fetchMetadataFromSeeds(umi, { mint: mintUmi })
            name = metadata.name
            symbol = metadata.symbol
        } catch (metadataError) {
            console.error(metadataError)
            throw new Error('Error getting spl metadata')
        }

        return {
            name,
            symbol,
            decimals: mintInfo.decimals,
            mint: deployment.mint,
            escrow: deployment.escrow,
            programId: deployment.programId,
        }
    } catch (error) {
        throw new Error('Failed to get SOL token details')
    }
}

const isSolanaEID = (eid: number): boolean => {
    return eid === 30168 || eid === 40168 // Solana mainnet/testnet
}

task('lz:oapp:db-export', 'Exports a lz config file to a JSON object for the lz-tokens collection in database')
    .addParam('configFile', 'the filepath for the lz config (e.g. `configs/bonksol-lz.config.ts`)')
    .setAction(async ({ configFile }: LzConfigExportTaskArgs) => {
        console.log(`Processing config file: ${configFile}`)

        // Dynamically import the config file
        const fullConfigPath = path.resolve(configFile)
        if (!fs.existsSync(fullConfigPath)) {
            throw new Error(`Config file not found: ${fullConfigPath}`)
        }

        // Import the config function
        const configModule = await import(fullConfigPath)
        const configFunction = configModule.default

        if (typeof configFunction !== 'function') {
            throw new Error('Config file must export a default function')
        }

        // Execute the config function to get the config
        const config = await configFunction()

        if (!config.contracts || !Array.isArray(config.contracts)) {
            throw new Error('Config must contain a contracts array')
        }

        // Ensure constants directory exists
        const constantsDir = path.join(process.cwd(), 'constants')
        if (!fs.existsSync(constantsDir)) {
            fs.mkdirSync(constantsDir, { recursive: true })
        }

        // First, get CoinGecko data from the Solana token (only once)
        let sharedCoinGeckoData = { assetId: '', image: '' }
        const solanaContract = config.contracts.find((c: { contract: { eid: number } }) => isSolanaEID(c.contract.eid))
        if (solanaContract) {
            try {
                const solanaDeployment = getSolanaDeployment(
                    solanaContract.contract.eid,
                    solanaContract.contract.contractName || 'OFT.json'
                )
                sharedCoinGeckoData = await getCoinGeckoTokenData(solanaDeployment.mint, 'solana')
                console.log(`Fetched CoinGecko data: assetId=${sharedCoinGeckoData.assetId}`)
            } catch (error) {
                console.error('Failed to fetch CoinGecko data from Solana token:', error)
                throw new Error('Error getting sol token')
            }
        }

        // Process each contract
        for (const contractWrapper of config.contracts) {
            const contract = contractWrapper.contract
            const eid = contract.eid
            const networkId = EID_TO_NETWORK_ID[eid]

            if (!networkId) {
                console.warn(`Unknown network ID for EID ${eid}, skipping...`)
                continue
            }

            console.log(`Processing contract for EID ${eid} (Network ID: ${networkId})`)

            let outputData
            let tokenSymbol = 'UNKNOWN'

            if (isSolanaEID(eid)) {
                // Handle Solana contract
                const solanaDetails = await getSolanaTokenDetails(eid, contract.contractName)

                // Try to extract symbol from metadata or contract name
                tokenSymbol = solanaDetails.symbol || contract.contractName || 'SOL'

                outputData = {
                    assetId: sharedCoinGeckoData.assetId,
                    name: solanaDetails.name,
                    symbol: solanaDetails.symbol,
                    address: contract.address || solanaDetails.mint,
                    decimals: solanaDetails.decimals,
                    networkId: networkId,
                    endpointId: eid,
                    remoteChains: config.contracts
                        .filter((c: { contract: { eid: number } }) => c.contract.eid !== eid)
                        .map((c: { contract: { eid: number; address?: string; contractName?: string } }) => {
                            const remoteContract = c.contract
                            let remoteAddress = remoteContract.address || ''

                            // For Solana contracts, use the programId
                            if (isSolanaEID(remoteContract.eid) && !remoteAddress) {
                                try {
                                    const remoteDeployment = getSolanaDeployment(
                                        remoteContract.eid,
                                        remoteContract.contractName || 'OFT.json'
                                    )
                                    remoteAddress = remoteDeployment.programId
                                } catch (error) {
                                    console.warn(
                                        `Failed to get remote Solana deployment for EID ${remoteContract.eid}:`,
                                        error
                                    )
                                }
                            } else if (
                                !isSolanaEID(remoteContract.eid) &&
                                !remoteAddress &&
                                remoteContract.contractName
                            ) {
                                // For EVM contracts, get address from deployment file
                                try {
                                    remoteAddress = getEVMContractAddress(
                                        remoteContract.eid,
                                        remoteContract.contractName
                                    )
                                } catch (error) {
                                    console.warn(
                                        `Failed to get remote EVM deployment for EID ${remoteContract.eid}:`,
                                        error
                                    )
                                }
                            }

                            return {
                                address: remoteAddress,
                                endpointId: remoteContract.eid,
                            }
                        }),
                    solanaConfig: {
                        mint: solanaDetails.mint,
                        escrow: solanaDetails.escrow,
                        programId: solanaDetails.programId,
                    },
                    isProxy: true,
                    tokenAddress: solanaDetails.mint,
                    image: sharedCoinGeckoData.image,
                }
            } else {
                // Handle EVM contract
                const rpcUrl = EID_TO_RPC[eid]
                let evmDetails = { name: '', symbol: '', decimals: 18 }

                // Get contract address from deployment file if not provided
                let contractAddress = contract.address
                if (!contractAddress && contract.contractName) {
                    contractAddress = getEVMContractAddress(eid, contract.contractName)
                }

                if (rpcUrl && contractAddress) {
                    evmDetails = await getEVMContractDetails(contractAddress, rpcUrl)
                } else if (contract.contractName) {
                    // Use contract name as symbol fallback
                    tokenSymbol = contract.contractName
                }

                tokenSymbol = evmDetails.symbol || contract.contractName || 'EVM'

                outputData = {
                    assetId: sharedCoinGeckoData.assetId,
                    name: evmDetails.name,
                    symbol: evmDetails.symbol,
                    address: contractAddress || '',
                    decimals: evmDetails.decimals,
                    networkId: networkId,
                    endpointId: eid,
                    remoteChains: config.contracts
                        .filter((c: { contract: { eid: number } }) => c.contract.eid !== eid)
                        .map((c: { contract: { eid: number; address?: string; contractName?: string } }) => {
                            const remoteContract = c.contract
                            let remoteAddress = remoteContract.address || ''

                            // For Solana contracts, use the mint address if no address is specified
                            if (isSolanaEID(remoteContract.eid) && !remoteAddress) {
                                try {
                                    const remoteDeployment = getSolanaDeployment(
                                        remoteContract.eid,
                                        remoteContract.contractName || 'OFT.json'
                                    )
                                    remoteAddress = remoteDeployment.mint
                                } catch (error) {
                                    console.warn(
                                        `Failed to get remote Solana deployment for EID ${remoteContract.eid}:`,
                                        error
                                    )
                                }
                            } else if (
                                !isSolanaEID(remoteContract.eid) &&
                                !remoteAddress &&
                                remoteContract.contractName
                            ) {
                                // For EVM contracts, get address from deployment file
                                try {
                                    remoteAddress = getEVMContractAddress(
                                        remoteContract.eid,
                                        remoteContract.contractName
                                    )
                                } catch (error) {
                                    console.warn(
                                        `Failed to get remote EVM deployment for EID ${remoteContract.eid}:`,
                                        error
                                    )
                                }
                            }

                            return {
                                address: remoteAddress,
                                endpointId: remoteContract.eid,
                            }
                        }),
                    isProxy: false,
                    tokenAddress: contractAddress || '0x0000000000000000000000000000000000000000',
                    image: sharedCoinGeckoData.image,
                }
            }

            // Generate filename
            const filename = `lz-config-${networkId}-${tokenSymbol.toUpperCase()}.json`
            const filepath = path.join(constantsDir, filename)

            // Write file
            fs.writeFileSync(filepath, JSON.stringify(outputData, null, 2))
            console.log(`✅ Generated: ${filename}`)
        }

        console.log('✅ Export completed!')
    })
