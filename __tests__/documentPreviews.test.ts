import { NativeModules } from 'react-native';
import { DriverOnboardingService, OnboardingRequestError, type DriverOnboardingSummary } from '../src/services/onboarding/DriverOnboardingService';
import { clearDocumentPreviews, documentReviewInfo, getDocumentPreview, invalidateDocumentPreview, observePreviewPrivacy, savedDocuments, statusLabel } from '../src/services/documents/DocumentPreviewService';

let mockUser: { uid: string } | null = { uid: 'owner' };
let mockAuthListener: (user: typeof mockUser) => void;
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockUser }),
  onAuthStateChanged: (_auth: unknown, listener: typeof mockAuthListener) => { mockAuthListener = listener; return () => {}; },
}));
const kyc = { id: 'photo', version: 1, documentType: 'DRIVER_PHOTO', status: 'VERIFIED' as const, createdAt: '2026-11-01' };
const rc = { ...kyc, id: 'rc', documentType: 'REGISTRATION_CERTIFICATE' };
const summary = {
  kyc: { documents: [kyc] },
  vehicles: [{ id: 'vehicle-a', documents: [rc] }, { id: 'vehicle-b', documents: [{ ...rc, id: 'other-rc' }] }],
} as unknown as DriverOnboardingSummary;
const ref = { kind: 'KYC' as const, documentId: 'photo' };
let grant: jest.SpyInstance;
let metadata: jest.SpyInstance;
const open = jest.fn();
beforeEach(() => {
  mockUser = { uid: 'owner' };
  NativeModules.PrivateDocuments = { open, clear: jest.fn(), render: jest.fn() };
  clearDocumentPreviews();
  open.mockReset().mockResolvedValue({ handle: 'private-handle', pageCount: 1, pages: [{ width: 800, height: 600 }] });
  grant = jest.spyOn(DriverOnboardingService.getInstance(), 'previewDocument').mockResolvedValue({ url: 'https://private.example/object?signature=short', contentType: 'image/jpeg', expiresInSeconds: 60 });
  metadata = jest.spyOn(DriverOnboardingService.getInstance(), 'getSummary').mockResolvedValue(summary);
});
afterEach(() => { clearDocumentPreviews(); jest.restoreAllMocks(); });

