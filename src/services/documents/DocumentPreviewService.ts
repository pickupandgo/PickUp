import { AppState, NativeModules } from 'react-native';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { DriverOnboardingService, OnboardingRequestError, type DriverOnboardingSummary, type OnboardingDocument } from '../onboarding/DriverOnboardingService';

export interface DocumentReference { readonly kind: 'KYC' | 'VEHICLE'; readonly documentId: string; readonly vehicleId?: string }
export interface SavedDocument { readonly ref: DocumentReference; readonly record: OnboardingDocument }
export interface PrivatePreview {
  readonly name: string;
  readonly status: string;
  readonly handle: string; readonly contentType: string; readonly pageCount: number;
  readonly pages: readonly { width: number; height: number }[]; readonly expiresAt: number;
}
export type PreviewErrorCode = 'UNAUTHENTICATED' | 'ACCESS_DENIED' | 'UNAVAILABLE' | 'NOT_READY' | 'UNSUPPORTED' | 'NETWORK' | 'EXPIRED';
export class PreviewError extends Error {
  constructor(public readonly code: PreviewErrorCode, message: string) { super(message); }
}
const native = () => NativeModules.PrivateDocuments;
const listeners = new Set<() => void>();
let generation = 0;
let identity: string | undefined;
let observing = false;
let metadata: { uid: string; expires: number; promise: Promise<DriverOnboardingSummary> } | null = null;
const cache = new Map<string, { expires: number; promise: Promise<PrivatePreview> }>();
const error = (code: PreviewErrorCode, message: string): never => { throw new PreviewError(code, message); };

export function savedDocuments(summary: DriverOnboardingSummary, kind?: 'KYC' | 'VEHICLE', vehicleId?: string): SavedDocument[] {
  const latest = (records: readonly OnboardingDocument[]) => {
    const types = new Map<string, OnboardingDocument>();
    for (const record of records) if (!types.has(record.documentType) || types.get(record.documentType)!.version < record.version) types.set(record.documentType, record);
    return [...types.values()];
  };
  const kyc = kind === 'VEHICLE' ? [] : latest(summary.kyc?.documents ?? []).map(record => ({ record, ref: { kind: 'KYC' as const, documentId: record.id } }));
  const vehicles = kind === 'KYC' ? [] : summary.vehicles.filter(v => !vehicleId || v.id === vehicleId).flatMap(v =>
    latest(v.documents).map(record => ({ record, ref: { kind: 'VEHICLE' as const, documentId: record.id, vehicleId: v.id } })));
  return [...kyc, ...vehicles];
}

/** Drops metadata, opaque handles and private native files. No signed URLs are persisted. */
export function clearDocumentPreviews() {
  ++generation; cache.clear(); metadata = null;
  native()?.clear?.();
  listeners.forEach(listener => listener());
}
export function observePreviewPrivacy(listener: () => void) {
  listeners.add(listener);
  if (!observing) {
    observing = true; identity = getAuth().currentUser?.uid;
    onAuthStateChanged(getAuth(), user => {
      if (identity !== user?.uid) { identity = user?.uid; clearDocumentPreviews(); }
    });
    AppState.addEventListener('change', state => { if (state !== 'active') clearDocumentPreviews(); });
  }
  return () => { listeners.delete(listener); };
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = { VERIFIED: 'Verified', IN_REVIEW: 'Pending review', REJECTED: 'Rejected', SUBMITTED: 'Submitted', DRAFT: 'Not submitted', INACTIVE: 'Inactive', QUARANTINED: 'Scanning / pending review', UPLOADING: 'Uploading', SCAN_FAILED: 'Scan failed', STORAGE_UNAVAILABLE: 'Storage unavailable' };
  return labels[status] ?? status.replace(/_/g, ' ');
}
export const documentName = (type: string) => ({ DRIVER_PHOTO: 'Driver photo', DRIVING_LICENSE: 'Driving licence', DRIVING_LICENCE: 'Driving licence', IDENTITY_PROOF: 'Identity proof', AADHAAR: 'Aadhaar card', AADHAAR_CARD: 'Aadhaar card', REGISTRATION_CERTIFICATE: 'Registration certificate (RC)', INSURANCE_CERTIFICATE: 'Insurance certificate' }[type] ?? type.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()));

