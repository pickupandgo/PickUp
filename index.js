/**
 * @format
 */

import { AppRegistry } from 'react-native';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';
import { updateBackgroundOffer } from './src/services/notifications/backgroundOffer';

// FCM renders background/terminated notification payloads itself. Do not display a
// second local notification or save push payloads as notification history.
setBackgroundMessageHandler(getMessaging(), async message => { await updateBackgroundOffer(message).catch(() => {}); });
AppRegistry.registerComponent(appName, () => App);
