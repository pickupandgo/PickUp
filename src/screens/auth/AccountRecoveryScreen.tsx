import React, { useRef, useState } from 'react';
import { Text } from 'react-native';
import { AuthLayout, authStyles } from './AuthLayout';
import { useSession } from '../../state/SessionContext';
import { AuthButton as Button } from './AuthLayout';

export default function AccountRecoveryScreen() {
  const { registrationStatus, registrationError, retryRegistration, logout } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const act = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await action(); } catch { setError('Could not complete this action. Please try again.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const blocked = registrationStatus === 'blocked';
  return <AuthLayout onSignOut={() => void act(logout)} busy={busy}>
    <Text style={authStyles.title}>{blocked ? 'We couldn’t continue with this account' : 'We couldn’t reach your account'}</Text>
    <Text style={authStyles.body} accessibilityRole="alert">{error || registrationError || 'Please try again.'}</Text>
    <Button label={blocked ? 'Check again' : 'Retry'} onPress={() => void act(retryRegistration)}
      loading={busy} fullWidth style={authStyles.button} />
    <Text style={authStyles.hint}>{blocked ? 'You can sign out and use your original sign-in. If the issue continues, contact support.'
      : 'Your sign-in is still active. You don’t need to enter another OTP.'}</Text>
  </AuthLayout>;
}

