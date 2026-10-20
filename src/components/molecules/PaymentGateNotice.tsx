import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from '../atoms/Icon';
import { SecondaryButton } from '../atoms/SecondaryButton';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { useI18n } from '../../i18n';
import type { PaymentGateView } from '../../hooks/usePaymentGate';
import type { CollectionMethodDto } from '../../services/payments/collectionsDto';
import {
  dropHandoverAllowed,
  pickupHandoverAllowed,
} from '../../services/payments/collectionFlow';
import { formatRupees, paiseToRupees } from '../../services/payments/money';

export interface PaymentGateNoticeProps {
  readonly view: PaymentGateView;
  /** The last gate read failed (the last gate read, if any, is still shown). */
  readonly error: string | null;
  readonly paidWith: CollectionMethodDto | null;
  /** PICKUP on the pickup screen; DROP (with the drop's sequence) on a drop screen. */
  readonly stage: 'PICKUP' | 'DROP';
  readonly sequence?: number;
  /** Opens the collect screen for the payment backend's trip id. */
  readonly onCollect: (backendTripId: string) => void;
  readonly testID?: string;
}

const money = (paise: number) => formatRupees(paiseToRupees(paise));

/**
 * What the payment gate says about the handover at this pickup or drop (review G): paid, owed
 * (with COLLECT / OPEN QR), or locked while the payment system catches up. Display only: the
 * OTP buttons use the same gate, and the engine checks it again on every handover.
 */
export const PaymentGateNotice: React.FC<PaymentGateNoticeProps> = ({
  view,
  error,
  paidWith,
  stage,
  sequence,
  onCollect,
  testID,
}) => {
  const { t } = useI18n();

  if (view.kind === 'mock') {
    return null;
  }

  const line = (
    text: string,
    tone: 'info' | 'ok' | 'owed' = 'info',
    busy = false,
  ) => (
    <View style={styles.row}>
      {busy ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Icon
          name={
            tone === 'ok'
              ? 'check_circle'
              : tone === 'owed'
              ? 'payments'
              : 'info'
          }
          size={20}
          color={
            tone === 'ok'
              ? colors.success
              : tone === 'owed'
              ? colors.error
              : colors.onSurfaceVariant
          }
        />
      )}
      <Text
        style={[styles.text, tone === 'owed' && styles.owed]}
        accessibilityLiveRegion="polite"
      >
        {text}
      </Text>
    </View>
  );

  let body: React.ReactNode;
  if (view.kind === 'loading') {
    body = line(
      error ? t('trip.gateRetrying') : t('trip.gateChecking'),
      'info',
      true,
    );
  } else if (view.kind === 'unavailable') {
    body = line(t('trip.gateUnavailable'));
  } else if (view.kind === 'syncing') {
    body = line(t('trip.gateSyncing'), 'info', true);
  } else {
    const { gate } = view;
    const here =
      gate.stage === stage &&
      (stage === 'PICKUP' ||
        gate.stopSequence === null ||
        gate.stopSequence === sequence);
    const allowed =
      stage === 'PICKUP'
        ? pickupHandoverAllowed(gate)
        : dropHandoverAllowed(gate, sequence);
    const amount = gate.amountPaise !== null ? money(gate.amountPaise) : '';
    const n = gate.stopSequence ?? sequence ?? '';

    if (!here) {
      // The payment backend has not caught up with this stop yet.
      body = line(t('trip.gateNotYet'), 'info', true);
    } else if (allowed) {
      if (gate.paymentState === 'PAYMENT_CONFIRMED') {
        const paid =
          stage === 'DROP' && gate.stopSequence !== null
            ? t('trip.dropPaid', { n })
            : paidWith === 'CASH'
            ? t('trip.paidCash')
            : paidWith === 'ONLINE_QR'
            ? t('trip.paidOnline')
            : t('trip.paid');
        body = line(amount ? `${paid} · ${amount}` : paid, 'ok');
      } else {
        body = line(
          stage === 'PICKUP' ? t('trip.payAtDelivery') : t('trip.nothingDue'),
          'ok',
        );
      }
    } else if (
      gate.paymentState === 'PAYMENT_REQUIRED' ||
      gate.paymentState === 'PAYMENT_FAILED'
    ) {
      body = (
        <>
          {line(
            stage === 'DROP' && gate.stopSequence !== null
              ? t('trip.dropPaymentRequired', { amount, n })
              : t('trip.paymentRequired', { amount }),
            'owed',
          )}
          {gate.paymentState === 'PAYMENT_FAILED' && gate.lastFailure ? (
            <Text style={styles.note}>
              {t('trip.lastFailure', { reason: gate.lastFailure })}
            </Text>
          ) : null}
          <Text style={styles.note}>{t('trip.handoverLocked')}</Text>
          <SecondaryButton
            label={t('trip.collectPayment')}
            onPress={() => onCollect(view.trip.tripId)}
          />
        </>
      );
    } else if (gate.paymentState === 'PAYMENT_PROCESSING') {
      body = (
        <>
          {line(t('trip.paymentProcessing', { amount }), 'owed', true)}
          <Text style={styles.note}>{t('trip.handoverLocked')}</Text>
          <SecondaryButton
            label={t('trip.openQr')}
            onPress={() => onCollect(view.trip.tripId)}
          />
        </>
      );
    } else if (gate.paymentState === 'NOT_YET') {
      body = line(t('trip.gateNotYet'), 'info', true);
    } else {
      body = line(t('trip.handoverLocked'));
    }
  }

  return (
    <View style={styles.card} testID={testID}>
      {body}
      {error && view.kind === 'ready' ? (
        <Text style={styles.note}>{t('trip.gateRetrying')}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: {
    ...typography.bodyMd,
    color: colors.onSurface,
    flex: 1,
  },
  owed: {
    ...typography.headlineSm,
    color: colors.error,
  },
  note: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
});

export default PaymentGateNotice;
