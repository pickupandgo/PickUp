/** Collection preference is a booking instruction, never a payment confirmation. */
export const collectionInstructions = (instructions: string | undefined, preference: 'CASH' | 'UPI' = 'CASH'): string => {
  const note = `Payment preference: ${preference === 'UPI' ? 'UPI (driver collection)' : 'Cash'}.`;
  // Engine metadata instructions accept at most 1000 characters. Preserve user instructions first.
  const original = instructions?.trim() ?? '';
  return original ? `${original.slice(0, 1000 - note.length - 1)}\n${note}` : note;
};
