module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transformIgnorePatterns: [
    '/node_modules/(?!light-my-request|cookie)',
  ],
  transform: {
    '\\.js$': ['ts-jest', { useESM: false }],
    '\\.ts$': ['ts-jest'],
  },
};
