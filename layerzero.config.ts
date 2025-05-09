import { EndpointId } from '@layerzerolabs/lz-definitions'
import { ExecutorOptionType } from '@layerzerolabs/lz-v2-utilities'
import { generateConnectionsConfig } from '@layerzerolabs/metadata-tools'
import { OAppEnforcedOption, OmniPointHardhat } from '@layerzerolabs/toolbox-hardhat'

import { getOftStoreAddress } from './tasks/solana'

// Note:  Do not use address for EVM OmniPointHardhat contracts.  Contracts are loaded using hardhat-deploy.
// If you do use an address, ensure artifacts exists.
// const sepoliaContract: OmniPointHardhat = {
//     eid: EndpointId.SEPOLIA_V2_TESTNET,
//     contractName: 'MyOFT',
// }

// const GLUE_V2_MAINNET_EID = 30342

const glueMainnetContract: OmniPointHardhat = {
    eid: EndpointId.GLUE_V2_MAINNET,
    contractName: 'gOFT',
}

// const baseSepoliaContract: OmniPointHardhat = {
//     eid: EndpointId.BASESEP_V2_TESTNET,
//     contractName: 'gOFT',
// }

// const SOLANA_MAINNET_EID = 30168

const solanaContract: OmniPointHardhat = {
    eid: EndpointId.SOLANA_V2_MAINNET,
    address: getOftStoreAddress(EndpointId.SOLANA_V2_MAINNET),
    // eid: EndpointId.SOLANA_V2_TESTNET,
    // address: getOftStoreAddress(EndpointId.SOLANA_V2_TESTNET),
}

const EVM_ENFORCED_OPTIONS: OAppEnforcedOption[] = [
    {
        msgType: 1,
        optionType: ExecutorOptionType.LZ_RECEIVE,
        gas: 200_000,
        value: 0,
    },
]

const SOLANA_ENFORCED_OPTIONS: OAppEnforcedOption[] = [
    {
        msgType: 1,
        optionType: ExecutorOptionType.LZ_RECEIVE,
        gas: 200000,
        value: 2500000,
    },
]

// Learn about Message Execution Options: https://docs.layerzero.network/v2/developers/solana/oft/account#message-execution-options
// Learn more about the Simple Config Generator - https://docs.layerzero.network/v2/developers/evm/technical-reference/simple-config
export default async function () {
    console.log('Generating connections config...')
    console.log(`glueMainnetContract.eid: ${glueMainnetContract.eid}`)
    console.log(`solanaContract.eid: ${solanaContract.eid}`)
    // note: pathways declared here are automatically bidirectional
    // if you declare A,B there's no need to declare B,A
    const connections = await generateConnectionsConfig([
        [
            glueMainnetContract, // Chain A contract
            solanaContract, // Chain B contract
            [['LayerZero Labs'], []], // [ requiredDVN[], [ optionalDVN[], threshold ] ]
            [15, 32], // [A to B confirmations, B to A confirmations]
            [SOLANA_ENFORCED_OPTIONS, EVM_ENFORCED_OPTIONS], // Chain B enforcedOptions, Chain A enforcedOptions
        ],
    ])

    return {
        contracts: [{ contract: glueMainnetContract }, { contract: solanaContract }],
        connections,
    }
}
