/** Normalizes a provider method name (upi, card, netbanking, ...) for storage: UPI, CARD, ... */
export function normalizeMethod(method: string | null): string | null {
  if (!method) {
    return null;
  }
  const cleaned = method
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '')
    .slice(0, 40);
  return cleaned.length > 0 ? cleaned : null;
}
