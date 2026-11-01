import { SignUpScreen } from '../src/screens/auth/SignUpScreen';
import LoginScreen from '../src/screens/auth/LoginScreen';
it('keeps legacy signup imports on the same single entry implementation', () => {
  expect(SignUpScreen).toBe(LoginScreen);
});

