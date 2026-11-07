import { Alert, Linking } from 'react-native';
import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_LABEL } from '../config/support';
import { APP_NAME } from '../config/brand';

/** Opens the customer's dialer/mail composer; never calls or sends automatically. */
export async function openSupportContact(channel: 'call' | 'email', tripReference?: string) {
  const subject = `${APP_NAME} support${tripReference ? ` - ${tripReference}` : ''}`;
  const body = tripReference ? `Trip reference: ${tripReference}\n\nPlease describe your issue:\n` : '';
  const url = channel === 'call' ? `tel:${SUPPORT_PHONE}` : `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  try { await Linking.openURL(url); }
  catch { Alert.alert(channel === 'call' ? 'Could not open the dialer' : 'Could not open an email app', `You can contact support at ${channel === 'call' ? SUPPORT_PHONE_LABEL : SUPPORT_EMAIL}.`); }
}
