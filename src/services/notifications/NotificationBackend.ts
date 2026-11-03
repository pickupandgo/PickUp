import { createNotificationRequest } from './NotificationApi';

export interface NotificationIdentity {
  uid: string;
  getIdToken(forceRefresh?: boolean): Promise<string>;
}

/** Existing NestJS token endpoints; identity comes from the bearer token, never the body. */
export function createNotificationBackend(
  user: NotificationIdentity,
  isCurrent: () => boolean,
) {
  const call = createNotificationRequest(user, isCurrent);
  const request = async (
    method: 'POST' | 'DELETE',
    token: string,
    language = 'en',
  ) => {
    const result = (await call(
      '/v1/notifications/tokens',
      method,
      method === 'POST'
        ? { token, role: 'DRIVER', platform: 'ANDROID', language }
        : { token },
    )) as { token?: string; role?: string; userId?: string; success?: boolean };
    if (!result)
      throw new Error(
        'Notification registration returned an invalid response.',
      );
    if (
      method === 'POST' &&
      (result.token !== token ||
        result.role !== 'DRIVER' ||
        typeof result.userId !== 'string')
    ) {
      throw new Error(
        'Notification registration returned an invalid response.',
      );
    }
    if (method === 'DELETE' && result.success !== true)
      throw new Error('Could not deactivate notification registration.');
    return result as { userId?: string };
  };
  return {
    register: (token: string, language: string) =>
      request('POST', token, language),
    unregister: (token: string) => request('DELETE', token),
  };
}
