import { getCurrentDriverId } from '../engine/dispatch';
import { getEngineClient } from '../engine/engineClient';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface ProofUpload { proofId: string; uploaded: boolean; }
export type ProofPhase = 'preparing' | 'uploading' | 'verifying';

/** Local files are never sent as evidence. Only the verified server reference reaches delivery. */
export async function uploadDeliveryProof(input: {
  tripId: string; stopId: string; uri: string; contentType?: string;
  previous?: ProofUpload; onPrepared: (proof: ProofUpload) => void; onPhase: (phase: ProofPhase) => void;
  isCurrent?: () => boolean;
}): Promise<string> {
  const uid = getCurrentDriverId();
  const current = () => { if (!uid || getCurrentDriverId() !== uid || input.isCurrent?.() === false) throw new Error('Your sign-in session changed. Reopen the delivery.'); };
  current();
  if (!UUID.test(input.tripId) || !UUID.test(input.stopId)) throw new Error('Reopen the current delivery stop.');
  const path = `/trips/${input.tripId}/stops/${input.stopId}/proof`;
  let proof = input.previous;
  if (!proof?.uploaded) {
    if (!/^(file|content):\/\//.test(input.uri)) throw new Error('Retake the delivery photo.');
    input.onPhase('preparing');
    const response = await fetch(input.uri);
    const blob = await response.blob();
    try {
      current();
      const contentType = input.contentType ?? blob.type;
      if (!['image/jpeg', 'image/png'].includes(contentType) || blob.size < 1 || blob.size > 5 * 1024 * 1024)
        throw new Error('Retake a JPEG or PNG photo up to 5 MB.');
      const plan = await getEngineClient().request({ method: 'POST', path, body: { contentType, sizeBytes: blob.size }, retry: false }) as {
        proofId?: string; upload?: { url?: string; headers?: Record<string, string> };
      };
      current();
      if (!plan || !plan.proofId || !UUID.test(plan.proofId) || !plan.upload?.url || !plan.upload.headers)
        throw new Error('Secure photo upload is unavailable. Retry.');
      const url = new URL(plan.upload.url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Secure photo upload is unavailable.');
      proof = { proofId: plan.proofId, uploaded: false }; input.onPrepared(proof);
      input.onPhase('uploading');
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url.toString()); xhr.timeout = 120_000;
        // The native transport computes Content-Length. No Firebase token goes to storage.
        for (const [key, value] of Object.entries(plan.upload!.headers!))
          if (key.toLowerCase() !== 'content-length') xhr.setRequestHeader(key, value);
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Photo upload failed. Retry or retake.'));
        xhr.onerror = () => reject(new Error('Photo upload connection failed. Retry.'));
        xhr.ontimeout = () => reject(new Error('Photo upload timed out. Retry.'));
        xhr.onabort = () => reject(new Error('Photo upload cancelled.'));
        current(); xhr.send(blob);
      });
      current(); proof = { ...proof, uploaded: true }; input.onPrepared(proof);
    } finally { (blob as Blob & { close?: () => void }).close?.(); }
  }
  current();
  input.onPhase('verifying');
  const ready = await getEngineClient().request({ method: 'POST', path: `${path}/${proof.proofId}/complete`, retry: false }) as { proofId?: string; ready?: boolean };
  current();
  if (ready?.ready !== true || ready.proofId !== proof.proofId) throw new Error('Photo verification is pending. Retry.');
  return `proof:${proof.proofId}`;
}
