import { Alert, Linking } from 'react-native';
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_PHONE_LABEL,
} from '../config/support';

/** Opens a dialer/composer for the user's action; does not call or send automatically. */
export async function openSupportContact(channel: 'call' | 'email') {
  const url =
    channel === 'call'
      ? `tel:${SUPPORT_PHONE}`
      : `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
          'MultipleRide Driver support',
        )}`;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(
      'Could not open contact app',
      `Contact support at ${
        channel === 'call' ? SUPPORT_PHONE_LABEL : SUPPORT_EMAIL
      }.`,
    );
  }
}
export async function openDeviceSettings() {
  try {
    await Linking.openSettings();
  } catch {
    Alert.alert(
      'Could not open settings',
      'Open your phone Settings, then Apps, then MultipleRide Partner.',
    );
  }
}