export function documentReviewInfo(record: OnboardingDocument): string | null {
  const timestamp = record.reviewedAt ?? record.uploadedAt;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return null;
  return `${record.reviewedAt ? 'Last reviewed' : 'Uploaded'}: ${new Date(timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
}

export function invalidateDocumentPreview(ref: DocumentReference) {
  const uid = getAuth().currentUser?.uid;
  cache.delete(`${uid}:${ref.kind}:${ref.vehicleId ?? ''}:${ref.documentId}`);
  metadata = null;
}

export async function getDocumentPreview(ref: DocumentReference): Promise<PrivatePreview> {
  const uid = getAuth().currentUser?.uid;
  if (!uid) return error('UNAUTHENTICATED', 'Please sign in again to view documents.');
  if (identity !== uid) { identity = uid; clearDocumentPreviews(); }
  if (ref.kind !== 'KYC' && ref.kind !== 'VEHICLE') return error('ACCESS_DENIED', 'This document is not available to this account.');
  const key = `${uid}:${ref.kind}:${ref.vehicleId ?? ''}:${ref.documentId}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const version = generation;
  const check = () => {
    if (version !== generation || getAuth().currentUser?.uid !== uid) return error('UNAUTHENTICATED', 'Your document session ended. Please reopen the document.');
  };
  const promise = (async () => {
    try {
      if (!metadata || metadata.uid !== uid || metadata.expires <= Date.now()) metadata = {
        uid, expires: Date.now() + 15_000, promise: DriverOnboardingService.getInstance().getSummary(),
      };
      const summary = await metadata.promise; check();
      const found = savedDocuments(summary, ref.kind, ref.kind === 'VEHICLE' ? ref.vehicleId : undefined)
        .find(doc => doc.ref.documentId === ref.documentId && doc.ref.vehicleId === ref.vehicleId);
      if (!found || (ref.kind === 'VEHICLE' && !ref.vehicleId)) return error('ACCESS_DENIED', 'This document is not available to this account or vehicle.');
      if (found.record.status === 'UPLOADING') return error('NOT_READY', 'The upload is not complete yet. Refresh after it finishes.');
      // Existing client contract. The inspected backend lacks this driver route; 404 stays explicit.
      const grant = await DriverOnboardingService.getInstance().previewDocument(ref.kind, ref.documentId); check();
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(grant.contentType)) return error('UNSUPPORTED', 'This file format cannot be previewed.');
      if (!/^https:\/\/[^\s/@]+(?:\/[^\s]*)?$/.test(grant.url) || !Number.isFinite(grant.expiresInSeconds) || grant.expiresInSeconds <= 0) return error('UNAVAILABLE', 'A secure preview could not be obtained.');
      if (!native()?.open) return error('UNAVAILABLE', 'Private document viewing is unavailable on this app version.');
      const ttl = Math.min(60, grant.expiresInSeconds) * 1000;
      const expiresAt = Date.now() + ttl;
      const result = await native().open(grant.url, grant.contentType, ttl); check();
      if (Date.now() >= expiresAt) return error('EXPIRED', 'The preview link expired. Tap Retry for a fresh preview.');
      return { ...result, name: documentName(found.record.documentType), status: found.record.status, contentType: grant.contentType, expiresAt } as PrivatePreview;
    } catch (cause) {
      cache.delete(key); metadata = null;
      if (cause instanceof PreviewError) throw cause;
      if (cause instanceof OnboardingRequestError) {
        if (cause.status === 401) return error('UNAUTHENTICATED', 'Please sign in again to view documents.');
        if (cause.status === 403) return error('ACCESS_DENIED', 'You do not have access to this preview.');
        if (cause.status === 404) return error('UNAVAILABLE', 'Preview unavailable. The document or preview service could not be found.');
        if (cause.status === 409 || cause.status === 422) return error('NOT_READY', 'This document is not ready for preview yet.');
      }
      const code = (cause as { code?: string })?.code;
      if (code === 'EXPIRED') return error('EXPIRED', 'The preview link expired. Tap Retry for a fresh preview.');
      if (code === 'UNSUPPORTED') return error('UNSUPPORTED', 'This document format could not be opened.');
      return error('NETWORK', 'Preview could not be loaded. Check your connection and retry.');
    }
  })();
  cache.set(key, { promise, expires: Date.now() + 45_000 });
  promise.then(result => { const entry = cache.get(key); if (entry?.promise === promise) entry.expires = result.expiresAt; }).catch(() => undefined);
  return promise;
}

export async function renderDocumentPage(preview: PrivatePreview, page: number, width: number): Promise<string> {
  if (Date.now() >= preview.expiresAt) return error('EXPIRED', 'The preview expired. Tap Retry to reopen it.');
  try { return await native().render(preview.handle, page, Math.min(1800, Math.max(100, Math.round(width)))); }
  catch { return error('UNAVAILABLE', 'This page could not be displayed. Tap Retry.'); }
}
