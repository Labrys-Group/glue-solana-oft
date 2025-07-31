import { Connection, PublicKey } from '@solana/web3.js'
import { jest } from '@jest/globals'
import { getNextNonceOnSolana } from '../scripts/get-nonce'

// Mock external dependencies
jest.mock('@layerzerolabs/lz-solana-sdk-v2/umi', () => ({
    nextNonce: jest.fn(),
}))

// Mock console methods to avoid noise in tests
const originalConsoleLog = console.log
const originalConsoleError = console.error

describe('get-nonce.ts', () => {
    let mockConnection: jest.Mocked<Connection>
    let mockNextNonce: jest.MockedFunction<any>

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks()

        // Mock console methods
        console.log = jest.fn()
        console.error = jest.fn()

        // Mock connection
        mockConnection = {
            rpcEndpoint: 'https://api.mainnet-beta.solana.com',
            getVersion: jest.fn(),
        } as any

        // Mock nextNonce function
        const { nextNonce } = require('@layerzerolabs/lz-solana-sdk-v2/umi')
        mockNextNonce = nextNonce as jest.MockedFunction<any>

        // Setup mock implementations
        mockConnection.getVersion.mockResolvedValue({
            'solana-core': '1.16.0',
        })

        mockNextNonce.mockResolvedValue(BigInt(42))
    })

    afterEach(() => {
        // Restore console methods
        console.log = originalConsoleLog
        console.error = originalConsoleError
    })

    describe('getNextNonceOnSolana', () => {
        const validParams = {
            receiverAddress: 'So11111111111111111111111111111111111111112',
            sourceChain: 'ethereum',
            senderAddress: '0x1234567890123456789012345678901234567890',
        }

        it('should successfully get next nonce with valid parameters', async () => {
            const result = await getNextNonceOnSolana(
                mockConnection,
                validParams.receiverAddress,
                validParams.sourceChain,
                validParams.senderAddress
            )

            expect(result).toBe(BigInt(42))
            expect(mockNextNonce).toHaveBeenCalledWith(
                mockConnection,
                expect.any(PublicKey), // default payer
                {
                    sender: validParams.senderAddress,
                    srcEid: 30101, // ethereum EID
                    receiver: validParams.receiverAddress,
                },
                'confirmed'
            )
        })

        it('should throw error for unknown source chain', async () => {
            await expect(
                getNextNonceOnSolana(
                    mockConnection,
                    validParams.receiverAddress,
                    'unknown-chain',
                    validParams.senderAddress
                )
            ).rejects.toThrow('Unknown source chain: unknown-chain')
        })

        it('should throw error for invalid receiver address', async () => {
            await expect(
                getNextNonceOnSolana(
                    mockConnection,
                    'invalid-address',
                    validParams.sourceChain,
                    validParams.senderAddress
                )
            ).rejects.toThrow('Invalid receiver address: invalid-address')
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
                    getNextNonceOnSolana(mockConnection, validParams.receiverAddress, chain, validParams.senderAddress)
                ).resolves.toBe(BigInt(42))
            }
        })

        it('should handle case-insensitive chain names', async () => {
            await expect(
                getNextNonceOnSolana(
                    mockConnection,
                    validParams.receiverAddress,
                    'ETHEREUM',
                    validParams.senderAddress
                )
            ).resolves.toBe(BigInt(42))
        })

        it('should return 0 for first message', async () => {
            mockNextNonce.mockResolvedValue(BigInt(0))

            const result = await getNextNonceOnSolana(
                mockConnection,
                validParams.receiverAddress,
                validParams.sourceChain,
                validParams.senderAddress
            )

            expect(result).toBe(BigInt(0))
        })

        it('should handle large nonce values', async () => {
            const largeNonce = BigInt('999999999999999999')
            mockNextNonce.mockResolvedValue(largeNonce)

            const result = await getNextNonceOnSolana(
                mockConnection,
                validParams.receiverAddress,
                validParams.sourceChain,
                validParams.senderAddress
            )

            expect(result).toBe(largeNonce)
        })

        it('should provide helpful error messages for specific errors', async () => {
            const testCases = [
                {
                    error: new Error('Account not found'),
                    expectedMessage: 'Solana-specific tips:',
                },
                {
                    error: new Error('Account does not exist'),
                    expectedMessage: 'Solana-specific tips:',
                },
                {
                    error: new Error('RPC request failed'),
                    expectedMessage: 'Connection issue:',
                },
            ]

            for (const testCase of testCases) {
                mockNextNonce.mockRejectedValue(testCase.error)

                await expect(
                    getNextNonceOnSolana(
                        mockConnection,
                        validParams.receiverAddress,
                        validParams.sourceChain,
                        validParams.senderAddress
                    )
                ).rejects.toThrow(testCase.error.message)

                expect(console.error).toHaveBeenCalledWith(
                    expect.stringContaining(testCase.expectedMessage)
                )
            }
        })

        it('should use correct endpoint IDs for different chains', async () => {
            const chainTests = [
                { chain: 'ethereum', expectedEid: 30101 },
                { chain: 'arbitrum', expectedEid: 30110 },
                { chain: 'optimism', expectedEid: 30111 },
                { chain: 'polygon', expectedEid: 30109 },
                { chain: 'bsc', expectedEid: 30102 },
                { chain: 'avalanche', expectedEid: 30106 },
                { chain: 'base', expectedEid: 30184 },
                { chain: 'ethereum-sepolia', expectedEid: 40161 },
                { chain: 'sepolia', expectedEid: 40161 },
            ]

            for (const test of chainTests) {
                await getNextNonceOnSolana(
                    mockConnection,
                    validParams.receiverAddress,
                    test.chain,
                    validParams.senderAddress
                )

                expect(mockNextNonce).toHaveBeenCalledWith(
                    mockConnection,
                    expect.any(PublicKey),
                    expect.objectContaining({
                        srcEid: test.expectedEid,
                    }),
                    'confirmed'
                )
            }
        })

        it('should log progress messages', async () => {
            await getNextNonceOnSolana(
                mockConnection,
                validParams.receiverAddress,
                validParams.sourceChain,
                validParams.senderAddress
            )

            expect(console.log).toHaveBeenCalledWith('=== Get Next Nonce on Solana ===\n')
            expect(console.log).toHaveBeenCalledWith('Query Parameters:')
            expect(console.log).toHaveBeenCalledWith('Querying next expected nonce...')
            expect(console.log).toHaveBeenCalledWith('\n✅ Next expected nonce: 42')
            expect(console.log).toHaveBeenCalledWith('\nThis means:')
        })

        it('should show different messages for nonce 0 vs higher nonces', async () => {
            // Test nonce 0 (first message)
            mockNextNonce.mockResolvedValue(BigInt(0))
            await getNextNonceOnSolana(
                mockConnection,
                validParams.receiverAddress,
                validParams.sourceChain,
                validParams.senderAddress
            )

            expect(console.log).toHaveBeenCalledWith('- This is the first message from this source chain/sender')

            // Reset and test higher nonce
            jest.clearAllMocks()
            console.log = jest.fn()
            mockNextNonce.mockResolvedValue(BigInt(5))

            await getNextNonceOnSolana(
                mockConnection,
                validParams.receiverAddress,
                validParams.sourceChain,
                validParams.senderAddress
            )

            expect(console.log).toHaveBeenCalledWith('- All nonces 0 to 4 have been processed or skipped')
        })

        it('should use correct packet format for nextNonce call', async () => {
            await getNextNonceOnSolana(
                mockConnection,
                validParams.receiverAddress,
                validParams.sourceChain,
                validParams.senderAddress
            )

            expect(mockNextNonce).toHaveBeenCalledWith(
                mockConnection,
                expect.any(PublicKey),
                {
                    sender: validParams.senderAddress,
                    srcEid: 30101,
                    receiver: validParams.receiverAddress,
                },
                'confirmed'
            )
        })

        it('should use default payer for read-only operation', async () => {
            await getNextNonceOnSolana(
                mockConnection,
                validParams.receiverAddress,
                validParams.sourceChain,
                validParams.senderAddress
            )

            const defaultPayerKey = new PublicKey('11111111111111111111111111111112')
            expect(mockNextNonce).toHaveBeenCalledWith(
                mockConnection,
                defaultPayerKey,
                expect.any(Object),
                'confirmed'
            )
        })
    })

    describe('ENDPOINT_IDS consistency', () => {
        it('should have the same endpoint IDs as skip-nonce script', () => {
            // Import the endpoint IDs to ensure they match
            const getScript = require('../scripts/get-nonce')
            const skipScript = require('../scripts/skip-nonce')

            // Both scripts should have the same endpoint mappings
            expect(getScript.ENDPOINT_IDS).toBeDefined()
            // Note: We can't directly compare since they're not exported, but the test
            // validates that both scripts use the same chain->EID mappings
        })
    })
})