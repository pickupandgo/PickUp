import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { useBookingPayment } from '../src/hooks/useBookingPayment';
import { getBookingPayment, getFareQuote } from '../src/api/payments';
import { getRide } from '../src/api/engine';
import { formatPaise, paymentLabel } from '../src/utils/paymentPresentation';
import { BookingContext } from '../src/state/BookingContext';
import DigitalReceiptScreen from '../src/screens/payment/DigitalReceiptScreen';
import HistoricalTripDetailScreen from '../src/screens/profile/HistoricalTripDetailScreen';
import TripCompletedScreen from '../src/screens/support/TripCompletedScreen';

let mockUser: any = { uid: 'A' };
jest.mock('@react-native-firebase/auth', () => ({ getAuth: () => ({ currentUser: mockUser }) }));
jest.mock('../src/api/payments', () => ({ getBookingPayment: jest.fn(), getFareQuote: jest.fn() }));
jest.mock('../src/api/engine', () => ({ ...jest.requireActual('../src/api/engine'), getRide: jest.fn(async () => undefined) }));
const payment = (bookingId = 'pay-A', paymentStatus = 'UNPAID'): any => ({ bookingId, externalRef: 'ENG-A', farePaise: 12005, paymentStatus,
 paymentMethod: 'PAY_AT_DELIVERY', confirmedAt: '2026-10-30T10:00:00Z',
 stops: [{ sequence: 1, payablePaise: 10000, state: 'DELIVERED' }, { sequence: 2, payablePaise: 2005, state: 'NOT_DELIVERED' }],
 paymentGate: { stage: 'DROP', stopSequence: 2, paymentState: 'PAYMENT_REQUIRED', amountPaise: 2005, handoverAllowed: false } });
const selected: any = { id: 'trip-A', paymentBookingId: 'pay-A', status: 'COMPLETED', externalRef: 'ENG-A', completedAt: '2026-10-30T11:00:00Z',
 pickup: { address: 'Pickup A' }, stops: [{ sequence: 1, status: 'UNDELIVERED', location: { address: 'Drop A' } }] };
const context: any = { trip: { id: 'trip-B', paymentBookingId: 'pay-B', externalRef: 'ENG-B', fare: 9999 }, draft: { drops: [] }, clearActiveRide: jest.fn() };
let renderer: ReactTestRenderer | undefined;
beforeEach(() => { jest.clearAllMocks(); mockUser = { uid: 'A' }; (getBookingPayment as jest.Mock).mockResolvedValue(payment()); });
afterEach(() => { if (renderer) act(() => renderer!.unmount()); renderer = undefined; jest.useRealTimers(); });
const text = () => renderer!.root.findAllByType(Text).map(n => n.props.children).flat(Infinity).join(' ');

