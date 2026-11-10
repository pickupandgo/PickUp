import { uploadDeliveryProof, type ProofUpload } from '../src/services/trip/DeliveryProofService';
let mockUid = 'driver';
const mockRequest = jest.fn();
jest.mock('../src/services/engine/dispatch', () => ({ getCurrentDriverId: () => mockUid }));
jest.mock('../src/services/engine/engineClient', () => ({ getEngineClient: () => ({ request: mockRequest }) }));
const tripId = '11111111-1111-4111-8111-111111111111';
const stopId = '22222222-2222-4222-8222-222222222222';
const proofId = '33333333-3333-4333-8333-333333333333';
const plan = { proofId, upload: { url: 'https://storage.example/object', headers: { 'content-type': 'image/jpeg', 'content-length': '100' } } };
const originalFetch = globalThis.fetch, originalXHR = globalThis.XMLHttpRequest;
let size: number, sent: jest.Mock, headers: jest.Mock, close: jest.Mock;
const input = () => ({ tripId, stopId, uri: 'file:///photo.jpg', contentType: 'image/jpeg', onPrepared: jest.fn(), onPhase: jest.fn() });
beforeEach(() => {
  mockUid = 'driver'; size = 100; sent = jest.fn(); headers = jest.fn(); close = jest.fn();
  mockRequest.mockReset().mockResolvedValueOnce(plan).mockResolvedValue({ proofId, ready: true });
  globalThis.fetch = jest.fn(async () => ({ blob: async () => ({ size, type: 'image/jpeg', close }) })) as any;
  globalThis.XMLHttpRequest = class {
    status = 200; onload!: () => void; open = jest.fn(); setRequestHeader = headers;
    send = (blob: unknown) => { sent(blob); this.onload(); };
  } as any;
});
afterEach(() => { globalThis.fetch = originalFetch; globalThis.XMLHttpRequest = originalXHR; });
test('uploads bytes before finalization and returns only a durable proof reference', async () => {
  const value = input();
  await expect(uploadDeliveryProof(value)).resolves.toBe(`proof:${proofId}`);
  expect(sent).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
  expect(headers.mock.calls).toEqual([['content-type', 'image/jpeg']]);
  expect(mockRequest.mock.calls.map(call => call[0].path)).toEqual([`/trips/${tripId}/stops/${stopId}/proof`, `/trips/${tripId}/stops/${stopId}/proof/${proofId}/complete`]);
  expect(value.onPrepared).toHaveBeenLastCalledWith({ proofId, uploaded: true });
});
test('verification retry reuses the uploaded immutable object without another PUT', async () => {
  mockRequest.mockReset().mockResolvedValue({ proofId, ready: true });
  await expect(uploadDeliveryProof({ ...input(), previous: { proofId, uploaded: true } })).resolves.toBe(`proof:${proofId}`);
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled();
});
test('failed verification preserves the uploaded handle and cannot claim success', async () => {
  mockRequest.mockReset().mockResolvedValueOnce(plan).mockRejectedValue(new Error('scanner pending'));
  let previous: ProofUpload | undefined;
  await expect(uploadDeliveryProof({ ...input(), onPrepared: value => { previous = value; } })).rejects.toThrow('scanner pending');
  expect(previous).toEqual({ proofId, uploaded: true }); expect(close).toHaveBeenCalled();
});
test('oversized and remote files cannot initiate storage access', async () => {
  size = 6 * 1024 * 1024;
  await expect(uploadDeliveryProof(input())).rejects.toThrow('5 MB');
  await expect(uploadDeliveryProof({ ...input(), uri: 'https://public.example/photo' })).rejects.toThrow('Retake');
  expect(mockRequest).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled();
});
test('an account switch or inactive screen fences a delayed upload plan', async () => {
  mockRequest.mockReset().mockImplementationOnce(async () => { mockUid = 'next-driver'; return plan; });
  await expect(uploadDeliveryProof(input())).rejects.toThrow('session changed');
  expect(sent).not.toHaveBeenCalled(); expect(mockRequest).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalled();
  mockUid = 'driver';
  await expect(uploadDeliveryProof({ ...input(), isCurrent: () => false })).rejects.toThrow('session changed');
});
test('an insecure storage target is rejected without sending photo bytes', async () => {
  mockRequest.mockReset().mockResolvedValue({ ...plan, upload: { ...plan.upload, url: 'http://storage.example/photo' } });
  await expect(uploadDeliveryProof(input())).rejects.toThrow('Secure photo upload');
  expect(sent).not.toHaveBeenCalled(); expect(close).toHaveBeenCalled();
});
