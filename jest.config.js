module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  moduleFileExtensions: ['js', 'json'],
  testTimeout: 10000,
  verbose: true,
  // Mock Electron modules
  moduleNameMapper: {
    '^electron$': '<rootDir>/tests/__mocks__/electron.js'
  },
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  // Ignore patterns
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
    '/src/lib/'
  ]
};
