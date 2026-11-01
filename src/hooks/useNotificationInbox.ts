import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuth } from '@react-native-firebase/auth';
import { paymentsRequest } from '../api/payments';
import { toApiError } from '../api/http';
export interface InboxEvent { id: string; type: string; title: string; body: string; createdAt: string; readAt: string | null; data: Record<string, unknown>; }
interface InboxPage { items: InboxEvent[]; nextCursor: string | null; }
export const useNotificationInbox = (enabled: boolean) => {
 const owner = getAuth().currentUser?.uid;
 const [state, setState] = useState<{ owner?: string; items: InboxEvent[]; nextCursor: string | null; error?: string }>({ items: [], nextCursor: null });
 const [loading, setLoading] = useState(false);
 const request = useRef<AbortController | null>(null);
 const mounted = useRef(true);
 const load = useCallback(async (cursor?: string) => {
  if (!enabled || !owner) { setLoading(false); return; }
  request.current?.abort(); const controller = new AbortController(); request.current = controller;
  setLoading(true);
  const current = () => mounted.current && !controller.signal.aborted && getAuth().currentUser?.uid === owner;
  try {
   const page = await paymentsRequest<InboxPage>('/v1/notifications/inbox' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''), { signal: controller.signal });
   if (!Array.isArray(page.items) || page.items.some(item => !item.id || typeof item.type !== 'string' || typeof item.title !== 'string' || typeof item.body !== 'string' || !Number.isFinite(Date.parse(item.createdAt)))) throw new Error('Notification response is invalid.');
   if (current()) setState(previous => ({ owner, items: cursor && previous.owner === owner ? [...previous.items, ...page.items.filter(item => !previous.items.some(old => old.id === item.id))] : page.items, nextCursor: page.nextCursor }));
  } catch (error) { if (current()) setState(previous => ({ owner, items: previous.owner === owner ? previous.items : [], nextCursor: null, error: toApiError(error).userMessage })); }
  finally { if (current()) setLoading(false); }
 }, [enabled, owner]);
 useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; request.current?.abort(); }; }, [load]);
 const markRead = async (id: string) => {
  if (!owner) throw new Error('Sign in to view notifications.');
  const result = await paymentsRequest<{ success: boolean }>(`/v1/notifications/inbox/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} });
  if (!mounted.current || getAuth().currentUser?.uid !== owner) throw new Error('Your sign-in changed.');
  if (result.success !== true) throw new Error('Read status was not saved.');
  setState(previous => previous.owner === owner ? { ...previous, items: previous.items.map(item => item.id === id ? { ...item, readAt: new Date().toISOString() } : item) } : previous);
 };
 return { items: state.owner === owner ? state.items : [], nextCursor: state.owner === owner ? state.nextCursor : null,
  error: enabled && !owner ? 'Sign in to view notifications.' : state.owner === owner ? state.error : undefined, loading, load, markRead };
};
