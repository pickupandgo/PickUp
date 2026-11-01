import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getAuth } from '@react-native-firebase/auth';
import { getBookingPayment } from '../api/payments';
import { ApiError, toApiError } from '../api/http';
import type { CustomerBooking } from '../api/types';

export const useBookingPayment = (bookingId?: string | null) => {
  const owner = getAuth().currentUser?.uid;
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [result, setResult] = useState<{ key: string; booking?: CustomerBooking; error?: string }>();
  const [loading, setLoading] = useState(false);
  const [revision, retry] = useState(0);
  const request = useRef<AbortController | null>(null);
  const key = `${owner ?? ''}:${bookingId ?? ''}`;
  useEffect(() => { const sub = AppState.addEventListener('change', state => setActive(state !== 'background' && state !== 'inactive')); return () => sub.remove(); }, []);
  useEffect(() => {
    setResult(undefined); setLoading(false);
    if (!bookingId || !owner || !active) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const controller = new AbortController(); request.current = controller;
      setLoading(true);
      const current = () => !disposed && !controller.signal.aborted && getAuth().currentUser?.uid === owner;
      try {
        const booking = await getBookingPayment(bookingId, controller.signal);
        if (booking.bookingId !== bookingId || !Number.isSafeInteger(booking.farePaise) || booking.farePaise < 0 ||
          !Array.isArray(booking.stops) || booking.stops.some(stop => !Number.isSafeInteger(stop.payablePaise) || stop.payablePaise < 0 || typeof stop.state !== 'string') ||
          (booking.paymentGate?.stage && typeof booking.paymentGate.paymentState !== 'string')) {
          throw new ApiError('parse', 'Payment details do not match the expected booking contract.');
        }
        if (current()) setResult({ key, booking });
      } catch (error) { if (current()) setResult({ key, error: toApiError(error).userMessage }); }
      finally {
        if (current()) { setLoading(false); timer = setTimeout(() => { void load(); }, 5000); }
      }
    };
    void load();
    return () => { disposed = true; request.current?.abort(); if (timer) clearTimeout(timer); };
  }, [bookingId, owner, active, key, revision]);
  return { booking: active && result?.key === key ? result.booking : undefined,
    error: result?.key === key ? result.error : undefined, loading,
    refresh: useCallback(() => retry(n => n + 1), []) };
};
