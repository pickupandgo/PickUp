import { env } from '../../config/env';

export interface NotificationIdentity {
  uid: string;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

/** Existing NestJS token endpoints; identity comes from the bearer token, never the body. */
export function createNotificationBackend(user: NotificationIdentity, isCurrent: () => boolean) {
  const request = async (method: 'POST' | 'DELETE', token: string, language = 'en') => {
    if (!env.PAYMENTS_API_BASE_URL) throw new Error('Notification service is not configured.');
    for (let attempt = 0; attempt < 2; attempt++) {
      const bearer = await user.getIdToken(attempt === 1);
      if (!isCurrent()) throw new Error('Notification session changed.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(`${env.PAYMENTS_API_BASE_URL}/v1/notifications/tokens`, {
          method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
          body: JSON.stringify(method === 'POST' ? { token, role: 'DRIVER', platform: 'ANDROID', language } : { token }),
          signal: controller.signal,
        });
        if (response.status === 401 && attempt === 0) continue;
        if (!response.ok) throw new Error('Could not update notification registration. Please retry.');
        const result = await response.json();
        if (method === 'POST' && (result.token !== token || result.role !== 'DRIVER' || typeof result.userId !== 'string')) {
          throw new Error('Notification registration returned an invalid response.');
        }
        if (method === 'DELETE' && result.success !== true) throw new Error('Could not deactivate notification registration.');
        return result as { userId?: string };
      } finally { clearTimeout(timer); }
    }
    throw new Error('Notification registration needs a valid sign-in session.');
  };
  return { register: (token: string, language: string) => request('POST', token, language),
    unregister: (token: string) => request('DELETE', token) };
}
