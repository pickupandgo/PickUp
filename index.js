/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Global error shield to prevent silent crash exits on unhandled JS exceptions
if (typeof global !== 'undefined' && global.ErrorUtils) {
  const defaultHandler =
    typeof global.ErrorUtils.getGlobalHandler === 'function'
      ? global.ErrorUtils.getGlobalHandler()
      : null;

  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.warn('[GlobalErrorShield] Unhandled exception intercepted:', error, 'isFatal:', isFatal);
    if (__DEV__ && defaultHandler) {
      defaultHandler(error, isFatal);
    }
  });
}

AppRegistry.registerComponent(appName, () => App);
