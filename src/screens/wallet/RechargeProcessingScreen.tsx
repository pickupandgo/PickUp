import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { getPaymentsApi } from '../../services/payments';
import { getSignedInPhoneNumber } from '../../services/payments/firebaseToken';
import { formatRupees, paiseToRupees } from '../../services/payments/money';
import {
  describePaymentsError,
  PaymentsApiError,
} from '../../services/payments/paymentsErrors';
import { openRazorpayCheckout } from '../../services/payments/razorpayCheckout';
import {
  runTopUp,
  type TopUpOutcome,
  type TopUpPhase,
} from '../../services/payments/topUpFlow';
import type {
  WalletScreenProps,
  WalletStackParamList,
} from '../../types/navigation';

export interface RechargeProcessingScreenProps {
  readonly navigation: WalletScreenProps<'RechargeProcessing'>['navigation'];
  readonly route: WalletScreenProps<'RechargeProcessing'>['route'];
  readonly testID?: string;
}

type ResultParams = WalletStackParamList['RechargeResult'];

const PHASE_COPY: Readonly<
  Record<TopUpPhase, { title: string; subtitle: string }>
> = {
  CREATING_ORDER: {
    title: 'Starting secure payment',
    subtitle: 'Connecting to Razorpay…',
  },
  AWAITING_PAYMENT: {
    title: 'Complete your payment',
    subtitle: 'Finish paying in the Razorpay window.',
  },
  CONFIRMING: {
    title: 'Confirming your payment',
    subtitle: "Please don't close the app.",
  },
  WAITING_FOR_BANK: {
    title: 'Waiting for your bank',
    subtitle:
      'This can take up to a minute. Your wallet updates automatically once the bank confirms.',
  },
};

/** Merchant name shown at the top of Razorpay Checkout. */
const CHECKOUT_NAME = 'PickUp';

export const RechargeProcessingScreen: React.FC<
  RechargeProcessingScreenProps
> = ({ navigation, route, testID }) => {
  const { amountPaise, idempotencyKey } = route.params;
  const [phase, setPhase] = useState<TopUpPhase>('CREATING_ORDER');
  const [result, setResult] = useState<ResultParams | null>(null);
  const paymentIdRef = useRef<string | undefined>(undefined);
  const stopRunRef = useRef<() => void>(() => undefined);

  // One top-up run per attempt. Each run has its own `active` flag, so a run that is left
  // behind (screen closed, or React re-running effects in development) can never navigate.
  useEffect(() => {
    let active = true;
    stopRunRef.current = () => {
      active = false;
    };
    const api = getPaymentsApi();
    if (!api) {
      setResult({
        outcome: 'failed',
        amountPaise,
        message: describePaymentsError(
          new PaymentsApiError('NOT_CONFIGURED', 'Not configured', 0),
        ),
        paymentAttempted: false,
      });
      return () => {
        active = false;
      };
    }

    runTopUp(amountPaise, idempotencyKey, {
      api,
      openCheckout: checkout =>
        openRazorpayCheckout(checkout, {
          name: CHECKOUT_NAME,
          description: 'Wallet recharge',
          contact: getSignedInPhoneNumber(),
          themeColor: colors.primary,
        }),
      onPhase: (next, paymentId) => {
        if (!active) {
          return;
        }
        if (paymentId) {
          paymentIdRef.current = paymentId;
        }
        setPhase(next);
      },
      isAbandoned: () => !active,
    })
      .then(outcome => {
        if (active) {
          setResult(toResultParams(outcome));
        }
      })
      .catch(() => {
        // runTopUp reports every failure as an outcome; this is only a safety net. Once a
        // payment exists, money may have moved, so never report it as failed.
        if (!active) {
          return;
        }
        setResult(
          paymentIdRef.current
            ? {
                outcome: 'pending',
                amountPaise,
                paymentId: paymentIdRef.current,
              }
            : {
                outcome: 'failed',
                amountPaise,
                message: describePaymentsError(undefined),
                paymentAttempted: false,
              },
        );
      });

    return () => {
      active = false;
    };
  }, [amountPaise, idempotencyKey]);

  useEffect(() => {
    if (result) {
      navigation.replace('RechargeResult', result);
    }
  }, [navigation, result]);

  const checkLater = useCallback(() => {
    stopRunRef.current();
    setResult({
      outcome: 'pending',
      amountPaise,
      paymentId: paymentIdRef.current,
    });
  }, [amountPaise]);

  // Leaving is blocked while the server is working. It stays possible while Checkout is open:
  // Checkout covers this screen, and if it ever fails to appear the driver must not be stuck.
  usePreventRemove(result === null && phase !== 'AWAITING_PAYMENT', () => {
    if (phase === 'WAITING_FOR_BANK') {
      checkLater();
      return;
    }
    Alert.alert(
      'Please wait',
      'We are confirming your payment. This takes a few seconds.',
    );
  });

  const copy = PHASE_COPY[phase];

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <View style={styles.container}>
        <ActivityIndicator
          size="large"
          color={colors.primary}
          accessibilityLabel="Payment in progress"
        />
        <Text style={styles.title} accessibilityLiveRegion="polite">
          {copy.title}
        </Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
        <Text style={styles.amount}>
          {formatRupees(paiseToRupees(amountPaise))}
        </Text>
      </View>
      {phase === 'WAITING_FOR_BANK' && result === null ? (
        <View style={styles.actions}>
          <SecondaryButton label="CHECK LATER" onPress={checkLater} />
        </View>
      ) : null}
    </SafeAreaView>
  );
};

function toResultParams(outcome: TopUpOutcome): ResultParams {
  switch (outcome.kind) {
    case 'success':
      return {
        outcome: 'success',
        amountPaise: outcome.amountPaise,
        paymentId: outcome.paymentId,
        balancePaise: outcome.balancePaise ?? undefined,
      };
    case 'pending':
    case 'cancelled':
      return {
        outcome: outcome.kind,
        amountPaise: outcome.amountPaise,
        paymentId: outcome.paymentId,
      };
    case 'failed':
      return {
        outcome: 'failed',
        amountPaise: outcome.amountPaise,
        paymentId: outcome.paymentId,
        message: outcome.message,
        requestId: outcome.requestId,
        paymentAttempted: outcome.paymentAttempted,
      };
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.containerPadding,
    paddingHorizontal: spacing.lg,
  },
  title: {
    ...typography.headlineMd,
    color: colors.onSurface,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  amount: {
    ...typography.headlineLg,
    color: colors.primary,
    marginTop: spacing.xs,
  },
  actions: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
  },
});

export default RechargeProcessingScreen;
