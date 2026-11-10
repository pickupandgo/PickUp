import { useCallback, useEffect, useRef, useState } from 'react';
import { getAuth } from '@react-native-firebase/auth';
import { launchImageLibrary } from 'react-native-image-picker';
import { LocalAvatarStore } from '../services/account/LocalAvatarStore';

export function useLocalAvatar() {
  const uid = getAuth().currentUser?.uid;
  const [state, setState] = useState({
    uid,
    uri: undefined as string | undefined,
    busy: false,
    error: null as string | null,
  });
  const generation = useRef(0),
    mounted = useRef(false),
    choosing = useRef<number | null>(null);
  useEffect(() => {
    mounted.current = true;
    choosing.current = null;
    const request = ++generation.current;
    setState({ uid, uri: undefined, busy: false, error: null });
    if (uid)
      LocalAvatarStore.read(uid)
        .then(uri => {
          if (
            mounted.current &&
            generation.current === request &&
            getAuth().currentUser?.uid === uid
          )
            setState({ uid, uri, busy: false, error: null });
        })
        .catch(() => {
          if (
            mounted.current &&
            generation.current === request &&
            getAuth().currentUser?.uid === uid
          )
            setState({
              uid,
              uri: undefined,
              busy: false,
              error: 'Could not load the photo on this device.',
            });
        });
    const fence = generation;
    return () => {
      mounted.current = false;
      ++fence.current;
    };
  }, [uid]);
  const choose = useCallback(async () => {
    if (!mounted.current || !uid || choosing.current) return;
    const request = ++generation.current;
    choosing.current = request;
    const current = () =>
      mounted.current &&
      generation.current === request &&
      getAuth().currentUser?.uid === uid;
    setState(old => ({ ...old, uid, busy: true, error: null }));
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
        selectionLimit: 1,
        maxWidth: 512,
        maxHeight: 512,
      });
      if (!current() || result.didCancel) return;
      const uri = result.assets?.[0]?.uri;
      if (!uri || result.errorCode)
        throw new Error('Could not open the photo. Please try again.');
      await LocalAvatarStore.save(uid, uri);
      if (current()) setState({ uid, uri, busy: false, error: null });
    } catch {
      if (current())
        setState(old => ({
          ...old,
          error: 'Could not save the photo on this device. Please try again.',
        }));
    } finally {
      if (choosing.current === request) choosing.current = null;
      if (current()) setState(old => ({ ...old, busy: false }));
    }
  }, [uid]);
  const remove = useCallback(() => {
    if (!mounted.current || !uid || getAuth().currentUser?.uid !== uid) return;
    ++generation.current;
    setState({ uid, uri: undefined, busy: false, error: null });
    void LocalAvatarStore.clear(uid).catch(() => {
      if (mounted.current && getAuth().currentUser?.uid === uid)
        setState(old => ({
          ...old,
          error: 'Could not clear the saved photo. Please retry.',
        }));
    });
  }, [uid]);
  return {
    uid,
    uri: state.uid === uid ? state.uri : undefined,
    busy: state.uid === uid && state.busy,
    error: state.uid === uid ? state.error : null,
    choose,
    remove,
  };
}
