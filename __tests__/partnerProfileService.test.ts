import { PartnerProfileService, profileNameError, type ProfileDependencies } from '../src/services/profile/PartnerProfileService';

let uid: string | null;
const token = jest.fn(async (_force?: boolean) => 'test-token');
let network: jest.Mock;
let service: PartnerProfileService;
const account = { driverId: 'driver-account', phone: '+919000000001', approvalStatus: 'APPROVED', legalName: 'Verified identity', email: 'partner@example.test', drivingLicenseNumber: 'do-not-project', walletBalancePaise: 999 };
const summary = { driverId: 'driver-account', profileName: 'Actual Partner', profile: { residentialAddress: 'Actual address' }, kyc: { documents: [{ storageKey: 'private' }] } };
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
beforeEach(() => {
  uid = 'firebase-partner'; token.mockClear();
  network = jest.fn(async (url: string) => response(url.endsWith('/onboarding') ? summary : account));
  service = new PartnerProfileService({ user: () => uid ? { uid, photoURL: 'https://example.test/avatar.png', getIdToken: token } : null,
    baseUrl: () => 'https://backend.example.test', fetch: network as ProfileDependencies['fetch'] });
});

test('loads actual authenticated /me fields and drops protected document/payment data', async () => {
  const profile = await service.load('firebase-partner');
  expect(profile).toEqual({ driverId: 'driver-account', name: 'Actual Partner', phone: account.phone, email: account.email,
    address: 'Actual address', approvalStatus: 'APPROVED', photoUrl: 'https://example.test/avatar.png' });
  expect(network.mock.calls.map(call => call[0])).toEqual(['https://backend.example.test/v1/drivers/me/onboarding', 'https://backend.example.test/v1/drivers/me']);
  for (const [, init] of network.mock.calls) expect(init.headers.Authorization).toBe('Bearer test-token');
  expect(JSON.stringify(profile)).not.toMatch(/do-not-project|storageKey|walletBalance/);
});
test('absent optional details stay absent and verified legal name is only a display fallback', async () => {
  network.mockImplementation(async (url: string) => response(url.endsWith('/onboarding') ? { driverId: account.driverId, profileName: null } : { ...account, email: null }));
  expect(await service.load('firebase-partner')).toMatchObject({ name: account.legalName, email: null, address: null });
});
test('name PATCH only sends permitted normalized name; never an identity or partner ID', async () => {
  network.mockResolvedValue(response({ id: account.driverId, profileName: 'नाम Partner', updatedAt: '2026-11-02T06:00:00Z' }));
  await expect(service.saveName('firebase-partner', account.driverId, '  नाम   Partner  ')).resolves.toBe('नाम Partner');
  expect(network).toHaveBeenCalledTimes(1);
  const [url, init] = network.mock.calls[0];
  expect(url).toBe('https://backend.example.test/v1/drivers/me/onboarding/profile');
  expect(init.method).toBe('PATCH'); expect(JSON.parse(init.body)).toEqual({ name: 'नाम Partner' });
});
test.each(['', 'A', '12345', 'x'.repeat(121), 'Name\u0000Here'])('invalid name %p never reaches backend', async name => {
  expect(profileNameError(name)).not.toBeNull();
  await expect(service.saveName('firebase-partner', account.driverId, name)).rejects.toThrow(); expect(network).not.toHaveBeenCalled();
});
test('401 refreshes a token once; unauthorized/forbidden errors never become success', async () => {
  network.mockResolvedValueOnce(response({}, 401)).mockResolvedValueOnce(response({ id: account.driverId, profileName: 'Saved name' }));
  await expect(service.saveName('firebase-partner', account.driverId, 'Saved name')).resolves.toBe('Saved name');
  expect(token.mock.calls.map(call => call[0])).toEqual([false, true]);
  network.mockReset().mockResolvedValue(response({}, 403));
  await expect(service.saveName('firebase-partner', account.driverId, 'Saved name')).rejects.toMatchObject({ status: 403 });
  expect(network).toHaveBeenCalledTimes(1);
});
test('network failure does not retry an ambiguous profile mutation or claim success', async () => {
  network.mockRejectedValue(new Error('Offline'));
  await expect(service.saveName('firebase-partner', account.driverId, 'Saved name')).rejects.toThrow('Offline');
  expect(network).toHaveBeenCalledTimes(1);
});
test('logout and account switching discard in-flight data and prevent writes under another UID', async () => {
  uid = null; await expect(service.load('firebase-partner')).rejects.toMatchObject({ status: 401 });
  expect(network).not.toHaveBeenCalled(); uid = 'firebase-partner';
  network.mockImplementation(async () => { uid = 'other-partner'; return response(account); });
  await expect(service.load('firebase-partner')).rejects.toMatchObject({ status: 401 });
  await expect(service.saveName('firebase-partner', account.driverId, 'Saved name')).rejects.toMatchObject({ status: 401 });
});
test('inconsistent account IDs and malformed save acknowledgements are rejected', async () => {
  network.mockImplementation(async (url: string) => response(url.endsWith('/onboarding') ? { ...summary, driverId: 'other-driver' } : account));
  await expect(service.load('firebase-partner')).rejects.toThrow('could not be verified');
  network.mockResolvedValue(response({ id: 'other-driver', profileName: 'Other name' }));
  await expect(service.saveName('firebase-partner', account.driverId, 'Saved name')).rejects.toThrow('could not be verified');
});
