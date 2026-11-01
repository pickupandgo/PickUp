import { applyCustomerCharges } from './customer-charges';
import { MAX_PAYABLE_PAISE, type PricedQuote } from './fare-pricer';
const quote = (amounts: bigint[]): PricedQuote => ({
  version: { id: 'test', code: 'test' } as PricedQuote['version'],
  vehicleCategory: 'MINI_TRUCK',
  weightGrams: 10000,
  pickup: { latitude: 26, longitude: 73 },
  distanceMeters: 100,
  farePaise: amounts.reduce((a, b) => a + b, 0n),
  taxPaise: 0n,
  payablePaise: amounts.reduce((a, b) => a + b, 0n),
  drops: amounts.map((amount, index) => ({
    sequence: index + 1,
    location: { latitude: 26.1, longitude: 73.1 },
    distanceMeters: 100,
    farePaise: amount,
    taxPaise: 0n,
    payablePaise: amount,
  })),
});
it('adds 10% to delivery fare using exact paise and freezes the customer breakdown', () => {
  expect(applyCustomerCharges(quote([4818n]), 1000)).toMatchObject({
    deliveryFarePaise: 4818n,
    customerPlatformFeePaise: 482n,
    customerPlatformFeeBps: 1000,
    surgeChargePaise: 0n,
    farePaise: 5300n,
    payablePaise: 5300n,
  });
  expect(applyCustomerCharges(quote([5000n]), 1000).payablePaise).toBe(5500n);
});
it('allocates rounded total fee across drops without losing or adding paise', () => {
  const result = applyCustomerCharges(quote([105n, 105n, 105n, 105n, 105n]), 1000);
  expect(result.customerPlatformFeePaise).toBe(53n);
  expect(result.drops.map((d) => d.farePaise)).toEqual([116n, 115n, 116n, 115n, 116n]);
  expect(result.drops.reduce((sum, d) => sum + d.payablePaise, 0n)).toBe(result.payablePaise);
  expect(result.farePaise + result.taxPaise).toBe(result.payablePaise);
});
it('supports an explicit zero rate and cannot apply the surcharge twice', () => {
  const original = quote([5000n]);
  const result = applyCustomerCharges(original, 0);
  expect(result.payablePaise).toBe(5000n);
  expect(original.deliveryFarePaise).toBeUndefined();
  expect(() => applyCustomerCharges(result, 1000)).toThrow('already applied');
});
it('rejects invalid rates and an inclusive total over the provider limit', () => {
  for (const rate of [-1, 10001, 0.5])
    expect(() => applyCustomerCharges(quote([5000n]), rate)).toThrow();
  expect(() => applyCustomerCharges(quote([MAX_PAYABLE_PAISE]), 1000)).toThrow('payable limit');
});
