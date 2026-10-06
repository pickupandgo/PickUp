/**
 * Compares the account holder name the bank reports (bank validation) with the driver's KYC
 * legal name. The result is evidence for the admin, who makes the approval decision:
 *
 *   MATCH        same words after normalisation (case, punctuation, honorifics, word order)
 *   PARTIAL      every word of the shorter name matches the longer one, allowing initials
 *                ("R KUMAR" vs "RAMESH KUMAR"): an admin must record why it is acceptable
 *   MISMATCH     anything else: an admin must record a resolution, or reject the account
 *   UNAVAILABLE  one of the names is missing (e.g. the bank returned no name)
 */

export type NameMatchResult = 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'UNAVAILABLE';

/** Titles and business prefixes banks commonly add to the registered name. */
const HONORIFICS: ReadonlySet<string> = new Set([
  'MR',
  'MRS',
  'MS',
  'MISS',
  'SHRI',
  'SRI',
  'SMT',
  'KUMARI',
  'KUM',
  'DR',
  'MS/S',
  'M/S',
  'MESSRS',
]);

/** Upper-case words with titles and punctuation removed. */
export function nameTokens(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^\p{L}\s/]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/\//g, ''))
    .filter((token) => token.length > 0 && !HONORIFICS.has(token));
}

export function compareNames(
  kycName: string | null | undefined,
  registeredName: string | null | undefined,
): NameMatchResult {
  if (!kycName || !registeredName) {
    return 'UNAVAILABLE';
  }
  const kyc = nameTokens(kycName);
  const bank = nameTokens(registeredName);
  if (kyc.length === 0 || bank.length === 0) {
    return 'UNAVAILABLE';
  }
  if (sameWords(kyc, bank)) {
    return 'MATCH';
  }
  // Either side may carry the initials ("R KUMAR" vs "RAMESH KUMAR" and the reverse).
  const partial =
    (bank.length <= kyc.length && coveredWithInitials(bank, kyc)) ||
    (kyc.length <= bank.length && coveredWithInitials(kyc, bank));
  return partial ? 'PARTIAL' : 'MISMATCH';
}

function sameWords(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((token, index) => token === sortedB[index]);
}

/**
 * True when each word of `shorter` can be paired with a different word of `longer`, either
 * exactly or as an initial (a single letter matching a word's first letter). At least one pair
 * must be an exact full word, so two sets of initials never "match".
 */
function coveredWithInitials(shorter: readonly string[], longer: readonly string[]): boolean {
  const remaining = [...longer];
  let exactWords = 0;
  // Exact words first, so an initial never takes the word an exact match needs.
  const initials: string[] = [];
  for (const token of shorter) {
    const index = remaining.indexOf(token);
    if (index >= 0) {
      remaining.splice(index, 1);
      if (token.length > 1) {
        exactWords += 1;
      }
    } else {
      initials.push(token);
    }
  }
  for (const token of initials) {
    if (token.length !== 1) {
      return false;
    }
    const index = remaining.findIndex((word) => word.startsWith(token));
    if (index < 0) {
      return false;
    }
    remaining.splice(index, 1);
  }
  return exactWords > 0;
}
