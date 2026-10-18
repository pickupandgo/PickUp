import { matchRoute, sameCoordinate } from './route-match';

const quote = {
  pickup: { latitude: 26.296701, longitude: 73.035101 },
  drops: [
    { latitude: 26.306701, longitude: 73.045101 },
    { latitude: 26.316701, longitude: 73.055101 },
  ],
};

describe('matchRoute (the trip runs the priced route)', () => {
  it('accepts no details at all: the route is the quote', () => {
    expect(matchRoute(quote, {})).toBeNull();
  });

  it("accepts details without coordinates, or with the quote's coordinates", () => {
    expect(matchRoute(quote, { pickup: {}, drops: [{}, {}] })).toBeNull();
    expect(
      matchRoute(quote, { pickup: quote.pickup, drops: quote.drops }),
    ).toBeNull();
  });

  it('tolerates the 6-decimal rounding the payment backend stores', () => {
    expect(sameCoordinate(26.2967014, 26.296701)).toBe(true);
    expect(sameCoordinate(26.2967016, 26.296701)).toBe(false);
    expect(
      matchRoute(quote, {
        pickup: { latitude: 26.2967012, longitude: 73.0351008 },
      }),
    ).toBeNull();
  });

  it('refuses another number of drops', () => {
    expect(matchRoute(quote, { drops: [{}] })).toEqual({
      kind: 'DROP_COUNT',
      expected: 2,
      received: 1,
    });
    expect(matchRoute(quote, { drops: [{}, {}, {}] })).toEqual({
      kind: 'DROP_COUNT',
      expected: 2,
      received: 3,
    });
  });

  it('refuses a moved pickup or drop, and reports which drop', () => {
    expect(
      matchRoute(quote, {
        pickup: { latitude: 26.3, longitude: quote.pickup.longitude },
      }),
    ).toEqual({ kind: 'PICKUP_MOVED' });
    expect(
      matchRoute(quote, {
        drops: [quote.drops[0], { latitude: 26.4, longitude: 73.1 }],
      }),
    ).toEqual({ kind: 'DROP_MOVED', sequence: 2 });
  });

  it('refuses drops in another order (the order is priced)', () => {
    expect(
      matchRoute(quote, { drops: [quote.drops[1], quote.drops[0]] }),
    ).toEqual({ kind: 'DROP_MOVED', sequence: 1 });
  });

  it('refuses half a coordinate', () => {
    expect(
      matchRoute(quote, { pickup: { latitude: quote.pickup.latitude } }),
    ).toEqual({ kind: 'PARTIAL_COORDINATES', where: 'pickup' });
    expect(
      matchRoute(quote, { drops: [{}, { longitude: 73.055101 }] }),
    ).toEqual({ kind: 'PARTIAL_COORDINATES', where: 'drops.1' });
  });
});
