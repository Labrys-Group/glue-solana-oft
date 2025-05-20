import assert from 'assert'

import { type DeployFunction } from 'hardhat-deploy/types'

const contractName = 'gOFT'

////// UPDATE THESE VALUES //////
const tokenConfig = {
    name: 'Bonk',
    symbol: 'BONK',
    decimals: 5,
}
////// UPDATE THESE VALUES //////

const deploy: DeployFunction = async (hre) => {
    const { getNamedAccounts, deployments } = hre

    const { deploy } = deployments
    const { deployer } = await getNamedAccounts()

    assert(deployer, 'Missing named deployer account')

    console.log(`Network: ${hre.network.name}`)
    console.log(`Deployer: ${deployer}`)

    const endpointV2Deployment = await hre.deployments.get('EndpointV2')

    const { address } = await deploy(contractName, {
        from: deployer,
        args: [tokenConfig.name, tokenConfig.symbol, endpointV2Deployment.address, deployer, tokenConfig.decimals],
        log: true,
        skipIfAlreadyDeployed: false,
    })

    console.log(`Deployed contract: ${contractName}, network: ${hre.network.name}, address: ${address}`)
}

deploy.tags = [contractName]

export default deploy
