import { withAddressDetails } from '../src/utils/locationDetails';
it('keeps house details in the submitted address without repeating them on edits', () => {
  const point = { latitude: 26, longitude: 73, address: 'Sardarpura, Jodhpur' };
  const saved = withAddressDetails(point, 'Flat 12');
  expect(saved.address).toBe('Flat 12, Sardarpura, Jodhpur');
  expect(withAddressDetails(saved, 'Flat 12').address).toBe(saved.address);
  expect(withAddressDetails(saved, 'Shop 4').address).toBe('Shop 4, Sardarpura, Jodhpur');
  expect(withAddressDetails(saved, '').address).toBe(point.address);
  expect(saved.latitude).toBe(point.latitude);
});
