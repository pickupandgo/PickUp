import { compareNames, nameTokens } from './name-match';

describe('name match', () => {
  it('normalises case, punctuation, honorifics and accents', () => {
    expect(nameTokens('Mr. Ramesh  Kumar')).toEqual(['RAMESH', 'KUMAR']);
    expect(nameTokens('SMT. Sunita-Devi')).toEqual(['SUNITA', 'DEVI']);
    expect(nameTokens('José Fernandes')).toEqual(['JOSE', 'FERNANDES']);
  });

  it.each([
    ['Ramesh Kumar', 'RAMESH KUMAR', 'MATCH'],
    ['Ramesh Kumar', 'MR RAMESH KUMAR', 'MATCH'],
    ['Ramesh Kumar', 'KUMAR RAMESH', 'MATCH'],
    ['Ramesh Kumar', 'R KUMAR', 'PARTIAL'],
    ['Ramesh Kumar Yadav', 'RAMESH YADAV', 'PARTIAL'],
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
});
