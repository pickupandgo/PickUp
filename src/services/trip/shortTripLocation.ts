/** Display-only fallback for the engine's formatted-address strings.
 * The inspected TripView has no structured locality/city components. Never write this result
 * back into trip data or use it for geocoding, map directions or API requests.
 */
const states = new Set([
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat',
  'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh',
  'maharashtra', 'manipur', 'meghalaya', 'mizoram', 'nagaland', 'odisha', 'orissa', 'punjab',
  'rajasthan', 'sikkim', 'tamil nadu', 'telangana', 'tripura', 'uttar pradesh', 'uttarakhand',
  'west bengal', 'andaman and nicobar islands', 'dadra and nagar haveli and daman and diu',
  'jammu and kashmir', 'ladakh', 'lakshadweep',
]);
const key = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-IN');
export function shortTripLocation(address: string | null | undefined): string {
  if (!address?.trim()) return 'Location unavailable';
  const parts = address.split(',').map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const names = new Set(parts.map(key));
  const seen = new Set<string>();
  const display = parts.filter(part => {
    const normalized = key(part);
    if (/^(india|bharat|भारत)$/.test(normalized) || /^(?:(?:pin|pincode|pin code|postal code)\s*[: -]?\s*)?[1-9]\d{5}$/i.test(normalized)) return false;
    // A state followed by its PIN is metadata; a numbered street/locality is preserved.
    if (states.has(normalized) || states.has(normalized.replace(/\s+[1-9]\d{5}$/, ''))) return false;
    const administrative = normalized.match(/^(.+?)\s+(?:tehsil|tahsil|taluk|taluka|district|division|subdistrict|mandal)$/);
    // Only remove this administrative name if its unqualified name is actually present.
    if (administrative && names.has(administrative[1])) return false;
    if (seen.has(normalized)) return false;
    seen.add(normalized); return true;
  }).map(part => key(part) === 'gg' ? 'GG' : part);
  return display.join(', ') || 'Location unavailable';
}
