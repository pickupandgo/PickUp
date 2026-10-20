import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { getPaymentsApi } from '../../services/payments';
import { formatRupees, paiseToRupees } from '../../services/payments/money';
import {
  describePaymentsError,
  PaymentsApiError,
} from '../../services/payments/paymentsErrors';
import type {
  RechargeOutcomeKind,
  WalletScreenProps,
} from '../../types/navigation';

export interface RechargeResultScreenProps {
  readonly navigation: WalletScreenProps<'RechargeResult'>['navigation'];
  readonly route: WalletScreenProps<'RechargeResult'>['route'];
  readonly testID?: string;
}

interface OutcomeVisual {
  readonly icon: string;
  readonly iconColor: string;
  readonly title: string;
}

const VISUALS: Readonly<Record<RechargeOutcomeKind, OutcomeVisual>> = {
  success: {
    icon: 'check_circle',
    iconColor: colors.success,
    title: 'Recharge Successful',
  },
  pending: {
    icon: 'schedule',
    iconColor: colors.onTertiaryFixedVariant,
    title: 'Payment Is Being Confirmed',
  },
  cancelled: {
    icon: 'cancel',
    iconColor: colors.onSurfaceVariant,
    title: 'Payment Cancelled',
  },
  failed: { icon: 'error', iconColor: colors.error, title: 'Recharge Failed' },
};

const MONEY_MAY_HAVE_MOVED =
  'If money left your account, it will either be added to your wallet once the payment is confirmed or returned to your account.';

export const RechargeResultScreen: React.FC<RechargeResultScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const {
    outcome,
    amountPaise,
    paymentId,
    balancePaise,
    message,
    requestId,
    paymentAttempted,
  } = route.params;
  const [checking, setChecking] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const amount = formatRupees(paiseToRupees(amountPaise));
  const visual = VISUALS[outcome];
  const canCheckStatus =
    outcome === 'pending' &&
    paymentId !== undefined &&
    getPaymentsApi() !== null;
  const showMoneyNote =
    outcome === 'cancelled' ||
    (outcome === 'failed' && paymentAttempted === true);

  const goToWallet = useCallback(() => {
    navigation.popTo('DriverWallet');
  }, [navigation]);

  const tryAgain = useCallback(() => {
    navigation.popTo('Recharge');
  }, [navigation]);

  // Android back leaves the finished flow for the wallet instead of reopening earlier steps.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          goToWallet();
          return true;
        },
      );
      return () => subscription.remove();
    }, [goToWallet]),
  );

  const checkStatus = useCallback(async () => {
    const api = getPaymentsApi();
    if (!api || !paymentId || checking) {
      return;
    }
    setChecking(true);
    setStatusNote(null);
    try {
      const topUp = await api.getTopUp(paymentId);
      if (!mounted.current) {
        return;
      }
      if (topUp.status === 'PAID') {
        navigation.setParams({ outcome: 'success' });
      } else if (topUp.status === 'FAILED') {
        navigation.setParams({
          outcome: 'failed',
          message: describePaymentsError(
            new PaymentsApiError(
              'PAYMENT_NOT_COMPLETED',
              'Payment not completed',
              0,
            ),
          ),
          paymentAttempted: true,
        });
      } else {
        setStatusNote(
          'Still waiting for your bank. Please check again in a minute.',
        );
      }
    } catch (error: unknown) {
      if (mounted.current) {
        setStatusNote(describePaymentsError(error));
      }
    } finally {
      if (mounted.current) {
        setChecking(false);
      }
    }
  }, [checking, navigation, paymentId]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <View style={styles.container}>
        <View style={[styles.icon, iconBackground(outcome)]}>
          <Icon name={visual.icon} size={40} color={visual.iconColor} />
        </View>

        <Text style={styles.title} accessibilityRole="header">
          {visual.title}
        </Text>
        <Text style={styles.amount}>{amount}</Text>

        {outcome === 'success' ? (
          <>
            <Text style={styles.body}>
              {amount} has been added to your wallet.
            </Text>
            {balancePaise !== undefined ? (
              <Text style={styles.body}>
                New balance: {formatRupees(paiseToRupees(balancePaise))}
              </Text>
            ) : null}
          </>
        ) : null}
        {outcome === 'pending' ? (
          <Text style={styles.body}>
            Your bank has not confirmed this payment yet. Your wallet will
            update automatically once it does, so please don't pay again.
          </Text>
        ) : null}
        {outcome === 'cancelled' ? (
          <Text style={styles.body}>
            You closed the payment before it was completed.
          </Text>
        ) : null}
        {outcome === 'failed' ? (
          <Text style={styles.body}>
            {message ?? 'Unable to process payment. Please try again.'}
          </Text>
        ) : null}

        {showMoneyNote ? (
          <Text style={styles.note}>{MONEY_MAY_HAVE_MOVED}</Text>
        ) : null}
        {statusNote ? (
          <Text style={styles.note} accessibilityLiveRegion="polite">
            {statusNote}
          </Text>
        ) : null}

        {outcome !== 'success' && (paymentId || requestId) ? (
          <View style={styles.references}>
            {paymentId ? (
              <Text style={styles.reference} selectable>
                Payment ref: {paymentId}
              </Text>
            ) : null}
            {requestId ? (
              <Text style={styles.reference} selectable>
                Request ID: {requestId}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        {outcome === 'success' ? (
          <PrimaryButton label="DONE" onPress={goToWallet} />
        ) : null}
        {outcome === 'pending' ? (
          <>
            {canCheckStatus ? (
              <PrimaryButton
                label="CHECK STATUS"
                onPress={checkStatus}
                loading={checking}
              />
            ) : null}
            <SecondaryButton label="BACK TO WALLET" onPress={goToWallet} />
          </>
        ) : null}
        {outcome === 'cancelled' || outcome === 'failed' ? (
          <>
            <PrimaryButton label="TRY AGAIN" onPress={tryAgain} />
            <SecondaryButton label="BACK TO WALLET" onPress={goToWallet} />
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
};

function iconBackground(outcome: RechargeOutcomeKind) {
  switch (outcome) {
    case 'success':
      return styles.iconSuccess;
    case 'pending':
      return styles.iconPending;
    case 'cancelled':
      return styles.iconCancelled;
    case 'failed':
      return styles.iconError;
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
    gap: spacing.gutter,
    paddingHorizontal: spacing.lg,
  },
  icon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  iconSuccess: {
    backgroundColor: '#e8f5e9',
  },
  iconPending: {
    backgroundColor: colors.tertiaryFixed,
  },
  iconCancelled: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  iconError: {
    backgroundColor: colors.errorContainer,
  },
  title: {
    ...typography.headlineMd,
    color: colors.onSurface,
    textAlign: 'center',
  },
  amount: {
    ...typography.headlineLg,
    color: colors.primary,
  },
  body: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  note: {
    ...typography.labelSm,
    color: colors.outline,
    textAlign: 'center',
  },
  references: {
    marginTop: spacing.xs,
    alignItems: 'center',
    gap: 2,
  },
  reference: {
    ...typography.labelSm,
    color: colors.outline,
    textAlign: 'center',
  },
  actions: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
    gap: spacing.gutter,
  },
});

export default RechargeResultScreen;
