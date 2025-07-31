// Test setup file for Jest
import { jest } from '@jest/globals'

// Mock environment variables for tests
process.env.NODE_ENV = 'test'

// Global test configuration
jest.setTimeout(30000)

// Mock console methods globally to reduce noise
const originalConsole = { ...console }

beforeEach(() => {
  // Reset console mocks before each test
  console.log = jest.fn()
  console.error = jest.fn()
  console.warn = jest.fn()
  console.info = jest.fn()
})

afterAll(() => {
  // Restore original console methods after all tests
  Object.assign(console, originalConsole)
})

// Mock process.exit to prevent tests from actually exiting
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit() was called')
})

afterAll(() => {
  mockExit.mockRestore()
})