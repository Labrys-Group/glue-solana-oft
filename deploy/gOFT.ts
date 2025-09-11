import assert from 'assert'

import { type DeployFunction } from 'hardhat-deploy/types'

const contractName = 'PENGU'

////// UPDATE THESE VALUES //////
const tokenConfig = {
    name: 'Pudgy Penguins',
    symbol: 'PENGU',
    decimals: 18,
}
////// UPDATE THESE VALUES //////

const OWNER = '0x72f9A355e48F228B72c4e8FA90bD91c3eC0bC868'

const deploy: DeployFunction = async (hre) => {
    const { getNamedAccounts, deployments } = hre

    const { deploy } = deployments
    const { deployer } = await getNamedAccounts()

    assert(deployer, 'Missing named deployer account')

    console.log(`Network: ${hre.network.name}`)
    console.log(`Deployer: ${deployer}`)

    const endpointV2Deployment = await hre.deployments.get('EndpointV2')

    const { address } = await deploy(contractName, {
        contract: 'gOFT',
        from: deployer,
        args: [tokenConfig.name, tokenConfig.symbol, endpointV2Deployment.address, OWNER, tokenConfig.decimals],
        log: true,
        skipIfAlreadyDeployed: false,
    })

    console.log(`Deployed contract: ${contractName}, network: ${hre.network.name}, address: ${address}`)
}

deploy.tags = [contractName]

export default deploy