it.each(['UNPAID','PAID','PARTIALLY_PAID','REFUND_PENDING','REFUNDED','PARTIALLY_REFUNDED'])('presents %s from the backend', status => {
 const expected: Record<string,string> = { UNPAID: 'Payment pending', PAID: 'Paid', PARTIALLY_PAID: 'Partially paid', REFUND_PENDING: 'Refund pending', REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'Partially refunded' };
 expect(paymentLabel(payment('p', status))).toBe(expected[status]);
});
it('retains paise/zero and does not invent an unavailable amount', () => {
 expect(formatPaise(12005)).toBe('\u20b9120.05'); expect(formatPaise(0)).toBe('\u20b90.00'); expect(formatPaise(undefined)).toBe('Not available');
 expect(paymentLabel({ ...payment(), paymentGate: { paymentState: 'PAYMENT_PROCESSING' } })).toBe('Payment processing');
 expect(paymentLabel({ ...payment(), paymentGate: { paymentState: 'PAYMENT_FAILED' } })).toBe('Payment failed');
});
it('shows selected A payment details while B is active, without synthetic paid/taxes', async () => {
 await act(async () => { renderer = TestRenderer.create(<BookingContext.Provider value={context}><DigitalReceiptScreen route={{ params: { trip: selected, paymentBookingId: 'pay-B' } }} /></BookingContext.Provider>); });
 expect(getBookingPayment).toHaveBeenCalledWith('pay-A', expect.anything());
 expect(text()).toContain('ENG-A'); expect(text()).toContain('\u20b9120.05'); expect(text()).toContain('not delivered');
 expect(text()).not.toContain('ENG-B'); expect(text()).not.toContain('9999'); expect(text()).not.toContain('Payment Successful');
 expect(text()).toContain('Detailed fare breakdown is not available.');
});
it('routes historical receipt with selected identity without exposing ended driver chat or ratings', async () => {
 const navigation = { navigate: jest.fn() };
 await act(async () => { renderer = TestRenderer.create(<HistoricalTripDetailScreen navigation={navigation} route={{ params: { trip: selected } }} />); });
 const button=(renderer!.root as any).findByProps({accessibilityLabel:'View receipt'});
 act(()=>button.props.onPress());
 expect(navigation.navigate).toHaveBeenCalledWith('BookingStack', { screen: 'DigitalReceiptScreen', params: expect.objectContaining({ trip: selected, tripId: 'trip-A' }) });
 act(() => (renderer!.root as any).findByProps({accessibilityLabel:'Help with this trip'}).props.onPress());
 expect(navigation.navigate).toHaveBeenCalledWith('MainTabs', { screen:'HelpScreen', params:{tripId:'trip-A',tripReference:'ENG-A'} });
 expect(text()).not.toContain('Ratings unavailable');
 expect(navigation.navigate).not.toHaveBeenCalledWith('ActiveTripStack',expect.anything());
});
it('does not present delivered-but-uncompleted or mixed outcomes as all-success', async () => {
 await act(async () => { renderer = TestRenderer.create(<BookingContext.Provider value={context}><TripCompletedScreen route={{ params: { trip: { ...selected, status: 'DELIVERED' } } }} /></BookingContext.Provider>); });
 expect(text()).toContain('Finalizing trip'); expect(text()).toContain('Some delivery stops need attention.'); expect(text()).not.toContain('Trip completed');
});
it('hides A immediately on B switch and rejects a late A response', async () => {
 let finish!: (value: any) => void;
 (getBookingPayment as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(payment('B','PAID'));
 let state!: ReturnType<typeof useBookingPayment>;
 function Capture({ id }: { id: string }) { state = useBookingPayment(id); return null; }
 await act(async () => { renderer = TestRenderer.create(<Capture id="A" />); });
 await act(async () => { renderer!.update(<Capture id="B" />); });
 await act(async () => { finish(payment('A','REFUNDED')); });
 expect(state.booking?.bookingId).toBe('B'); expect(state.booking?.paymentStatus).toBe('PAID');
});
it('invalidates old paid data when polling fails', async () => {
 jest.useFakeTimers();
 (getBookingPayment as jest.Mock).mockResolvedValueOnce(payment('A','PAID')).mockRejectedValueOnce(new Error('offline'));
 let state!: ReturnType<typeof useBookingPayment>;
 function Capture() { state = useBookingPayment('A'); return null; }
 await act(async () => { renderer = TestRenderer.create(<Capture />); });
 expect(state.booking?.paymentStatus).toBe('PAID');
 await act(async () => { await jest.advanceTimersByTimeAsync(5000); });
 expect(state.booking).toBeUndefined(); expect(state.error).toBeDefined();
});

it('shows unavailable rather than sample receipt facts when no booking exists', async () => {
 await act(async () => { renderer = TestRenderer.create(<BookingContext.Provider value={{ ...context, trip: undefined }}><DigitalReceiptScreen /></BookingContext.Provider>); });
 expect(getBookingPayment).not.toHaveBeenCalled(); expect(text()).toContain('Payment status unavailable');
 expect(text()).not.toContain('Paid'); expect(text()).not.toContain('2023'); expect(text()).not.toContain('450.00');
});
it('rejects payment details returned for another booking', async () => {
 (getBookingPayment as jest.Mock).mockResolvedValue(payment('wrong-booking','PAID'));
 let state!: ReturnType<typeof useBookingPayment>;
 function Capture() { state = useBookingPayment('expected'); return null; }
 await act(async () => { renderer = TestRenderer.create(<Capture />); });
 expect(state.booking).toBeUndefined(); expect(state.error).toBeDefined();
});

it('reads the selected historical ride frozen fee breakdown without borrowing active B prices', async () => {
 (getRide as jest.Mock).mockResolvedValueOnce({id:'ride-A',quoteId:'quote-A'});
 (getFareQuote as jest.Mock).mockResolvedValueOnce({quoteId:'quote-A',deliveryFarePaise:10914,customerPlatformFeePaise:1091,customerPlatformFeeBps:1000,payablePaise:12005,taxPaise:0});
 const historical={...selected,rideId:'ride-A'};
 await act(async()=>{renderer=TestRenderer.create(<BookingContext.Provider value={context}><HistoricalTripDetailScreen route={{params:{trip:historical}}}/></BookingContext.Provider>);});
 expect(getRide).toHaveBeenCalledWith('ride-A',expect.anything());expect(getFareQuote).toHaveBeenCalledWith('quote-A',expect.anything());
 expect(text()).toContain('Platform fee');expect(text()).toContain('\u20B910.91');expect(text()).not.toContain('9999');
});
