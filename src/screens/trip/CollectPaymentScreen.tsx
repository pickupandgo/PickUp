import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  Share,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../../components/atoms/Icon';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { StatusPill } from '../../components/atoms/StatusPill';
import { AppHeader } from '../../components/molecules/AppHeader';
import { InlineErrorBanner } from '../../components/molecules/InlineErrorBanner';
import { PaymentQrCode } from '../../components/molecules/PaymentQrCode';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { useI18n } from '../../i18n';
import { getPaymentsApi } from '../../services/payments';
import {
  collectAvailability,
  requiredFeePaise,
  shouldReuseKey,
  watchCollection,
} from '../../services/payments/collectionFlow';
import type {
  CollectionDto,
  CollectionMethodDto,
  DriverTripDto,
} from '../../services/payments/collectionsDto';
import { newIdempotencyKey } from '../../services/payments/idempotency';
import { formatRupees, paiseToRupees } from '../../services/payments/money';
import {
  describePaymentsError,
  PaymentsApiError,
} from '../../services/payments/paymentsErrors';
import type { HomeScreenProps } from '../../types/navigation';

export interface CollectPaymentScreenProps {
  readonly navigation: HomeScreenProps<'CollectPayment'>['navigation'];
  readonly route: HomeScreenProps<'CollectPayment'>['route'];
  readonly testID?: string;
}

type ScreenState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'load_failed'; readonly message: string }
  | { readonly kind: 'trip'; readonly trip: DriverTripDto }
  | {
      readonly kind: 'paid';
      readonly trip: DriverTripDto;
      readonly collection: CollectionDto;
    };

interface ShownQr {
  readonly trip: DriverTripDto;
  readonly collection: CollectionDto;
}

interface ActionError {
  readonly message: string;
  /** Set when the wallet can't cover a cash trip's platform fee. */
  readonly requiredFeePaise: number | null;
}

/** Server answers after which the trip itself must be re-read (paid elsewhere, closed, ...). */
const STALE_TRIP_CODES: ReadonlySet<string> = new Set([
  'BOOKING_ALREADY_PAID',
  'BOOKING_CLOSED',
  'COLLECTION_NOT_ALLOWED',
  'COLLECTION_AMOUNT_MISMATCH',
]);

const money = (paise: number) => formatRupees(paiseToRupees(paise));

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * Collect a pay-at-pickup or pay-at-delivery fare: record cash (the platform fee is debited
 * from the wallet) or show the customer a booking-linked Razorpay QR and wait for the server
 * to confirm it was paid. The fare, fee and paid state always come from the server.
 */
