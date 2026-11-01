import { getVehiclePreview } from '../src/api/vehiclePreview';
import { request } from '../src/api/http';
jest.mock('../src/api/http', () => ({ ...jest.requireActual('../src/api/http'), request: jest.fn() }));
it('accepts only selected-category fresh coordinates and preserves original capture age', async () => {
  const now = Date.now();
  const base = { key: 'a'.repeat(20), latitude: 26, longitude: 73, vehicleCategory: 'TWO_WHEELER', capturedAt: now - 50000 };
  (request as jest.Mock).mockResolvedValue({ success: true, generatedAt: now, vehicles: [base, { ...base, key: 'b'.repeat(20), vehicleCategory: 'MINI_TRUCK' }, { ...base, key: 'c'.repeat(20), capturedAt: now - 61000 }, { ...base, key: 'd'.repeat(20), latitude: NaN }] });
  const result = await getVehiclePreview({ latitude: 26, longitude: 73 }, 'TWO_WHEELER', new AbortController().signal);
  expect(result).toHaveLength(1);
  expect(result[0].expiresAt - Date.now()).toBeLessThanOrEqual(10000);
  expect(request).toHaveBeenCalledWith(expect.stringContaining('vehicleCategory=TWO_WHEELER'), expect.objectContaining({ retries: 0, timeoutMs: 10000 }));
});
it('rejects an incompatible server response instead of silently fabricating availability', async () => {
  (request as jest.Mock).mockResolvedValue({ success: true, vehicles: [] });
  await expect(getVehiclePreview({ latitude: 26, longitude: 73 }, 'TWO_WHEELER', new AbortController().signal)).rejects.toMatchObject({ kind: 'parse' });
});
