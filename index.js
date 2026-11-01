import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Android displays the generic notification payload; private details remain in the server inbox.
setBackgroundMessageHandler(getMessaging(), async () => {});

AppRegistry.registerComponent(appName, () => App);
