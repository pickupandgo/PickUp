import { isFreshFix, newestFix } from '../src/location/fixPolicy';
import type { LocationResult } from '../src/location/types';
const now = 1800000000000;
const fix = (timestamp = now) => ({ latitude: 26.2, longitude: 73.1, accuracy: 5, timestamp } as LocationResult);
it('accepts only bounded, accurate and fresh GPS fixes', () => {
  expect(isFreshFix(fix(), now)).toBe(true);
  for (const value of [null, fix(now - 30001), fix(now + 5001), { ...fix(), accuracy: 101 }, { ...fix(), latitude: NaN }, { ...fix(), longitude: 181 }]) {
    expect(isFreshFix(value, now)).toBe(false);
  }
});
it('does not let a slower one-shot or event replace a newer fix and expires unknown GPS', () => {
  const current = fix();
  expect(newestFix(current, fix(now - 1), now)).toBe(current);
  expect(newestFix(current, fix(now + 1), now)?.timestamp).toBe(now + 1);
  expect(newestFix(null, fix(now - 31000), now)).toBeNull();
});
