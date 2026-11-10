import Config from 'react-native-config';
// Existing platform support contacts approved for MultipleRide.
export const SUPPORT_EMAIL = 'ranjeetbaghme2000@gmail.com';
export const SUPPORT_PHONE = '+918949667612';
export const SUPPORT_PHONE_LABEL = '+91 89496 67612';
function httpsUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
export const PRIVACY_POLICY_URL = httpsUrl(Config.PRIVACY_POLICY_URL);
