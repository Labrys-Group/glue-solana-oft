import { mplToolbox } from '@metaplex-foundation/mpl-toolbox'
import { publicKey, transactionBuilder } from '@metaplex-foundation/umi'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import bs58 from 'bs58'
import { task } from 'hardhat/config'

import { types } from '@layerzerolabs/devtools-evm-hardhat'
import { EndpointId } from '@layerzerolabs/lz-definitions'
import { OftPDA, oft } from '@layerzerolabs/oft-v2-solana-sdk'

import { createSolanaConnectionFactory } from '../common/utils'

import { deriveConnection, getExplorerTxLink } from '.'

interface Args {
    mint: string
    eid: EndpointId
    dstEid: EndpointId
    programId: string
    oftStore: string
    submit?: boolean
}

task('lz:oft:solana:get-peers', 'Gets the peer for a solana oft')
    .addParam('mint', 'The OFT token mint public key')
    .addParam('programId', 'The OFT Program id')
    .addParam('eid', 'Solana mainnet (30168) or testnet (40168)', undefined, types.eid)
    .addParam('dstEid', 'The destination endpoint ID', undefined, types.eid)
    .addParam('oftStore', 'The OFTStore account')
    .addOptionalParam('submit', 'Whether to submit the setPeerConfig transaction', false, types.boolean)
    .setAction(async (taskArgs: Args, _) => {
        const { connection, umi, umiWalletKeyPair, umiWalletSigner } = await deriveConnection(taskArgs.eid)

        const [peer] = new OftPDA(publicKey(taskArgs.programId)).peer(publicKey(taskArgs.oftStore), taskArgs.dstEid)
        const peerInfo = await oft.accounts.fetchPeerConfig({ rpc: umi.rpc }, peer)

        // Convert peerAddress to Ethereum address format
        const ethAddress = '0x' + Buffer.from(peerInfo.peerAddress.slice(-20)).toString('hex')

        console.log(`Peer info between ${taskArgs.eid} and ${taskArgs.dstEid}`)
        console.log(`Peer Ethereum Address: ${ethAddress}`)
        console.dir({ peerInfo }, { depth: null })

        // if (taskArgs.submit) {
        //     console.log('\nSubmitting setPeerConfig transaction...')

        //     // Create the setPeerConfig instruction
        //     const instruction = oft.setPeerConfig(
        //         {
        //             admin: umiWalletSigner,
        //             oftStore: publicKey(taskArgs.oftStore),
        //         },
        //         {
        //             __kind: 'PeerAddress',
        //             peer: new Uint8Array(
        //                 Buffer.from('000000000000000000000000461da3759fdb8f0b7b0aca8a0a48a91daaaddf27', 'hex')
        //             ),
        //             remote: 30342, // GLUE_V2_MAINNET
        //         },
        //         publicKey(taskArgs.programId) // OFT program ID
        //     )

        //     // Build and submit the transaction
        //     const txBuilder = transactionBuilder().add(instruction)

        //     try {
        //         const { signature } = await txBuilder.sendAndConfirm(umi)
        //         const txHash = bs58.encode(signature)
        //         console.log(`Transaction successful!`)
        //         console.log(`Transaction hash: ${txHash}`)
        //         console.log(
        //             `Explorer link: ${getExplorerTxLink(txHash, taskArgs.eid === EndpointId.SOLANA_V2_TESTNET)}`
        //         )
        //     } catch (error) {
        //         console.error('Transaction failed:', error)
        //         throw error
        //     }
        // } else {
        //     console.log('\nTo submit the setPeerConfig transaction, add --submit true to the command')

        //     // Show what the instruction would look like (for debugging)
        //     const instruction = oft.setPeerConfig(
        //         {
        //             admin: umiWalletSigner,
        //             oftStore: publicKey(taskArgs.oftStore),
        //         },
        //         {
        //             __kind: 'PeerAddress',
        //             peer: new Uint8Array(
        //                 Buffer.from('000000000000000000000000461da3759fdb8f0b7b0aca8a0a48a91daaaddf27', 'hex')
        //             ),
        //             remote: 30342, // GLUE_V2_MAINNET
        //         },
        //         publicKey(taskArgs.programId) // OFT program ID
        //     )

        //     console.log('\nInstruction details:')
        //     console.log(`Keys: ${instruction.instruction.keys.length} accounts`)
        //     console.log(`Data: ${Buffer.from(instruction.instruction.data).toString('hex')}`)
        // }
    })
