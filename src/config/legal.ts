import Config from 'react-native-config';
import { Linking } from 'react-native';

export function approvedHttpsUrl(value?: string): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export const legalLinks = {
  // Approved by the product owner in the implementation request, 2 November 2026.
  privacy: approvedHttpsUrl(Config.PRIVACY_POLICY_URL ?? 'https://www.multipleride.com/privacy'),
  terms: approvedHttpsUrl(Config.TERMS_OF_SERVICE_URL),
  support: approvedHttpsUrl(Config.PARTNER_SUPPORT_URL),
};
export async function openApprovedLink(url: string | null): Promise<void> {
  const safe = approvedHttpsUrl(url ?? undefined);
  if (!safe) throw new Error('This information is not available yet. Please try again later.');
  try { await Linking.openURL(safe); }
  catch { throw new Error('Could not open this page. Check your connection and try again.'); }
}