export const CollectPaymentScreen: React.FC<CollectPaymentScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { tripId } = route.params;
  const { t } = useI18n();
  const { width } = useWindowDimensions();
  const [screen, setScreen] = useState<ScreenState>({ kind: 'loading' });
  const [qr, setQr] = useState<ShownQr | null>(null);
  const [busy, setBusy] = useState<CollectionMethodDto | null>(null);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const mounted = useRef(false);
  // One idempotency key per attempt and method, reused only while the outcome is unknown.
  const keys = useRef<Partial<Record<CollectionMethodDto, string>>>({});
  // Bumped to stop the QR watcher (new QR, cash instead, screen closed).
  const watchGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      watchGeneration.current += 1;
    };
  }, []);

  const loadTrip = useCallback(async () => {
    const api = getPaymentsApi();
    if (!api) {
      setScreen({ kind: 'unavailable' });
      return;
    }
    try {
      const trip = await api.getTrip(tripId);
      if (mounted.current) {
        setScreen(previous =>
          previous.kind === 'paid' ? previous : { kind: 'trip', trip },
        );
      }
    } catch (error) {
      if (mounted.current) {
        const message = describePaymentsError(error);
        setScreen(previous =>
          previous.kind === 'loading' || previous.kind === 'load_failed'
            ? { kind: 'load_failed', message }
            : previous,
        );
      }
    }
  }, [tripId]);

  // Fresh server state whenever the screen is shown (e.g. back from a wallet recharge).
  useFocusEffect(
    useCallback(() => {
      if (!qr) {
        loadTrip().catch(() => undefined);
      }
    }, [loadTrip, qr]),
  );

  const collect = useCallback(
    async (trip: DriverTripDto, method: CollectionMethodDto) => {
      const api = getPaymentsApi();
      if (!api) {
        setScreen({ kind: 'unavailable' });
        return;
      }
      if (method === 'CASH') {
        watchGeneration.current += 1;
      }
      const key = keys.current[method] ?? newIdempotencyKey();
      keys.current[method] = key;
      setBusy(method);
      setActionError(null);
      try {
        const collection = await api.startCollection(
          trip.tripId,
          { method, amountPaise: trip.payment.farePaise },
          key,
        );
        keys.current[method] = undefined;
        if (!mounted.current) {
          return;
        }
        if (collection.status === 'COMPLETED') {
          setQr(null);
          setScreen({ kind: 'paid', trip, collection });
        } else if (collection.status === 'PENDING' && method === 'ONLINE_QR') {
          setQr({ trip, collection });
        } else {
          setQr(null);
          setActionError({
            message: t('collect.qrExpired'),
            requiredFeePaise: null,
          });
          loadTrip().catch(() => undefined);
        }
      } catch (error) {
        if (!shouldReuseKey(error)) {
          keys.current[method] = undefined;
        }
        if (!mounted.current) {
          return;
        }
        setActionError({
          message: describePaymentsError(error),
          requiredFeePaise: requiredFeePaise(error),
        });
        if (
          error instanceof PaymentsApiError &&
          STALE_TRIP_CODES.has(error.code)
        ) {
          setQr(null);
          loadTrip().catch(() => undefined);
        }
      } finally {
        if (mounted.current) {
          setBusy(null);
        }
      }
    },
    [loadTrip, t],
  );

  // While a QR is shown, ask the server until it is paid, expires or is cancelled.
  useEffect(() => {
    const api = getPaymentsApi();
    if (!qr || !api) {
      return undefined;
    }
    watchGeneration.current += 1;
    const generation = watchGeneration.current;
    const stopped = () =>
      !mounted.current || generation !== watchGeneration.current;
    watchCollection(qr.collection, { api, isAbandoned: stopped })
      .then(result => {
        if (stopped()) {
          return;
        }
        if (result.kind === 'paid') {
          setQr(null);
          setScreen({
            kind: 'paid',
            trip: qr.trip,
            collection: result.collection,
          });
          return;
        }
        if (result.kind === 'failed' || result.kind === 'reversed') {
          setQr(null);
          setActionError({
            message: t('collect.qrExpired'),
            requiredFeePaise: null,
          });
          loadTrip().catch(() => undefined);
        }
      })
      .catch(error => {
        if (!stopped()) {
          setActionError({
            message: describePaymentsError(error),
            requiredFeePaise: null,
          });
        }
      });
    return () => {
      watchGeneration.current += 1;
    };
  }, [qr, loadTrip, t]);

  usePreventRemove(busy !== null, () => {
    Alert.alert(t('collect.pleaseWait'), t('collect.pleaseWaitMsg'));
  });

  const confirmCash = useCallback(
    (trip: DriverTripDto) => {
      const fee = trip.payment.platformFeePaise;
      const message =
        fee > 0
          ? `${t('collect.confirmCashMsg', {
              amount: money(trip.payment.farePaise),
            })} ${t('collect.confirmCashFee', { fee: money(fee) })}`
          : t('collect.confirmCashMsg', {
              amount: money(trip.payment.farePaise),
            });
      Alert.alert(t('collect.confirmCashTitle'), message, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('collect.confirm'),
          onPress: () => {
            collect(trip, 'CASH').catch(() => undefined);
          },
        },
      ]);
    },
    [collect, t],
  );

  const shareLink = useCallback(
    (shown: ShownQr) => {
      const url = shown.collection.qr?.url;
      if (!url) {
        return;
      }
      Share.share({
        message: t('collect.shareMessage', {
          amount: money(shown.collection.amountPaise),
          ref: shown.trip.externalRef,
          url,
        }),
      }).catch(() => undefined);
    },
    [t],
  );

  const goToRecharge = useCallback(() => {
    navigation
      .getParent()
      ?.navigate('WalletTab', { screen: 'Recharge', initial: false });
  }, [navigation]);

  const qrSize = Math.min(
    width - spacing.containerPadding * 2 - spacing.xl * 2,
    300,
  );
  const qrImageSize = useMemo(
    () => ({ width: qrSize, height: qrSize }),
    [qrSize],
  );

  const renderBody = () => {
    if (screen.kind === 'loading') {
      return (
        <View style={styles.center}>
          <ActivityIndicator
            size="large"
            color={colors.primary}
            accessibilityLabel={t('collect.title')}
          />
        </View>
      );
    }
    if (screen.kind === 'unavailable') {
      return <InlineErrorBanner message={t('collect.unavailable')} />;
    }
    if (screen.kind === 'load_failed') {
      return (
        <InlineErrorBanner
          message={screen.message}
          onRetry={() => {
            setScreen({ kind: 'loading' });
            loadTrip().catch(() => undefined);
          }}
          retryLabel={t('wallet.retry')}
        />
      );
    }
    if (screen.kind === 'paid') {
      const { collection } = screen;
      return (
        <View style={styles.card}>
          <View style={styles.paidIcon}>
            <Icon name="check_circle" size={48} color={colors.success} />
          </View>
          <Text style={styles.paidTitle} accessibilityLiveRegion="polite">
            {t('collect.paidTitle')}
          </Text>
          <Text style={[styles.amountLarge, styles.textCenter]}>
            {money(collection.amountPaise)}
          </Text>
          <Text style={[styles.note, styles.textCenter]}>
            {collection.method === 'CASH'
              ? collection.platformFeePaise
                ? t('collect.paidCashFee', {
                    fee: money(collection.platformFeePaise),
                  })
                : t('collect.paidCash')
              : t('collect.paidOnline')}
          </Text>
          <PrimaryButton
            label={t('collect.done')}
            onPress={() => navigation.goBack()}
          />
        </View>
      );
    }

    const { trip } = screen;
    const availability = collectAvailability(trip);
    const stageLabel =
      trip.payment.collectionStage === 'PICKUP'
        ? t('collect.stagePickup')
        : t('collect.stageDelivery');

    return (
      <>
        {/* What to collect: all from the server */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.label}>{t('collect.fare')}</Text>
            {trip.payment.collectionStage ? (
              <StatusPill label={stageLabel} variant="info" />
            ) : null}
          </View>
          <Text style={styles.amountLarge}>
            {money(trip.payment.farePaise)}
          </Text>
          <Text style={styles.reference}>
            {t('collect.booking', { ref: trip.externalRef })}
          </Text>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('collect.platformFee')}</Text>
            <Text style={styles.rowValue}>
              {money(trip.payment.platformFeePaise)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>{t('collect.yourShare')}</Text>
            <Text style={styles.rowValueStrong}>
              {money(trip.payment.driverSharePaise)}
            </Text>
          </View>
        </View>

        {actionError ? (
          <View style={styles.errorBlock}>
            <InlineErrorBanner message={actionError.message} />
            {actionError.requiredFeePaise !== null ? (
              <>
                <Text style={styles.note}>
                  {t('collect.lowBalance', {
                    fee: money(actionError.requiredFeePaise),
                  })}
                </Text>
                <SecondaryButton
                  label={t('collect.recharge')}
                  onPress={goToRecharge}
                />
              </>
            ) : null}
          </View>
        ) : null}

        {qr ? (
          <View style={styles.card}>
            <Text style={styles.qrTitle}>
              {t('collect.scanToPay', {
                amount: money(qr.collection.amountPaise),
              })}
            </Text>
            {qr.collection.qr?.url ? (
              qr.collection.qr.product === 'QR_CODE' ? (
                <Image
                  source={{ uri: qr.collection.qr.url }}
                  style={[styles.qrImage, qrImageSize]}
                  resizeMode="contain"
                  accessibilityLabel={t('collect.qrA11y', {
                    amount: money(qr.collection.amountPaise),
                  })}
                />
              ) : (
                <PaymentQrCode
                  value={qr.collection.qr.url}
                  size={qrSize}
                  accessibilityLabel={t('collect.qrA11y', {
                    amount: money(qr.collection.amountPaise),
                  })}
                />
              )
            ) : null}
            <View style={styles.waitingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.waitingText} accessibilityLiveRegion="polite">
                {t('collect.waiting')}
              </Text>
            </View>
            {qr.collection.qr?.expiresAt ? (
              <Text style={styles.noteCenter}>
                {t('collect.expiresAt', {
                  time: timeOf(qr.collection.qr.expiresAt),
                })}
              </Text>
            ) : null}
            {qr.collection.qr?.product === 'PAYMENT_LINK' ? (
              <SecondaryButton
                label={t('collect.shareLink')}
                onPress={() => shareLink(qr)}
              />
            ) : null}
            <SecondaryButton
              label={t('collect.switchToCash')}
              onPress={() => confirmCash(qr.trip)}
              disabled={busy !== null}
            />
          </View>
        ) : availability.kind === 'open' ? (
          <View style={styles.actions}>
            <PrimaryButton
              label={t('collect.qr')}
              onPress={() => {
                collect(trip, 'ONLINE_QR').catch(() => undefined);
              }}
              loading={busy === 'ONLINE_QR'}
              disabled={busy !== null}
            />
            <SecondaryButton
              label={t('collect.cash')}
              onPress={() => confirmCash(trip)}
              disabled={busy !== null}
            />
            {busy === 'CASH' ? (
              <ActivityIndicator
                color={colors.primary}
                accessibilityLabel={t('collect.pleaseWait')}
              />
            ) : null}
            {trip.payment.platformFeePaise > 0 ? (
              <Text style={styles.noteCenter}>
                {t('collect.cashFeeNote', {
                  fee: money(trip.payment.platformFeePaise),
                })}
              </Text>
            ) : null}
          </View>
        ) : availability.kind === 'paid' ? (
          <View style={styles.card}>
            <Text style={styles.note}>
              {availability.prepaid
                ? t('collect.prepaid')
                : t('collect.alreadyPaid')}
            </Text>
            <PrimaryButton
              label={t('collect.done')}
              onPress={() => navigation.goBack()}
            />
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.note}>
              {availability.stage === 'PICKUP'
                ? t('collect.notYetPickup')
                : t('collect.notYetDelivery')}
            </Text>
            <SecondaryButton
              label={t('collect.refresh')}
              onPress={() => {
                loadTrip().catch(() => undefined);
              }}
            />
          </View>
        )}
      </>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={t('collect.title')}
        onBackPress={() => navigation.goBack()}
        showDivider
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.containerPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.containerPadding,
  },
  center: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.xl,
    padding: spacing.containerPadding,
    gap: spacing.gutter,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
  },
  amountLarge: {
    ...typography.displaySm,
    color: colors.primary,
  },
  reference: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  rowValue: {
    ...typography.dataMono,
    color: colors.onSurface,
  },
  rowValueStrong: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  actions: {
    gap: spacing.gutter,
  },
  errorBlock: {
    gap: spacing.xs,
  },
  note: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  noteCenter: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  qrTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
    textAlign: 'center',
  },
  qrImage: {
    alignSelf: 'center',
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  waitingText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  paidIcon: {
    alignItems: 'center',
  },
  paidTitle: {
    ...typography.headlineMd,
    color: colors.onSurface,
    textAlign: 'center',
  },
  textCenter: {
    textAlign: 'center',
  },
});

export default CollectPaymentScreen;
