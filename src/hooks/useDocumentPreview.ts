import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeModules } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getDocumentPreview, invalidateDocumentPreview, observePreviewPrivacy, renderDocumentPage, type DocumentReference, type PrivatePreview } from '../services/documents/DocumentPreviewService';

export function useSecureDocumentScreen() {
  useFocusEffect(useCallback(() => {
    NativeModules.PrivateDocuments?.secureScreen(true);
    return () => { NativeModules.PrivateDocuments?.secureScreen(false); };
  }, []));
}

export function useDocumentPreview(ref: DocumentReference, revision = 0) {
  const [preview, setPreview] = useState<PrivatePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  useEffect(() => {
    const stop = observePreviewPrivacy(() => {
      ++request.current; setPreview(null); setLoading(false);
      setError('Private preview closed. Tap Retry to reopen.');
    });
    const current = ++request.current;
    const cancel = () => { ++request.current; };
    let expiry: ReturnType<typeof setTimeout>;
    const timeout = setTimeout(() => {
      if (current !== request.current) return;
      ++request.current; setLoading(false); setError('Preview timed out. Tap Retry.');
    }, 25_000);
    setPreview(null); setLoading(true); setError(null);
    getDocumentPreview({ kind: ref.kind, documentId: ref.documentId, vehicleId: ref.vehicleId }).then(value => {
      if (request.current !== current) return;
      setPreview(value); setLoading(false); clearTimeout(timeout);
      expiry = setTimeout(() => {
        setPreview(null); setError('Preview expired. Tap Retry for a fresh preview.');
      }, Math.max(1, value.expiresAt - Date.now()));
    }).catch(cause => {
      if (request.current !== current) return;
      clearTimeout(timeout); setError(cause instanceof Error ? cause.message : 'Preview unavailable.'); setLoading(false);
    });
    return () => { cancel(); clearTimeout(timeout); clearTimeout(expiry); stop(); };
  }, [ref.kind, ref.documentId, ref.vehicleId, revision, attempt]);
  return { preview, loading, error, retry: () => { invalidateDocumentPreview(ref); setAttempt(value => value + 1); } };
}

export function useDocumentPage(preview: PrivatePreview | null, page: number, width: number) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true; setUri(null); setError(false);
    const timeout = setTimeout(() => { if (active && preview) { active = false; setError(true); } }, 20_000);
    if (preview) renderDocumentPage(preview, page, width).then(value => { if (active) setUri(value); })
      .catch(() => { if (active) setError(true); }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); };
  }, [preview, page, width]);
  return { uri, error };
}
