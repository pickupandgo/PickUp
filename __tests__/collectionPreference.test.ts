import { collectionInstructions } from '../src/state/collectionPreference';
it('sends a collection preference without changing timing or claiming payment', () => {
  expect(collectionInstructions('Handle carefully', 'UPI')).toBe('Handle carefully\nPayment preference: UPI (driver collection).');
  expect(collectionInstructions(undefined)).toBe('Payment preference: Cash.');
  expect(collectionInstructions('x'.repeat(1000), 'UPI').length).toBeLessThanOrEqual(1000);
});
