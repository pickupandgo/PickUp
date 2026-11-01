const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const realRoot = require('fs').realpathSync(__dirname);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [
    __dirname,
    realRoot,
    path.resolve(realRoot, 'node_modules'),
  ],
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
