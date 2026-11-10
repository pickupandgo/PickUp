import { useEffect } from 'react';
import { AppState } from 'react-native';
import { getCurrentDriverId } from '../services/engine/dispatch';
import { incomingOffers } from '../services/trip/incomingOfferRuntime';

/** Home owns explicit LIVE eligibility; the offer inbox/surface outlive tab focus. */
export function useIncomingDriverDispatch({ enabled }: { readonly enabled: boolean }) {
  useEffect(() => {
    const uid = getCurrentDriverId();
    if (!enabled || !uid) return;
    incomingOffers.start(uid);
    const tick = () => {
      incomingOffers.expire();
      if (AppState.currentState === 'active') incomingOffers.refresh();
    };
    tick();
    const timer = setInterval(tick, 3000);
    const foreground = AppState.addEventListener('change', next => { if (next === 'active') tick(); });
    return () => {
      clearInterval(timer);
      foreground.remove();
      incomingOffers.stop();
    };
  }, [enabled]);
}
