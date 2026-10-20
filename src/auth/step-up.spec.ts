import type { AuthSession } from './principal';
import { checkStepUp, maskPhone } from './step-up';

describe('checkStepUp', () => {
  const phone = '+919876543210';
  const challengeAt = new Date('2026-10-08T10:00:00.400Z');
  const session = (overrides: Partial<AuthSession> = {}): AuthSession => ({
    authenticatedAt: new Date('2026-10-08T10:00:30.000Z'),
    signInProvider: 'phone',
    phoneNumber: phone,
    ...overrides,
  });

  it('accepts a phone OTP sign-in on the registered number after the challenge', () => {
    expect(checkStepUp(session(), phone, challengeAt)).toBeNull();
  });

  it('refuses the session that existed before the challenge, however recent', () => {
    // Signed in 1 second before the challenge: a stolen fresh session is still not a step-up.
    expect(
      checkStepUp(
        session({ authenticatedAt: new Date('2026-10-08T09:59:59.000Z') }),
        phone,
        challengeAt,
      ),
    ).toBe('REAUTHENTICATION_REQUIRED');
    // auth_time has whole seconds: the same second as the challenge never counts.
    expect(
      checkStepUp(
        session({ authenticatedAt: new Date('2026-10-08T10:00:00.000Z') }),
        phone,
        challengeAt,
      ),
    ).toBe('REAUTHENTICATION_REQUIRED');
    expect(checkStepUp(session({ authenticatedAt: null }), phone, challengeAt)).toBe(
      'REAUTHENTICATION_REQUIRED',
    );
  });

  it('refuses anything but a phone sign-in', () => {
    for (const provider of ['custom', 'anonymous', 'password', 'google.com', null]) {
      expect(checkStepUp(session({ signInProvider: provider }), phone, challengeAt)).toBe(
        'NOT_PHONE_SIGN_IN',
      );
    }
  });

  it('refuses a different or missing phone number', () => {
    expect(checkStepUp(session({ phoneNumber: '+919876543211' }), phone, challengeAt)).toBe(
      'PHONE_MISMATCH',
    );
    expect(checkStepUp(session({ phoneNumber: '9876543210' }), phone, challengeAt)).toBe(
      'PHONE_MISMATCH',
    );
    expect(checkStepUp(session({ phoneNumber: null }), phone, challengeAt)).toBe('PHONE_MISMATCH');
  });
});

describe('maskPhone', () => {
  it('keeps the country code and the last four digits', () => {
    expect(maskPhone('+919876543210')).toBe('+91******3210');
    expect(maskPhone('+1234')).toBe('*****');
  });
});
