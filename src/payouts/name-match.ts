/**
 * Compares the account holder name the bank reports (bank validation) with the driver's KYC
 * legal name. The result is evidence for the admin, who makes the approval decision:
 *
 *   MATCH        exactly the same words in the same order, ignoring only case, punctuation,
 *                accents and honorifics ("Mr. Ramesh Kumar" vs "RAMESH KUMAR"). The only
 *                result an admin may approve without a written resolution.
 *   PARTIAL      the same words in another order ("KUMAR RAMESH"), or every word of the
 *                shorter name matching the longer one, allowing initials ("R KUMAR") or a
 *                missing middle name: an admin must record why it is acceptable
 *   MISMATCH     anything else: an admin must record a resolution, or reject the account
 *   UNAVAILABLE  one of the names is missing (e.g. the bank returned no name): needs a
 *                resolution too
 *
 * Every non-MATCH approval is refused without a resolution (API and database) and audited as
 * BANK_NAME_MISMATCH_RESOLVED with both names (OPEN_DECISIONS D-60).
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
  if (sameWordsInOrder(kyc, bank)) {
    return 'MATCH';
  }
  // Reordered words, and initials on either side ("R KUMAR" vs "RAMESH KUMAR" and the reverse).
  const partial =
    (bank.length <= kyc.length && coveredWithInitials(bank, kyc)) ||
    (kyc.length <= bank.length && coveredWithInitials(kyc, bank));
  return partial ? 'PARTIAL' : 'MISMATCH';
}

function sameWordsInOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((token, index) => token === b[index]);
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
