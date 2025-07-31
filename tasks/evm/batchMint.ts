import { task } from 'hardhat/config'
import { ActionType, HardhatRuntimeEnvironment } from 'hardhat/types'
import { formatUnits } from 'ethers/lib/utils'
import { BATCH_MINT_VALUES } from '../../data/batch-mints'

const action: ActionType<{}> = async ({}, hre: HardhatRuntimeEnvironment) => {
    const signer = await hre.ethers.getNamedSigner('deployer')
    // @ts-ignore
    const token = (await hre.ethers.getContract('gOFT')).connect(signer)

    // Hardcoded batch mint recipients and amounts
    const batchMints = BATCH_MINT_VALUES.map((val) => ({
        ...val,
        amount: hre.ethers.utils.parseUnits(val.amount.toString(), 6), // Assuming 6 decimals for the token
    }))

    // Check current balances before minting
    console.log('\nBalances before minting:')

    // Execute batch mint
    const txResponse = await token.functions.mint(batchMints)
    const txReceipt = await txResponse.wait()

    console.log(`\nBatch mint transaction: ${txReceipt.transactionHash}`)
    console.log(`Gas used: ${txReceipt.gasUsed.toString()}`)

    // Check balances after minting
    console.log('\nBalances after minting:')
    for (const mint of batchMints) {
        const balance = await token.balanceOf(mint.address)
        console.log(`${mint.address}: ${formatUnits(balance, 6)}`)
    }

    console.log('\nBatch mint completed successfully!')
}

task('batch-mint', 'Batch mints tokens to predefined addresses', action)

