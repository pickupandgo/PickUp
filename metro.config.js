const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // The engine backend was copied into the workspace and ships its own
    // node_modules. Exclude it so Metro doesn't watch it or hit Haste module
    // naming collisions while bundling the app.
    blockList: [
      /[\\/]Drive_with_engine[\\/].*/,
      // CMake creates and removes temporary folders during native builds.
      // They are not Metro inputs; watching them can crash fs.watch on Windows.
      /[\\/]android[\\/](?:app[\\/])?(?:\.cxx|\.gradle|build)(?:[\\/].*)?$/,
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
