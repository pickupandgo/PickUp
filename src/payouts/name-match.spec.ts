import { compareNames, nameTokens } from './name-match';

describe('name match', () => {
  it('normalises case, punctuation, honorifics and accents', () => {
    expect(nameTokens('Mr. Ramesh  Kumar')).toEqual(['RAMESH', 'KUMAR']);
    expect(nameTokens('SMT. Sunita-Devi')).toEqual(['SUNITA', 'DEVI']);
    expect(nameTokens('José Fernandes')).toEqual(['JOSE', 'FERNANDES']);
  });

  it.each([
    // MATCH: the same words in the same order; only case, punctuation and titles ignored.
    ['Ramesh Kumar', 'RAMESH KUMAR', 'MATCH'],
    ['Ramesh Kumar', 'MR RAMESH KUMAR', 'MATCH'],
    ['Ramesh Kumar', 'ramesh  kumar.', 'MATCH'],
    ['Sunita Devi', 'SMT. SUNITA-DEVI', 'MATCH'],
    // Not exact, so never MATCH: an admin must resolve each one in writing.
    ['Ramesh Kumar', 'KUMAR RAMESH', 'PARTIAL'],
    ['Ramesh Kumar Yadav', 'YADAV RAMESH KUMAR', 'PARTIAL'],
    ['Ramesh Kumar', 'R KUMAR', 'PARTIAL'],
    ['Ramesh Kumar', 'KUMAR R', 'PARTIAL'],
    ['Ramesh Kumar Yadav', 'RAMESH YADAV', 'PARTIAL'],
    ['Ramesh Kumar', 'RAMESH KUMAR YADAV', 'PARTIAL'],
    ['Ramesh Kumar', 'R K', 'MISMATCH'],
    ['Ramesh Kumar', 'SURESH KUMAR', 'MISMATCH'],
    ['Ramesh Kumar', 'ANITA SHARMA', 'MISMATCH'],
    ['Ramesh Kumar', 'NIKHIL ENTERPRISES', 'MISMATCH'],
    ['Ramesh Kumar', null, 'UNAVAILABLE'],
    [null, 'RAMESH KUMAR', 'UNAVAILABLE'],
    ['Ramesh Kumar', 'MR.', 'UNAVAILABLE'],
  ] as const)('%p vs %p is %p', (kyc, bank, expected) => {
    expect(compareNames(kyc, bank)).toBe(expected);
  });

  it('is MATCH only when the normalised words are identical and in order', () => {
    const pairs: [string, string][] = [
      ['Ramesh Kumar', 'KUMAR RAMESH'],
      ['Ramesh Kumar', 'R KUMAR'],
      ['Ramesh Kumar', 'RAMESH KUMAR YADAV'],
    ];
    for (const [kyc, bank] of pairs) {
      expect(nameTokens(kyc)).not.toEqual(nameTokens(bank));
      expect(compareNames(kyc, bank)).not.toBe('MATCH');
    }
  });
});