test('uses authenticated saved records and returns only an opaque native handle, never the URL', async () => {
  const value = await getDocumentPreview(ref);
  expect(grant).toHaveBeenCalledWith('KYC', 'photo');
  expect(open).toHaveBeenCalledWith('https://private.example/object?signature=short', 'image/jpeg', 60000);
  expect(value.name).toBe('Driver photo');
  expect(value.status).toBe('VERIFIED');
  expect(value).not.toHaveProperty('url'); expect(value).not.toHaveProperty('storageKey');
});
test('unauthenticated access cannot request metadata or a preview grant', async () => {
  mockUser = null;
  await expect(getDocumentPreview(ref)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect(metadata).not.toHaveBeenCalled(); expect(grant).not.toHaveBeenCalled();
});
test('another partner document cannot be opened', async () => {
  await expect(getDocumentPreview({ kind: 'KYC', documentId: 'not-owned' })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  expect(grant).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
});
test('vehicle-document IDs cannot be mixed across vehicles or requested without a vehicle ID', async () => {
  await expect(getDocumentPreview({ kind: 'VEHICLE', documentId: 'rc', vehicleId: 'vehicle-b' })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  await expect(getDocumentPreview({ kind: 'VEHICLE', documentId: 'rc' })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  expect(grant).not.toHaveBeenCalled();
  await expect(getDocumentPreview({ kind: 'VEHICLE', documentId: 'rc', vehicleId: 'vehicle-a' })).resolves.toHaveProperty('handle');
});
test.each([401, 403, 404, 409, 500])('backend status %i becomes an explicit private-preview failure', async status => {
  grant.mockRejectedValue(new OnboardingRequestError('upstream', status));
  await expect(getDocumentPreview(ref)).rejects.toMatchObject({ code: { 401: 'UNAUTHENTICATED', 403: 'ACCESS_DENIED', 404: 'UNAVAILABLE', 409: 'NOT_READY', 500: 'NETWORK' }[status] });
  expect(open).not.toHaveBeenCalled();
});
test('PDF uses the native renderer and exposes multiple pages without inventing an image URL', async () => {
  grant.mockResolvedValue({ url: 'https://private.example/doc', contentType: 'application/pdf', expiresInSeconds: 30 });
  open.mockResolvedValue({ handle: 'pdf', pageCount: 2, pages: [{ width: 600, height: 800 }, { width: 600, height: 800 }] });
  expect((await getDocumentPreview(ref)).pageCount).toBe(2);
  expect(open).toHaveBeenCalledWith('https://private.example/doc', 'application/pdf', 30000);
});
test.each([
  ['http://public.example/object', 'image/jpeg', 60, 'UNAVAILABLE'],
  ['https://name:password@example.com/object', 'image/jpeg', 60, 'UNAVAILABLE'],
  ['https://private.example/object', 'image/svg+xml', 60, 'UNSUPPORTED'],
  ['https://private.example/object', 'image/jpeg', 0, 'UNAVAILABLE'],
])('refuses insecure or unsupported grants', async (url, contentType, expiresInSeconds, code) => {
  grant.mockResolvedValue({ url, contentType, expiresInSeconds });
  await expect(getDocumentPreview(ref)).rejects.toMatchObject({ code });
  expect(open).not.toHaveBeenCalled();
});
test('Retry obtains a fresh authorized grant rather than reusing a failed/expired URL', async () => {
  open.mockRejectedValueOnce({ code: 'EXPIRED' });
  await expect(getDocumentPreview(ref)).rejects.toMatchObject({ code: 'EXPIRED' });
  await expect(getDocumentPreview(ref)).resolves.toHaveProperty('handle');
  expect(grant).toHaveBeenCalledTimes(2);
  invalidateDocumentPreview(ref);
  await getDocumentPreview(ref);
  expect(grant).toHaveBeenCalledTimes(3);
});
test('logout invalidates in-flight grants and clears native private files', async () => {
  const changed = jest.fn(); const stop = observePreviewPrivacy(changed);
  let resolve!: (value: unknown) => void;
  grant.mockImplementation(() => new Promise(done => { resolve = done; }));
  const work = getDocumentPreview(ref);
  await Promise.resolve(); await Promise.resolve();
  mockUser = null; mockAuthListener(null);
  resolve({ url: 'https://private.example/object', contentType: 'image/jpeg', expiresInSeconds: 60 });
  await expect(work).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect(changed).toHaveBeenCalled(); expect(NativeModules.PrivateDocuments.clear).toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled(); stop();
});
test('latest versions are listed by actual type, without hardcoded missing records', () => {
  const records = savedDocuments({ ...summary, kyc: { documents: [kyc, { ...kyc, id: 'new-photo', version: 2, status: 'REJECTED' }] } } as unknown as DriverOnboardingSummary, 'KYC');
  expect(records).toHaveLength(1); expect(records[0].record.id).toBe('new-photo');
  expect(statusLabel(records[0].record.status)).toBe('Rejected');
});
test('expired grants are refreshed through the authorized backend', async () => {
  const first = await getDocumentPreview(ref);
  jest.spyOn(Date, 'now').mockReturnValue(first.expiresAt + 1);
  await getDocumentPreview(ref);
  expect(grant).toHaveBeenCalledTimes(2); expect(metadata).toHaveBeenCalledTimes(2);
});
test('account switching clears private cache and does not reuse the previous owner’s document', async () => {
  const stop = observePreviewPrivacy(jest.fn());
  await getDocumentPreview(ref);
  mockUser = { uid: 'different-partner' }; mockAuthListener(mockUser);
  metadata.mockResolvedValue({ ...summary, kyc: null, vehicles: [] });
  await expect(getDocumentPreview(ref)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  expect(grant).toHaveBeenCalledTimes(1); expect(NativeModules.PrivateDocuments.clear).toHaveBeenCalled(); stop();
});
test('review information uses only supplied valid timestamps', () => {
  expect(documentReviewInfo(kyc)).toBeNull();
  expect(documentReviewInfo({ ...kyc, reviewedAt: 'not-a-date' })).toBeNull();
  expect(documentReviewInfo({ ...kyc, reviewedAt: '2026-11-02T00:00:00Z' })).toMatch(/^Last reviewed:/);
  expect(documentReviewInfo({ ...kyc, uploadedAt: '2026-11-01T00:00:00Z' })).toMatch(/^Uploaded:/);
});
