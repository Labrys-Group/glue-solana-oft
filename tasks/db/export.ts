import { ethers } from 'ethers'
import fs from 'fs'
import { task } from 'hardhat/config'
import path from 'path'

import { EndpointId } from '@layerzerolabs/lz-definitions'

import { ERC_20_ABI } from '../../helpers/erc-20'
import { getSolanaDeployment } from '../solana'

interface LzConfigExportTaskArgs {
    configFile: string
}

// EID to Network ID mapping
const EID_TO_NETWORK_ID: Record<number, number> = {
    30168: 101, // Solana Mainnet
    40168: 103, // Solana Testnet
    30342: 1300, // Glue Mainnet
}

// EID to RPC URL mapping
const EID_TO_RPC: Record<number, string> = {
    30342: 'https://rpc.glue.net',
    // Add more as needed
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

        // For now, we'll use placeholder values since we'd need to fetch from Solana RPC
        // This could be enhanced to fetch actual token metadata from Solana
        return {
            name: '',
            symbol: '',
            decimals: 9,
            mint: deployment.mint,
            escrow: deployment.escrow,
            programId: deployment.programId,
        }
    } catch (error) {
        console.warn(`Failed to fetch Solana token details for EID ${eid}:`, error)
        return {
            name: '',
            symbol: '',
            decimals: 9,
            mint: '',
            escrow: '',
            programId: '',
        }
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

            let outputData: any
            let tokenSymbol = 'UNKNOWN'

            if (isSolanaEID(eid)) {
                // Handle Solana contract
                const solanaDetails = await getSolanaTokenDetails(eid, contract.contractName)

                // Try to extract symbol from contract name or use default
                tokenSymbol = contract.contractName || 'SOL'

                outputData = {
                    assetId: '',
                    name: solanaDetails.name,
                    symbol: solanaDetails.symbol,
                    address: contract.address || solanaDetails.mint,
                    decimals: solanaDetails.decimals,
                    networkId: networkId,
                    endpointId: eid,
                    remoteChains: config.contracts
                        .filter((c: any) => c.contract.eid !== eid)
                        .map((c: any) => ({
                            address: c.contract.address || '',
                            endpointId: c.contract.eid,
                        })),
                    solanaConfig: {
                        mint: solanaDetails.mint,
                        escrow: solanaDetails.escrow,
                        programId: solanaDetails.programId,
                    },
                    isProxy: true,
                    tokenAddress: solanaDetails.mint,
                    image: '',
                }
            } else {
                // Handle EVM contract
                const rpcUrl = EID_TO_RPC[eid]
                let evmDetails = { name: '', symbol: '', decimals: 18 }

                if (rpcUrl && contract.address) {
                    evmDetails = await getEVMContractDetails(contract.address, rpcUrl)
                } else if (contract.contractName) {
                    // Use contract name as symbol fallback
                    tokenSymbol = contract.contractName
                }

                tokenSymbol = evmDetails.symbol || contract.contractName || 'EVM'

                outputData = {
                    assetId: '',
                    name: evmDetails.name,
                    symbol: evmDetails.symbol,
                    address: contract.address || '',
                    decimals: evmDetails.decimals,
                    networkId: networkId,
                    endpointId: eid,
                    remoteChains: config.contracts
                        .filter((c: any) => c.contract.eid !== eid)
                        .map((c: any) => ({
                            address: c.contract.address || '',
                            endpointId: c.contract.eid,
                        })),
                    isProxy: false,
                    tokenAddress: contract.address || '0x0000000000000000000000000000000000000000',
                    image: '',
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
