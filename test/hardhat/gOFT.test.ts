import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { Contract, ContractFactory } from 'ethers'
import { deployments, ethers } from 'hardhat'

describe.only('gOFT Test', function () {
    // Constant representing a mock Endpoint ID for testing purposes
    const eidA = 1
    // Declaration of variables to be used in the test suite
    let gOFT: ContractFactory
    let EndpointV2Mock: ContractFactory
    let owner: SignerWithAddress
    let user1: SignerWithAddress
    let user2: SignerWithAddress
    let user3: SignerWithAddress
    let endpointOwner: SignerWithAddress
    let gOFTContract: Contract
    let mockEndpointV2A: Contract

    // Before hook for setup that runs once before all tests in the block
    before(async function () {
        // Contract factory for our tested contract
        gOFT = await ethers.getContractFactory('gOFT')

        // Fetching signers from Hardhat's local Ethereum network
        const signers = await ethers.getSigners()
        ;[owner, user1, user2, user3, endpointOwner] = signers

        // The EndpointV2Mock contract comes from @layerzerolabs/test-devtools-evm-hardhat package
        const EndpointV2MockArtifact = await deployments.getArtifact('EndpointV2Mock')
        EndpointV2Mock = new ContractFactory(EndpointV2MockArtifact.abi, EndpointV2MockArtifact.bytecode, endpointOwner)
    })

    // beforeEach hook for setup that runs before each test in the block
    beforeEach(async function () {
        // Deploying a mock LZEndpoint with the given Endpoint ID
        mockEndpointV2A = await EndpointV2Mock.deploy(eidA)

        // Deploying gOFT contract
        gOFTContract = await gOFT.deploy('Glue OFT', 'gOFT', mockEndpointV2A.address, owner.address, 6)
    })

    it('should mint tokens for an array of users and check their balances are correct', async function () {
        // Define mint amounts for users
        const mintAmount1 = ethers.utils.parseUnits('100', 6) // 100 tokens with 6 decimals
        const mintAmount2 = ethers.utils.parseUnits('250', 6) // 250 tokens with 6 decimals
        const mintAmount3 = ethers.utils.parseUnits('500', 6) // 500 tokens with 6 decimals

        // Create batch mint array
        const batchMints = [
            { to: user1.address, amount: mintAmount1 },
            { to: user2.address, amount: mintAmount2 },
            { to: user3.address, amount: mintAmount3 },
        ]

        // Check initial balances are zero
        expect(await gOFTContract.balanceOf(user1.address)).to.equal(0)
        expect(await gOFTContract.balanceOf(user2.address)).to.equal(0)
        expect(await gOFTContract.balanceOf(user3.address)).to.equal(0)

        // Mint tokens using batch mint
        await gOFTContract.connect(owner).mint(batchMints)

        // Check balances are correct after minting
        expect(await gOFTContract.balanceOf(user1.address)).to.equal(mintAmount1)
        expect(await gOFTContract.balanceOf(user2.address)).to.equal(mintAmount2)
        expect(await gOFTContract.balanceOf(user3.address)).to.equal(mintAmount3)
    })

    it('should mint, revoke mint access, then fail to mint', async function () {
        // Define mint amounts
        const mintAmount1 = ethers.utils.parseUnits('100', 6)
        const mintAmount2 = ethers.utils.parseUnits('200', 6)

        // First batch mint
        const firstBatch = [{ to: user1.address, amount: mintAmount1 }]

        // Successfully mint tokens
        await gOFTContract.connect(owner).mint(firstBatch)
        expect(await gOFTContract.balanceOf(user1.address)).to.equal(mintAmount1)

        // Revoke mint access
        await gOFTContract.connect(owner).disableEmergencyMint()

        // Second batch mint (should fail)
        const secondBatch = [{ to: user2.address, amount: mintAmount2 }]

        // Attempt to mint should fail
        await expect(gOFTContract.connect(owner).mint(secondBatch)).to.be.revertedWith('Emergency minting is disabled')

        // Verify user2 still has zero balance
        expect(await gOFTContract.balanceOf(user2.address)).to.equal(0)
        // Verify user1 still has their original balance
        expect(await gOFTContract.balanceOf(user1.address)).to.equal(mintAmount1)
    })
})

