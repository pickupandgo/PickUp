import { toPaymentGateView } from '../bookings/bookings.mapper';
import { paiseToNumber } from '../common/money';
import type { PaymentCollection } from '../generated/prisma/client';
import type {
  AdminCollectionResponse,
  CollectionMethodValue,
  CollectionResponse,
  DriverCollectionResponse,
} from './collections.dto';
import type { CollectionDriverView } from './collections.service';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toCollectionResponse(
  collection: PaymentCollection,
  options: { readonly stopSequence: number | null; readonly replayed?: boolean },
): CollectionResponse {
  const online = collection.method === 'ONLINE_QR';
  return {
    collectionId: collection.id,
    bookingId: collection.bookingId,
    tripId: collection.tripId,
    stage: collection.stage,
    stopSequence: options.stopSequence,
    method: collection.method as CollectionMethodValue,
    status: collection.status,
    amountPaise: paiseToNumber(collection.amountPaise),
    platformFeePaise:
      collection.platformFeePaise === null ? null : paiseToNumber(collection.platformFeePaise),
    qr:
      online &&
      (collection.providerProduct === 'PAYMENT_LINK' || collection.providerProduct === 'QR_CODE')
        ? {
            product: collection.providerProduct,
            // Only a payable QR is shown; once paid, expired or cancelled it is withheld.
            url: collection.status === 'PENDING' ? collection.providerLinkUrl : null,
            expiresAt: iso(collection.expiresAt),
          }
        : null,
    providerPaymentId: collection.providerPaymentId,
    paymentMethod: collection.paymentMethod,
    failureReason: collection.failureReason,
    completedAt: iso(collection.completedAt),
    createdAt: collection.createdAt.toISOString(),
    replayed: options.replayed ?? false,
  };
}

export function toDriverCollectionResponse(
  collection: PaymentCollection,
  view: CollectionDriverView,
  replayed = false,
): DriverCollectionResponse {
  return {
    ...toCollectionResponse(collection, { stopSequence: view.stopSequence, replayed }),
    bookingPaymentStatus: view.bookingPaymentStatus,
    paymentGate: toPaymentGateView(view.paymentGate),
  };
}

export function toAdminCollectionResponse(
  collection: PaymentCollection,
  stopSequence: number | null,
): AdminCollectionResponse {
  return {
    ...toCollectionResponse(collection, { stopSequence }),
    collectedByDriverId: collection.collectedByDriverId,
    provider: collection.provider,
    providerReferenceId: collection.providerReferenceId,
    providerOrderId: collection.providerOrderId,
    feeRuleId: collection.feeRuleId,
    walletTransactionId: collection.walletTransactionId,
    idempotencyKey: collection.idempotencyKey,
  };
}
