import type { ResolvedPlace } from '../api/geocoding';

/** Keep house details in the submitted address, without adding them twice on edit. */
export const withAddressDetails = (place: ResolvedPlace, detail: string): ResolvedPlace => {
  const previous = place.addressDetails?.trim();
  const base = previous && place.address.startsWith(previous + ', ')
    ? place.address.slice(previous.length + 2) : place.address;
  const addressDetails = detail.trim();
  return { ...place, addressDetails: addressDetails || undefined,
    address: addressDetails ? `${addressDetails}, ${base}` : base };
};
