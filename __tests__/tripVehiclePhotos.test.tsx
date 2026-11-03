import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { TripSegmentedFilters } from '../src/components/trips/TripSegmentedFilters';
import { HistoricalVehicleImage } from '../src/components/trips/HistoricalVehicleImage';
import { DeliveryPhotoGallery } from '../src/components/trips/DeliveryPhotoGallery';
import { historicalVehicle } from '../src/services/trip/historicalVehicle';
import { parseHistoryTrip } from '../src/services/trip/TripHistoryService';
import { engineTrip, historyTrip, uid, uuid } from '../__fixtures__/tripHistory';
jest.mock('react-native', () => Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(jest.requireActual('react-native')), Pressable: { value: 'Pressable' } }));
jest.mock('../src/components/atoms/Icon', () => 'Icon');
jest.mock('../src/i18n', () => ({ useI18n: () => ({ t: (key: string) => ({ 'tripHistory.all': 'All Trips', 'tripHistory.completed': 'Completed', 'tripHistory.cancelled': 'Cancelled' }[key] ?? key) }) }));
let view: Renderer.ReactTestRenderer;
const render = async (element: React.ReactElement) => { await act(async () => { view = Renderer.create(element); }); };
const text = () => view.root.findAllByType(Text).map(node => node.props.children).flat(Infinity).join(' ').replace(/\s+/g, ' ');
beforeEach(() => { jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false); });
afterEach(async () => { if (view) await act(() => view.unmount()); jest.restoreAllMocks(); });

test('shared vehicle mapping shows historical booked category without inventing a model/registration', () => {
  const trip = historyTrip({ vehicleType: 'MINI_TRUCK' });
  const result = historicalVehicle(trip);
  expect(result).toMatchObject({ title: 'Mini truck', model: null, registration: null, artworkCategory: 'MINI_TRUCK' });
  expect(historicalVehicle({ vehicleCategory: null })).toMatchObject({ title: 'Vehicle category unavailable', artworkCategory: null });
  // Current vehicle information is not an input to this mapping and cannot change the old trip.
  expect(historicalVehicle(trip)).toEqual(result);
});
test('supplied category artwork is 52dp/contain, with neutral fallback for failure or unknown category', async () => {
  await render(<HistoricalVehicleImage trip={historyTrip({ vehicleType: 'MINI_TRUCK' })} />);
  const image = view.root.findByType(Image);
  expect(image.props.resizeMode).toBe('contain'); expect(StyleSheet.flatten(image.props.style)).toMatchObject({ width: 52, height: 52 });
  await act(() => image.props.onError()); expect(view.root.findAllByType(Image)).toHaveLength(0);
  await act(() => view.update(<HistoricalVehicleImage trip={historyTrip({ vehicleType: 'FOUR_WHEELER' })} />));
  expect(view.root.findAllByType(Image)).toHaveLength(0);
});
test('segmented control has equal borderless cells, real counts and smooth size-aware pill positioning', async () => {
  const animate = jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
  const onSelect = jest.fn(); const counts = { all: 12, completed: 9, cancelled: 3 };
  await render(<TripSegmentedFilters selected="all" counts={counts} onSelect={onSelect} />);
  expect(text()).toContain('All Trips ( 12 )');
  const cells = view.root.findAllByType(Pressable); expect(cells).toHaveLength(3);
  for (const cell of cells) { const style = StyleSheet.flatten(cell.props.style); expect(style).toMatchObject({ flex: 1, minWidth: 0, minHeight: 48 }); expect(style.borderWidth).toBeUndefined(); }
  const container = view.root.findAllByType(View).find(node => node.props.accessibilityRole === 'tablist')!;
  await act(() => container.props.onLayout({ nativeEvent: { layout: { width: 320 } } }));
  await act(() => cells[1].props.onPress()); expect(onSelect).toHaveBeenCalledWith('completed');
  await act(() => view.update(<TripSegmentedFilters selected="completed" counts={counts} onSelect={onSelect} />));
  expect(animate).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 104, duration: 180, useNativeDriver: true }));
  await act(() => container.props.onLayout({ nativeEvent: { layout: { width: 608 } } }));
  expect(animate).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ toValue: 200 }));
});
test('reduced motion is respected and unknown totals are not invented', async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
  const animate = jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
  await render(<TripSegmentedFilters selected="cancelled" counts={null} onSelect={jest.fn()} />);
  expect(text()).toContain('—'); expect(animate).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ duration: 0 }));
});
const photoTrip = (scheme = 'file:///private/camera.jpg', status = 'DELIVERED') => parseHistoryTrip(engineTrip({ stops: [
  { id: uuid(6), sequence: 1, location: { address: 'Basni, Jodhpur, Rajasthan, India' }, status,
    deliveryProof: { type: 'PHOTO', uri: scheme, submittedAt: '2026-11-02T00:15:00Z' } },
  { id: uuid(5), sequence: 2, location: { address: 'Doliya, Jodhpur' }, status: 'DELIVERED' },
] }), uid);
test('confirmed proof stays linked to its own drop, retaining timestamp but never a raw private URI', async () => {
  const trip = photoTrip(); expect(trip.stops[0].deliveryPhoto).toEqual({ availability: 'DEVICE_ONLY', submittedAt: '2026-11-02T00:15:00Z' });
  expect(trip.stops[1].deliveryPhoto).toBeNull(); expect(JSON.stringify(trip)).not.toContain('/private/camera');
  await render(<DeliveryPhotoGallery trip={trip} />);
  expect(text()).toContain('Drop 1'); expect(text()).toContain('Drop 2'); expect(text()).toContain('No delivery photo recorded for this drop.'); expect(text()).toContain('Recorded');
  expect(view.root.findAllByType(Image)).toHaveLength(0);
});
test.each(['PENDING', 'ARRIVED', 'FAILED'])('an upload/reference attempt with status %s is not delivery evidence', async status => {
  const trip = photoTrip('file:///attempt.jpg', status); expect(trip.stops[0].deliveryPhoto).toBeNull();
  await render(<DeliveryPhotoGallery trip={trip} />); expect(text()).not.toContain('A photo reference was recorded');
});
test('an arbitrary HTTPS or signed URI is not fetched or exposed as an authorized image grant', async () => {
  const trip = photoTrip('https://private.example.test/photo.jpg?secret=do-not-retain');
  expect(JSON.stringify(trip)).not.toContain('secret='); expect(trip.stops[0].deliveryPhoto?.availability).toBe('PREVIEW_UNAVAILABLE');
  await render(<DeliveryPhotoGallery trip={trip} />); expect(text()).toContain('secure image preview is unavailable'); expect(view.root.findAllByType(Image)).toHaveLength(0);
});
