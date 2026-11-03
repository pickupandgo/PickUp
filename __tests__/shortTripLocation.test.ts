import { shortTripLocation } from '../src/services/trip/shortTripLocation';
import { historyTrip } from '../__fixtures__/tripHistory';

test.each([
  ['Basni, Jodhpur Tehsil, Jodhpur, Rajasthan, 342013, India', 'Basni, Jodhpur'],
  ['GG, Doliya, Jodhpur Tehsil, Jodhpur, Rajasthan, India', 'GG, Doliya, Jodhpur'],
  ['Gg, Doliya, Jodhpur Tehsil, Jodhpur, Rajasthan, India', 'GG, Doliya, Jodhpur'],
  ['Basni, Jodhpur', 'Basni, Jodhpur'],
  ['MG Road, Bengaluru, Karnataka 560001, India', 'MG Road, Bengaluru'],
  ['Basni, basni, Jodhpur, JODHPUR, Rajasthan, India', 'Basni, Jodhpur'],
  ['India Gate, New Delhi, India', 'India Gate, New Delhi'],
  ['Sector 4, Doliya, Jodhpur', 'Sector 4, Doliya, Jodhpur'],
  ['GG, Doliya', 'GG, Doliya'],
  ['Tehsil Road, Basni', 'Tehsil Road, Basni'],
  ['Jodhpur Tehsil', 'Jodhpur Tehsil'],
  ['  Basni  , , Jodhpur , Rajasthan, PIN: 342013, India ', 'Basni, Jodhpur'],
  ['Rajasthan, 342013, India', 'Location unavailable'],
  ['', 'Location unavailable'], [null, 'Location unavailable'], [undefined, 'Location unavailable'],
])('conservative display formatting: %p', (address, expected) => {
  expect(shortTripLocation(address)).toBe(expected);
});
test('formatting does not mutate the source record, address, identifiers or measurements', () => {
  const original = 'Basni, Jodhpur Tehsil, Jodhpur, Rajasthan, 342013, India';
  const trip = historyTrip({ pickup: { address: original } });
  const snapshot = JSON.stringify(trip);
  expect(shortTripLocation(trip.pickupAddress)).toBe('Basni, Jodhpur');
  expect(trip.pickupAddress).toBe(original); expect(JSON.stringify(trip)).toBe(snapshot);
});
