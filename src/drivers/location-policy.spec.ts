import { validateFix } from './location-policy';
const now = 1_800_000_000_000;
const valid = { latitude: 26.2, longitude: 73.1, capturedAt: now, accuracy: 5 };
it('accepts real finite coordinates, a recent capture time and bounded accuracy', () => {
  expect(() => validateFix(valid, now)).not.toThrow();
});
it.each([
  { latitude: NaN },
  { longitude: Infinity },
  { latitude: 91 },
  { longitude: -181 },
  { capturedAt: now - 30001 },
  { capturedAt: now + 5001 },
  { capturedAt: '1800000000000' },
  { accuracy: -1 },
  { accuracy: 101 },
  { accuracy: undefined },
  { tripId: 'other-driver-trip' },
  { driverId: 'spoofed' },
])('rejects invalid or stale GPS input: %j', (patch) => {
  expect(() => validateFix({ ...valid, ...patch } as never, now)).toThrow();
});
it('rejects null and malformed bodies', () => {
  for (const body of [null, [], 'GPS', {}])
    expect(() => validateFix(body as never, now)).toThrow();
});
