import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { toApiError } from '../api/http';

export interface UseActiveBookingCancellationOptions {
  readonly navigation: any;
  /** True when a booking is actively finding driver or in progress. */
  readonly isBookingActive: boolean;
  /** Async callback that performs the real backend cancellation API call and state cleanup. */
  readonly onCancelConfirm: () => Promise<void>;
  /** Route names that are valid forward transitions (e.g. DriverFoundScreen) and must not be blocked. */
  readonly allowedNextRoutes?: readonly string[];
}

export interface UseActiveBookingCancellationResult {
  readonly isCancelling: boolean;
  readonly requestCancellation: () => void;
  readonly isCancelledRef: React.MutableRefObject<boolean>;
}

/**
 * Resets navigation to MainTabs -> HomeScreen cleanly from any stack.
 */
export const navigateToCustomerHome = (navigation: any) => {
  try {
    const parent = navigation?.getParent?.();
    if (parent?.reset) {
      parent.reset({
        index: 0,
        routes: [{ name: 'MainTabs', params: { screen: 'HomeScreen' } }],
      });
      return;
    }
  } catch {
    // ignore
  }

  try {
    navigation?.dispatch?.(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTabs', params: { screen: 'HomeScreen' } }],
      })
    );
  } catch {
    navigation?.navigate?.('MainTabs', { screen: 'HomeScreen' });
  }
};

/**
 * Intercepts Android hardware Back and React Navigation beforeRemove on active booking screens.
 * Prompts with a confirmation dialog:
 *   Title: "Cancel Booking?"
 *   Message: "Are you sure you want to cancel this booking?"
 *   Buttons: "Keep Booking" and "Cancel Booking"
 *
 * Ensures:
 * - Does not navigate to Home on Back.
 * - Confirmed cancellation calls backend API and waits for response.
 * - Only navigates to Home after backend confirms.
 * - If cancellation fails, shows error and remains on screen.
 * - Prevents duplicate requests, duplicate dialogs, and navigation loops.
 */
export const useActiveBookingCancellation = ({
  navigation,
  isBookingActive,
  onCancelConfirm,
  allowedNextRoutes = [],
}: UseActiveBookingCancellationOptions): UseActiveBookingCancellationResult => {
  const [isCancelling, setIsCancelling] = useState(false);
  const isCancellingRef = useRef(false);
  const isCancelledRef = useRef(false);
  const isDialogActiveRef = useRef(false);

  const requestCancellation = useCallback(() => {
    // Prevent duplicate requests and duplicate confirmation dialogs
    if (!isBookingActive || isCancellingRef.current || isCancelledRef.current || isDialogActiveRef.current) {
      return;
    }

    isDialogActiveRef.current = true;

    Alert.alert(
      'Cancel Booking?',
      'Are you sure you want to cancel this booking?',
      [
        {
          text: 'Keep Booking',
          style: 'cancel',
          onPress: () => {
            isDialogActiveRef.current = false;
          },
        },
        {
          text: 'Cancel Booking',
          style: 'destructive',
          onPress: async () => {
            isDialogActiveRef.current = false;
            if (isCancellingRef.current || isCancelledRef.current) return;
            isCancellingRef.current = true;
            setIsCancelling(true);

            try {
              // 1. Call backend cancellation API and wait for response
              await onCancelConfirm();

              // 2. Mark as successfully cancelled BEFORE navigating so beforeRemove won't block it
              isCancelledRef.current = true;
              setIsCancelling(false);

              // 3. Navigate to Home
              navigateToCustomerHome(navigation);
            } catch (err: unknown) {
              isCancellingRef.current = false;
              setIsCancelling(false);
              const apiErr = toApiError(err);
              const errorMessage =
                apiErr.userMessage ||
                (err instanceof Error ? err.message : 'Could not cancel booking. Please try again.');
              Alert.alert('Cancellation Error', errorMessage);
            }
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          isDialogActiveRef.current = false;
        },
      }
    );
  }, [isBookingActive, onCancelConfirm, navigation]);

  // Handle React Navigation beforeRemove (in-app back button, gestures, pop transitions)
  useEffect(() => {
    if (!navigation) return;

    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      // If cancellation confirmed and completed, allow navigation without loop
      if (isCancelledRef.current) {
        return;
      }

      // If booking is not active, allow normal navigation
      if (!isBookingActive) {
        return;
      }

      // Allow intended forward transitions to next booking phases
      const targetRoute = e.data?.action?.payload?.name;
      if (targetRoute && allowedNextRoutes.includes(targetRoute)) {
        return;
      }

      // Prevent navigation away from the active screen
      e.preventDefault();

      if (!isCancellingRef.current) {
        // Trigger the cancellation confirmation dialog
        requestCancellation();
      }
    });

    return unsubscribe;
  }, [navigation, isBookingActive, allowedNextRoutes, requestCancellation]);

  // Handle Android hardware Back button
  useEffect(() => {
    if (!isBookingActive) return;

    const onHardwareBack = () => {
      if (isCancelledRef.current) {
        return false;
      }
      requestCancellation();
      return true; // Consume event to prevent hardware back from exiting/navigating
    };

    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [isBookingActive, requestCancellation]);

  return {
    isCancelling,
    requestCancellation,
    isCancelledRef,
  };
};
