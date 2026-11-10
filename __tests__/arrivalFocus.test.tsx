import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { useArrivalDetection } from '../src/hooks/useArrivalDetection';
let mockFocus: () => () => void;
const mockSubscribe = jest.fn(),
  mockRemove = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => () => void) => {
    mockFocus = callback;
  },
}));
jest.mock('../src/services/trip/ArrivalDetectionService', () => ({
  ArrivalDetectionService: {
    getInstance: () => ({ subscribe: mockSubscribe }),
  },
}));
test('only a focused screen consumes arrival events, including delayed callbacks after Back', async () => {
  let listener!: (event: any) => void;
  mockSubscribe.mockImplementation(callback => {
    listener = callback;
    return mockRemove;
  });
  const first = jest.fn(),
    next = jest.fn();
  function Probe({ callback }: { callback: (event: any) => void }) {
    useArrivalDetection(callback);
    return null;
  }
  let view!: Renderer.ReactTestRenderer;
  await act(async () => {
    view = Renderer.create(<Probe callback={first} />);
  });
  const blur = mockFocus();
  listener({ tripId: 'trip-a' });
  expect(first).toHaveBeenCalledTimes(1);
  await act(async () => view.update(<Probe callback={next} />));
  listener({ tripId: 'trip-a' });
  expect(next).toHaveBeenCalledTimes(1);
  expect(mockSubscribe).toHaveBeenCalledTimes(1);
  blur();
  listener({ tripId: 'late-trip' });
  expect(next).toHaveBeenCalledTimes(1);
  expect(mockRemove).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});
