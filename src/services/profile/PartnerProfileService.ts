import { getAuth } from '@react-native-firebase/auth';
import { env } from '../../config/env';

export interface PartnerProfile {
  readonly driverId: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly address: string | null;
  readonly photoUrl: string | null;
  readonly approvalStatus: string;
}
interface SessionUser { uid: string; photoURL?: string | null; getIdToken(force?: boolean): Promise<string> }
export interface ProfileDependencies {
  user(): SessionUser | null;
  baseUrl(): string | undefined;
  fetch: typeof fetch;
}
export class ProfileRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Profile response could not be verified. Please retry.');
  return value as Record<string, unknown>;
};
const nullableText = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;
export const normalizeProfileName = (name: string) => name.trim().replace(/\s+/g, ' ');
export function profileNameError(name: string): string | null {
  const value = normalizeProfileName(name);
  if (!value) return 'Enter your full name.';
  if (value.length < 2 || value.length > 120) return 'Use between 2 and 120 characters.';
  if (!/\p{L}/u.test(value) || Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return 'Enter a valid name without control characters.';
  return null;
}
const live: ProfileDependencies = { user: () => getAuth().currentUser, baseUrl: () => env.PAYMENTS_API_BASE_URL, fetch: (...args) => fetch(...args) };

/** Actual DriverOnly /me contracts. No account ID, verified identity or vehicle fields are submitted. */
export class PartnerProfileService {
  constructor(private readonly deps: ProfileDependencies = live) {}
  private session(uid: string): SessionUser {
    const user = this.deps.user();
    if (!user || user.uid !== uid) throw new ProfileRequestError('Please sign in again to view your profile.', 401);
    return user;
  }
  private async request(uid: string, path: string, method: 'GET' | 'PATCH' = 'GET', body?: object): Promise<unknown> {
    const user = this.session(uid);
    const base = this.deps.baseUrl();
    if (!base) throw new Error('Profile service is unavailable. Please try again later.');
    // Only an explicit 401 may refresh the token and retry. Never retry an ambiguous mutation failure.
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.REQUEST_TIMEOUT_MS);
      try {
        const token = await user.getIdToken(attempt === 1);
        this.session(uid);
        const response = await this.deps.fetch(`${base}${path}`, { method, headers: { Accept: 'application/json',
          'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
        this.session(uid);
        if (response.status === 401 && attempt === 0) continue;
        if (!response.ok) throw new ProfileRequestError(response.status === 401 ? 'Please sign in again to view your profile.'
          : response.status === 403 ? 'Your account cannot update profile details at present.'
            : 'Profile request failed. Please check your connection and retry.', response.status);
        const payload: unknown = await response.json();
        this.session(uid);
        return payload;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw new Error('Profile request timed out. Please retry.');
        throw error;
      } finally { clearTimeout(timer); }
    }
    throw new ProfileRequestError('Please sign in again to view your profile.', 401);
  }
  async load(uid: string): Promise<PartnerProfile> {
    const [summary, account] = await Promise.all([
      this.request(uid, '/v1/drivers/me/onboarding'), this.request(uid, '/v1/drivers/me'),
    ]);
    this.session(uid);
    const s = object(summary); const a = object(account);
    if (typeof a.driverId !== 'string' || a.driverId !== s.driverId || typeof a.phone !== 'string' || typeof a.approvalStatus !== 'string') {
      throw new Error('Profile response could not be verified. Please retry.');
    }
    const extra = s.profile == null ? null : object(s.profile);
    const photo = this.session(uid).photoURL;
    return { driverId: a.driverId, name: nullableText(s.profileName) ?? nullableText(extra?.name) ?? nullableText(a.legalName) ?? '',
      phone: a.phone, email: nullableText(extra?.email) ?? nullableText(a.email), address: nullableText(extra?.residentialAddress),
      photoUrl: photo?.startsWith('https://') ? photo : null, approvalStatus: a.approvalStatus };
  }
  async saveName(uid: string, driverId: string, name: string): Promise<string> {
    const error = profileNameError(name); if (error) throw new Error(error);
    const result = object(await this.request(uid, '/v1/drivers/me/onboarding/profile', 'PATCH', { name: normalizeProfileName(name) }));
    if (result.id !== driverId || typeof result.profileName !== 'string' || profileNameError(result.profileName)) {
      throw new Error('The profile update response could not be verified. Refresh your profile before retrying.');
    }
    return result.profileName;
  }
}
export const partnerProfileService = new PartnerProfileService();
