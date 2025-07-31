import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { jest } from '@jest/globals'
import { skipNonceOnSolana } from '../scripts/skip-nonce'

// Mock external dependencies
jest.mock('@metaplex-foundation/umi', () => ({
    createSignerFromKeypair: jest.fn(),
    signerIdentity: jest.fn(),
}))

jest.mock('@metaplex-foundation/umi-bundle-defaults', () => ({
    createUmi: jest.fn(),
}))

jest.mock('@metaplex-foundation/umi-web3js-adapters', () => ({
    fromWeb3JsKeypair: jest.fn(),
}))

jest.mock('@layerzerolabs/lz-solana-sdk-v2', () => ({
    EndpointProgram: {
        Endpoint: jest.fn(),
    },
}))

jest.mock('@layerzerolabs/lz-v2-utilities', () => ({
    addressToBytes32: jest.fn(),
}))

// Mock console methods to avoid noise in tests
const originalConsoleLog = console.log
const originalConsoleError = console.error

describe('skip-nonce.ts', () => {
    let mockConnection: jest.Mocked<Connection>
    let mockPayer: Keypair
    let mockEndpoint: any
    let mockUmi: any
    let mockPayerSigner: any

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks()

        // Mock console methods
        console.log = jest.fn()
        console.error = jest.fn()

        // Create mock payer keypair
        mockPayer = Keypair.generate()

        // Mock connection
        mockConnection = {
            rpcEndpoint: 'https://api.mainnet-beta.solana.com',
            getBalance: jest.fn(),
            getLatestBlockhash: jest.fn(),
            sendTransaction: jest.fn(),
            confirmTransaction: jest.fn(),
            getVersion: jest.fn(),
        } as any

        // Mock UMI signer
        mockPayerSigner = {
            publicKey: mockPayer.publicKey,
        }

        // Mock UMI instance
        mockUmi = {
            use: jest.fn(),
        }

        // Mock endpoint
        mockEndpoint = {
            skip: jest.fn(),
        }

        // Setup mock implementations
        const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults')
        const { createSignerFromKeypair, signerIdentity } = require('@metaplex-foundation/umi')
        const { fromWeb3JsKeypair } = require('@metaplex-foundation/umi-web3js-adapters')
        const { EndpointProgram } = require('@layerzerolabs/lz-solana-sdk-v2')
        const { addressToBytes32 } = require('@layerzerolabs/lz-v2-utilities')

        createUmi.mockReturnValue(mockUmi)
        createSignerFromKeypair.mockReturnValue(mockPayerSigner)
        signerIdentity.mockReturnValue(jest.fn())
        fromWeb3JsKeypair.mockReturnValue(mockPayer)
        EndpointProgram.Endpoint.mockReturnValue(mockEndpoint)
        addressToBytes32.mockReturnValue(new Uint8Array(32).fill(1))

        // Mock connection methods
        mockConnection.getBalance.mockResolvedValue(100000000) // 0.1 SOL
        mockConnection.getLatestBlockhash.mockResolvedValue({
            blockhash: 'mock-blockhash',
            lastValidBlockHeight: 123456789,
        })
        mockConnection.sendTransaction.mockResolvedValue('mock-signature')
        mockConnection.confirmTransaction.mockResolvedValue({
            value: { err: null },
        })
        mockConnection.getVersion.mockResolvedValue({
            'solana-core': '1.16.0',
        })

        // Mock endpoint skip method
        mockEndpoint.skip.mockResolvedValue('mock-skip-instruction')
    })

    afterEach(() => {
        // Restore console methods
        console.log = originalConsoleLog
        console.error = originalConsoleError
    })

    describe('skipNonceOnSolana', () => {
        const validParams = {
            receiverAddress: 'So11111111111111111111111111111111111111112',
            sourceChain: 'ethereum',
            senderAddress: '0x1234567890123456789012345678901234567890',
            nonceToSkip: 42,
        }

        it('should successfully skip a nonce with valid parameters', async () => {
            const result = await skipNonceOnSolana(
                mockConnection,
                mockPayer,
                validParams.receiverAddress,
                validParams.sourceChain,
                validParams.senderAddress,
                validParams.nonceToSkip
            )

            expect(result).toBe('mock-signature')
            expect(mockConnection.getBalance).toHaveBeenCalledWith(mockPayer.publicKey)
            expect(mockEndpoint.skip).toHaveBeenCalled()
            expect(mockConnection.sendTransaction).toHaveBeenCalled()
            expect(mockConnection.confirmTransaction).toHaveBeenCalled()
        })

        it('should throw error for unknown source chain', async () => {
            await expect(
                skipNonceOnSolana(
                    mockConnection,
                    mockPayer,
                    validParams.receiverAddress,
                    'unknown-chain',
                    validParams.senderAddress,
                    validParams.nonceToSkip
                )
            ).rejects.toThrow('Unknown source chain: unknown-chain')
        })

        it('should throw error for insufficient balance', async () => {
            mockConnection.getBalance.mockResolvedValue(5000000) // 0.005 SOL (less than 0.01)

            await expect(
                skipNonceOnSolana(
                    mockConnection,
                    mockPayer,
                    validParams.receiverAddress,
                    validParams.sourceChain,
                    validParams.senderAddress,
                    validParams.nonceToSkip
                )
            ).rejects.toThrow('Insufficient balance. Need at least 0.01 SOL for transaction fees.')
        })

        it('should throw error when skip instruction fails', async () => {
            mockEndpoint.skip.mockResolvedValue(null)

            await expect(
                skipNonceOnSolana(
                    mockConnection,
                    mockPayer,
                    validParams.receiverAddress,
                    validParams.sourceChain,
                    validParams.senderAddress,
                    validParams.nonceToSkip
                )
            ).rejects.toThrow('Failed to create skip instruction')
        })

        it('should throw error when transaction fails', async () => {
            mockConnection.confirmTransaction.mockResolvedValue({
                value: { err: 'Transaction failed' },
            })

            await expect(
                skipNonceOnSolana(
                    mockConnection,
                    mockPayer,
                    validParams.receiverAddress,
                    validParams.sourceChain,
                    validParams.senderAddress,
                    validParams.nonceToSkip
                )
            ).rejects.toThrow('Transaction failed: "Transaction failed"')
        })

        it('should handle all supported source chains', async () => {
            const supportedChains = [
                'ethereum',
                'ethereum-mainnet',
                'arbitrum',
                'arbitrum-mainnet',
                'optimism',
                'optimism-mainnet',
                'polygon',
                'polygon-mainnet',
                'bsc',
                'bsc-mainnet',
                'avalanche',
                'avalanche-mainnet',
                'base',
                'base-mainnet',
                'ethereum-sepolia',
                'sepolia',
                'arbitrum-sepolia',
                'optimism-sepolia',
                'base-sepolia',
            ]

            for (const chain of supportedChains) {
                await expect(
                    skipNonceOnSolana(
                        mockConnection,
                        mockPayer,
                        validParams.receiverAddress,
                        chain,
                        validParams.senderAddress,
                        validParams.nonceToSkip
                    )
                ).resolves.toBe('mock-signature')
            }
        })

        it('should handle case-insensitive chain names', async () => {
            await expect(
                skipNonceOnSolana(
                    mockConnection,
                    mockPayer,
                    validParams.receiverAddress,
                    'ETHEREUM',
                    validParams.senderAddress,
                    validParams.nonceToSkip
                )
            ).resolves.toBe('mock-signature')
        })

        it('should provide helpful error messages for specific errors', async () => {
            const testCases = [
                {
                    error: new Error('Account does not exist'),
                    expectedMessage: 'Solana-specific tips:',
                },
                {
                    error: new Error('Unauthorized'),
                    expectedMessage: 'Permission issue:',
                },
                {
                    error: new Error('InsufficientFundsForTransaction'),
                    expectedMessage: 'Solana transaction fee issue:',
                },
            ]

            for (const testCase of testCases) {
                mockConnection.sendTransaction.mockRejectedValue(testCase.error)

                await expect(
                    skipNonceOnSolana(
                        mockConnection,
                        mockPayer,
                        validParams.receiverAddress,
                        validParams.sourceChain,
                        validParams.senderAddress,
                        validParams.nonceToSkip
                    )
                ).rejects.toThrow(testCase.error.message)

                expect(console.error).toHaveBeenCalledWith(
                    expect.stringContaining(testCase.expectedMessage)
                )
            }
        })

        it('should validate receiver address format', async () => {
            const invalidReceiver = 'invalid-address'

            await expect(
                skipNonceOnSolana(
                    mockConnection,
                    mockPayer,
                    invalidReceiver,
                    validParams.sourceChain,
                    validParams.senderAddress,
                    validParams.nonceToSkip
                )
            ).rejects.toThrow() // Should throw due to invalid PublicKey format
        })

        it('should convert nonce to string when calling endpoint.skip', async () => {
            await skipNonceOnSolana(
                mockConnection,
                mockPayer,
                validParams.receiverAddress,
                validParams.sourceChain,
                validParams.senderAddress,
                validParams.nonceToSkip
            )

            expect(mockEndpoint.skip).toHaveBeenCalledWith(
                mockPayer.publicKey,
                expect.any(PublicKey), // sender public key
                expect.any(PublicKey), // receiver public key
                30101, // ethereum EID
                '42' // nonce as string
            )
        })

        it('should use correct transaction options', async () => {
            await skipNonceOnSolana(
                mockConnection,
                mockPayer,
                validParams.receiverAddress,
                validParams.sourceChain,
                validParams.senderAddress,
                validParams.nonceToSkip
            )

            expect(mockConnection.sendTransaction).toHaveBeenCalledWith(
                expect.any(Transaction),
                [mockPayer],
                {
                    skipPreflight: false,
                    preflightCommitment: 'confirmed',
                    maxRetries: 3,
                }
            )
        })

        it('should log progress messages', async () => {
            await skipNonceOnSolana(
                mockConnection,
                mockPayer,
                validParams.receiverAddress,
                validParams.sourceChain,
                validParams.senderAddress,
                validParams.nonceToSkip
            )

            expect(console.log).toHaveBeenCalledWith('=== Skip Nonce on Solana ===\n')
            expect(console.log).toHaveBeenCalledWith('Skip Parameters:')
            expect(console.log).toHaveBeenCalledWith('\nCreating skip instruction...')
            expect(console.log).toHaveBeenCalledWith('Sending skip transaction...')
            expect(console.log).toHaveBeenCalledWith('\nWaiting for confirmation...')
            expect(console.log).toHaveBeenCalledWith('\n✅ Successfully skipped nonce on Solana!')
        })
    })

    describe('ENDPOINT_IDS', () => {
        // Test that all endpoint IDs are correct numbers
        const { ENDPOINT_IDS } = require('../scripts/skip-nonce')

        it('should have correct mainnet endpoint IDs', () => {
            expect(ENDPOINT_IDS.ethereum).toBe(30101)
            expect(ENDPOINT_IDS.arbitrum).toBe(30110)
            expect(ENDPOINT_IDS.optimism).toBe(30111)
            expect(ENDPOINT_IDS.polygon).toBe(30109)
            expect(ENDPOINT_IDS.bsc).toBe(30102)
            expect(ENDPOINT_IDS.avalanche).toBe(30106)
            expect(ENDPOINT_IDS.base).toBe(30184)
        })

        it('should have correct testnet endpoint IDs', () => {
            expect(ENDPOINT_IDS['ethereum-sepolia']).toBe(40161)
            expect(ENDPOINT_IDS.sepolia).toBe(40161)
            expect(ENDPOINT_IDS['arbitrum-sepolia']).toBe(40231)
            expect(ENDPOINT_IDS['optimism-sepolia']).toBe(40232)
            expect(ENDPOINT_IDS['base-sepolia']).toBe(40245)
        })

        it('should have alternative names for mainnet chains', () => {
            expect(ENDPOINT_IDS['ethereum-mainnet']).toBe(ENDPOINT_IDS.ethereum)
            expect(ENDPOINT_IDS['arbitrum-mainnet']).toBe(ENDPOINT_IDS.arbitrum)
            expect(ENDPOINT_IDS['optimism-mainnet']).toBe(ENDPOINT_IDS.optimism)
            expect(ENDPOINT_IDS['polygon-mainnet']).toBe(ENDPOINT_IDS.polygon)
            expect(ENDPOINT_IDS['bsc-mainnet']).toBe(ENDPOINT_IDS.bsc)
            expect(ENDPOINT_IDS['avalanche-mainnet']).toBe(ENDPOINT_IDS.avalanche)
            expect(ENDPOINT_IDS['base-mainnet']).toBe(ENDPOINT_IDS.base)
        })
    })
})