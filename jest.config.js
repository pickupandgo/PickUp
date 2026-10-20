module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: [
    './node_modules/@react-native/jest-preset/jest/setup.js',
    './jest.setup.js',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(' +
      '(jest-)?react-native' +
      '|@react-native(-community)?' +
      '|@react-native-vector-icons' +
      '|@react-navigation' +
      '|@gorhom/bottom-sheet' +
      '|react-native-reanimated' +
      '|react-native-gesture-handler' +
      '|react-native-screens' +
      '|react-native-safe-area-context' +
      '|react-native-svg' +
      '|react-native-maps' +
      '|react-native-image-picker' +
      '|react-native-worklets' +
      '|@react-native-firebase' +
      '|firebase' +
      '|@firebase' +
      '|react-native-config' +
    ')/)',
  ],
  moduleNameMapper: {
    '\\.(ttf|otf|png|jpg|jpeg|gif|webp)$': '<rootDir>/__mocks__/fileMock.js',
  },
};