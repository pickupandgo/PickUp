import { matchesInternalApiKey } from './internal-api-key';

const CURRENT = 'current_internal_key_0123456789abcdef';
const PREVIOUS = 'previous_internal_key_0123456789abcdef';

describe('matchesInternalApiKey', () => {
  it('accepts any configured key (rotation)', () => {
    expect(matchesInternalApiKey(CURRENT, [CURRENT, PREVIOUS])).toBe(true);
    expect(matchesInternalApiKey(PREVIOUS, [CURRENT, PREVIOUS])).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['wrong', 'wrong_internal_key_0123456789abcdefgh'],
    ['a prefix of a real key', CURRENT.slice(0, 32)],
    ['a real key plus extra', `${CURRENT}x`],
    ['malformed', `${CURRENT} `],
  ])('rejects a %s key', (_label, key) => {
    expect(matchesInternalApiKey(key, [CURRENT, PREVIOUS])).toBe(false);
  });

  it('rejects everything when no key is configured', () => {
    expect(matchesInternalApiKey(CURRENT, [])).toBe(false);
  });
});
