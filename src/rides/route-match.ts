/**
 * The trip runs the route that was priced: the quote's pickup and drops, in its order. Details a
 * customer adds may repeat coordinates; they must then be the quote's. The payment backend
 * stores coordinates with 6 decimals, so a match is within half of the last decimal.
 */
const TOLERANCE = 0.0000005 + 1e-9;

export interface Point {
  readonly latitude: number;
  readonly longitude: number;
}

export interface PartialPoint {
  readonly latitude?: number;
  readonly longitude?: number;
}

export type RouteMismatch =
  | {
      readonly kind: 'DROP_COUNT';
      readonly expected: number;
      readonly received: number;
    }
  | { readonly kind: 'PICKUP_MOVED' }
  | { readonly kind: 'DROP_MOVED'; readonly sequence: number }
  | { readonly kind: 'PARTIAL_COORDINATES'; readonly where: string };

export function sameCoordinate(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE;
}

function checkPoint(
  quoted: Point,
  given: PartialPoint | undefined,
  where: string,
): RouteMismatch | 'MOVED' | null {
  if (!given) {
    return null;
  }
  const hasLat = given.latitude !== undefined;
  const hasLng = given.longitude !== undefined;
  if (hasLat !== hasLng) {
    return { kind: 'PARTIAL_COORDINATES', where };
  }
  if (
    !hasLat ||
    given.latitude === undefined ||
    given.longitude === undefined
  ) {
    return null;
  }
  return sameCoordinate(quoted.latitude, given.latitude) &&
    sameCoordinate(quoted.longitude, given.longitude)
    ? null
    : 'MOVED';
}

/** Null when the customer's details fit the quoted route. */
export function matchRoute(
  quote: { readonly pickup: Point; readonly drops: readonly Point[] },
  details: {
    readonly pickup?: PartialPoint;
    readonly drops?: readonly PartialPoint[];
  },
): RouteMismatch | null {
  const pickup = checkPoint(quote.pickup, details.pickup, 'pickup');
  if (pickup === 'MOVED') {
    return { kind: 'PICKUP_MOVED' };
  }
  if (pickup) {
    return pickup;
  }
  if (details.drops === undefined) {
    return null;
  }
  if (details.drops.length !== quote.drops.length) {
    return {
      kind: 'DROP_COUNT',
      expected: quote.drops.length,
      received: details.drops.length,
    };
  }
  for (const [index, quoted] of quote.drops.entries()) {
    const drop = checkPoint(quoted, details.drops[index], `drops.${index}`);
    if (drop === 'MOVED') {
      return { kind: 'DROP_MOVED', sequence: index + 1 };
    }
    if (drop) {
      return drop;
    }
  }
  return null;
}
