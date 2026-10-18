module.exports = {
  // No @react-native/jest-preset: it has no 0.81.x release. Tests target the API/state/logic
  // layer (not native host rendering), transformed by babel-jest with the app's RN babel preset.
  testEnvironment: 'node',
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': [
      'babel-jest',
      { presets: ['module:@react-native/babel-preset'] },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      '@react-native' +
      '|react-native' +
      '|@react-native-firebase' +
      '|@react-native-async-storage' +
      '|@react-native-community' +
    ')/)',
  ],
  setupFiles: ['./jest.setup.js'],
  moduleNameMapper: {
    '\\.(png|jpg|jpeg|gif|webp)$': '<rootDir>/__mocks__/fileMock.js',
  },
  testMatch: ['<rootDir>/__tests__/**/*.test.(ts|tsx)'],
  testPathIgnorePatterns: ['/node_modules/'],
};
