# Skip Nonce Script Tests

This directory contains comprehensive unit tests for the LayerZero nonce skip functionality on Solana.

## Test Files

### `skip-nonce.test.ts`
Tests the core `skipNonceOnSolana` function with:
- ✅ Valid parameter validation
- ✅ Source chain validation 
- ✅ Balance checking
- ✅ Error handling for all scenarios
- ✅ Transaction creation and confirmation
- ✅ Endpoint ID mapping validation
- ✅ Case-insensitive chain names
- ✅ Helpful error messages
- ✅ Progress logging

### `skip-nonce-cli.test.ts`
Tests CLI-related functionality including:
- ✅ Keypair loading from files
- ✅ Environment variable handling
- ✅ RPC URL determination
- ✅ Command line argument parsing
- ✅ Error handling and process exit

### `get-nonce.test.ts`
Tests the `getNextNonceOnSolana` function with:
- ✅ Valid parameter validation
- ✅ Source chain validation 
- ✅ Address format validation
- ✅ Error handling for all scenarios
- ✅ Nonce querying via nextNonce function
- ✅ Endpoint ID mapping validation
- ✅ Case-insensitive chain names
- ✅ Helpful error messages for read-only operations
- ✅ Different output for first message vs existing nonces

### `setup.ts`
Global test configuration that:
- ✅ Mocks console methods to reduce noise
- ✅ Sets up test environment variables
- ✅ Configures Jest timeouts
- ✅ Mocks process.exit to prevent test termination

## Running Tests

```bash
# Run all unit tests
npm run test:unit

# Run tests in watch mode
npm run test:unit:watch

# Run tests with coverage report
npm run test:unit:coverage

# Run all tests (including forge and hardhat)
npm run test
```

## Test Coverage

The tests cover:

- **Happy Path**: Successful nonce skipping
- **Error Scenarios**: Invalid chains, insufficient balance, transaction failures
- **Input Validation**: Address formats, nonce conversion, parameter validation
- **Network Support**: All supported source chains and Solana networks
- **CLI Functionality**: Argument parsing, file loading, environment variables
- **Error Messages**: Helpful error messages for different failure scenarios

## Test Structure

Each test file follows this pattern:

1. **Setup**: Mock all external dependencies
2. **Before Each**: Reset mocks and configure default behavior
3. **Test Cases**: Specific scenarios with assertions
4. **After Each**: Clean up mocks and restore console

## Mocked Dependencies

Tests mock these external dependencies:
- `@solana/web3.js` - Connection, Keypair, Transaction
- `@layerzerolabs/lz-solana-sdk-v2` - EndpointProgram
- `@layerzerolabs/lz-v2-utilities` - addressToBytes32
- `@metaplex-foundation/umi*` - UMI libraries
- `fs` - File system operations
- `commander` - CLI argument parsing

## Running Individual Tests

```bash
# Run specific test file
npx jest skip-nonce.test.ts

# Run specific test case
npx jest -t "should successfully skip a nonce"

# Run tests with verbose output
npx jest --verbose

# Run tests and generate coverage report
npx jest --coverage --coverageDirectory=coverage
```

## Test Configuration

See `jest.config.js` for Jest configuration:
- TypeScript support via ts-jest
- Coverage collection from scripts directory
- 30-second timeout for async operations
- HTML and LCOV coverage reports

## Adding New Tests

When adding new functionality to the skip-nonce script:

1. Add corresponding test cases in `skip-nonce.test.ts`
2. Mock any new external dependencies
3. Test both success and failure scenarios
4. Ensure good error message coverage
5. Update this README if needed