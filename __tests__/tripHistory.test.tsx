import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import TripHistoryScreen from '../src/screens/profile/TripHistoryScreen';
import * as engineApi from '../src/api/engine';
import type { Trip } from '../src/api/types';

jest.mock('../src/config/env', () => ({
  env: {
    apiBaseUrl: 'https://engine.test',
    paymentsApiBaseUrl: 'https://pay.test',
    googleMapsApiKey: 'mock-key',
  },
  hasApiConfig: () => true,
  hasPaymentsConfig: () => true,
  assertApiConfig: () => undefined,
}));

const mockSampleTrip: Trip = {
  id: 'trip-101',
  rideId: 'ride-101',
  driverId: 'driver-1',
  customerId: 'cust-1',
  status: 'COMPLETED',
  fare: 350,
  weight: 25,
  pickup: {
    latitude: 26.2389,
    longitude: 73.0243,
    address: 'Clock Tower, Jodhpur',
  },
  drop: {
    latitude: 26.2626,
    longitude: 73.0046,
    address: 'Shastri Nagar, Jodhpur',
  },
  stops: [
    {
      id: 'stop-1',
      sequence: 1,
      location: {
        latitude: 26.2626,
        longitude: 73.0046,
        address: 'Shastri Nagar, Jodhpur',
      },
      status: 'DELIVERED',
    },
  ],
  currentStopIndex: 1,
  createdAt: '2026-10-21T10:00:00.000Z',
  updatedAt: '2026-10-21T10:45:00.000Z',
};

describe('Trip history without scheduling', () => {
 beforeEach(() => {jest.restoreAllMocks();});
 const text=(view:any)=>view.root.findAllByType('Text').map((node:any)=>node.props.children).flat(Infinity).join(' ');
 it('shows a truthful empty state with no scheduling controls', async () => {
  jest.spyOn(engineApi,'getCustomerHistory').mockResolvedValueOnce([]);let view:any;
  await act(async()=>{view=TestRenderer.create(<TripHistoryScreen customerId="customer-A"/>);});
  expect(text(view)).toContain('No trips yet');expect(text(view)).not.toContain('Scheduled');
  expect(view.root.findAllByProps({accessibilityRole:'tab'})).toHaveLength(0);
  act(()=>view.unmount());
 });
 it('shows loading without a premature empty state', async () => {
  let finish!:(trips:Trip[])=>void;jest.spyOn(engineApi,'getCustomerHistory').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));let view:any;
  act(()=>{view=TestRenderer.create(<TripHistoryScreen customerId="customer-A"/>);});
  expect(view.root.findByProps({testID:'trip-history-loading'})).toBeDefined();expect(text(view)).not.toContain('No trips yet');
  await act(async()=>finish([]));act(()=>view.unmount());
 });
 it('shows a failed history read truthfully with a retry action', async () => {
  jest.spyOn(engineApi,'getCustomerHistory').mockRejectedValueOnce(new Error('offline'));let view:any;
  await act(async()=>{view=TestRenderer.create(<TripHistoryScreen customerId="customer-A"/>);});
  expect(view.root.findByProps({testID:'trip-history-error'})).toBeDefined();expect(text(view)).toContain('offline');act(()=>view.unmount());
 });
 it('preserves selected trip identity instead of using an external reference as tripId', async () => {
  const navigate=jest.fn();const trip={...mockSampleTrip,externalRef:'external-ref'};let view:any;
  await act(async()=>{view=TestRenderer.create(<TripHistoryScreen initialTrips={[trip]} navigation={{navigate}}/>);});
  act(()=>view.root.findByProps({testID:`trip-card-${trip.id}`}).props.onPress());
  expect(navigate).toHaveBeenCalledWith('HistoricalTripDetailScreen',{trip,tripId:trip.id});expect(text(view)).toContain('\u20B9350.00');expect(text(view)).not.toContain('CASH');act(()=>view.unmount());
 });
 it('shows actual collection preference and never invents a zero fare', async () => {
  const trip={...mockSampleTrip,fare:undefined,paymentMethod:'PAY_AT_PICKUP',metadata:{specialInstructions:'Payment preference: UPI (driver collection).'}} as Trip;let view:any;
  await act(async()=>{view=TestRenderer.create(<TripHistoryScreen initialTrips={[trip]}/>);});
  expect(text(view)).toContain('UPI at pickup');expect(text(view)).not.toContain('\u20B90');act(()=>view.unmount());
 });
 it('filters completed/cancelled trips and can return to all trips', async () => {
  const cancelled={...mockSampleTrip,id:'cancelled',status:'CANCELLED'} as Trip;let view:any;
  await act(async()=>{view=TestRenderer.create(<TripHistoryScreen initialTrips={[mockSampleTrip,cancelled]}/>);});
  act(()=>view.root.findByProps({accessibilityLabel:'Filter trips'}).props.onPress());
  act(()=>view.root.findByProps({accessibilityLabel:'Completed'}).props.onPress());
  expect(view.root.findAllByProps({testID:'trip-card-cancelled'})).toHaveLength(0);
  act(()=>view.root.findByProps({accessibilityLabel:'Filter trips'}).props.onPress());act(()=>view.root.findByProps({accessibilityLabel:'All trips'}).props.onPress());
  expect(view.root.findByProps({testID:'trip-card-cancelled'})).toBeDefined();act(()=>view.unmount());
 });
 it('uses the existing immediate booking action when history is empty', async () => {
  const onBookRide=jest.fn();let view:any;await act(async()=>{view=TestRenderer.create(<TripHistoryScreen initialTrips={[]} onBookRide={onBookRide}/>);});
  act(()=>view.root.findByProps({accessibilityLabel:'Book a Ride'}).props.onPress());expect(onBookRide).toHaveBeenCalledTimes(1);act(()=>view.unmount());
 });
});
