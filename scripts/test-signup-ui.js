/**
 * Automated Verification Suite for Sign Up Screen UI Modifications
 * Run: node scripts/test-signup-ui.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('====================================================');
console.log('Running Sign Up Screen UI Modifications Test Suite');
console.log('====================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err.message}`);
  }
}

const rootDir = path.join(__dirname, '..');
const signUpScreenPath = path.join(rootDir, 'src', 'screens', 'auth', 'SignUpScreen.tsx');
const signUpContent = fs.readFileSync(signUpScreenPath, 'utf8');

// 1. Logo Verification
runTest('Logo asset exists and is referenced in SignUpScreen with resizeMode="contain"', () => {
  const logoAssetPath = path.join(rootDir, 'assets', 'images', 'assets_logo.png');
  assert.ok(fs.existsSync(logoAssetPath), 'assets/images/assets_logo.png must exist');
  assert.ok(
    signUpContent.includes('assets_logo.png') || signUpContent.includes('assets/logo.png'),
    'SignUpScreen must reference the official logo asset'
  );
  assert.ok(signUpContent.includes('resizeMode="contain"'), 'Logo must have resizeMode="contain"');
  assert.ok(!signUpContent.includes('📦'), 'Package emoji/box illustration must be completely removed');
});

// 2. Removal of Top Log In Option & Segmented Switcher
runTest('Top Log In / Sign Up segmented switcher is removed', () => {
  assert.ok(!signUpContent.includes('entryModeContainer'), 'entryModeContainer must be removed');
  assert.ok(!signUpContent.includes('entryModeActive'), 'entryModeActive must be removed');
  assert.ok(!signUpContent.includes('entryModeTab'), 'entryModeTab must be removed');
  assert.ok(
    signUpContent.includes('createAccountTitle') || signUpContent.includes('Create Account'),
    'Create Account title must be preserved'
  );
  assert.ok(
    signUpContent.includes('createAccountSub') || signUpContent.includes('Sign up to start'),
    'Sign up subtitle must be preserved'
  );
});

// 3. Removal of Email & Password Option
runTest('Email & Password tab and form fields are completely removed', () => {
  assert.ok(!signUpContent.includes('emailPasswordTab'), 'emailPasswordTab must not be rendered');
  assert.ok(!signUpContent.includes('Email & Password'), 'Email & Password text must not appear');
  assert.ok(!signUpContent.includes('passwordHeaderRow'), 'passwordHeaderRow must be removed');
  assert.ok(!signUpContent.includes('passwordInput'), 'passwordInput must be removed');
  assert.ok(!signUpContent.includes('confirmPassword'), 'confirmPassword must be removed');
  assert.ok(!signUpContent.includes('signUpWithEmail'), 'signUpWithEmail must not be imported in SignUpScreen');
});

// 4. Mobile OTP Selector is Removed While Underlying Registration is Preserved
runTest('Mobile OTP selector button is removed while phone registration is preserved', () => {
  assert.ok(!signUpContent.includes('tabContainer'), 'tabContainer selector must be removed');
  assert.ok(!signUpContent.includes('activeTab'), 'activeTab style must be removed');
  assert.ok(signUpContent.includes('+91'), 'Phone number +91 prefix must be present');
  assert.ok(signUpContent.includes('sendPhoneOTP'), 'sendPhoneOTP must be wired to handleGetOtp');
  assert.ok(signUpContent.includes('authMode: \'signup\''), 'authMode must be signup when navigating to OTP verification');
  assert.ok(signUpContent.includes('keyboardType="phone-pad"'), 'Phone input must use phone-pad keyboard');
});

// 5. Continue with Apple Removed & Continue with Google Retained
runTest('Continue with Apple is removed while Continue with Google is preserved and centered', () => {
  assert.ok(!signUpContent.includes('Continue with Apple'), 'Continue with Apple must not be present');
  assert.ok(!signUpContent.includes('signInWithApple'), 'signInWithApple must not be imported in SignUpScreen');
  assert.ok(signUpContent.includes('Continue with Google') || signUpContent.includes('continueWithGoogle'), 'Continue with Google must be present');
  assert.ok(signUpContent.includes('signInWithGoogle'), 'signInWithGoogle must be wired');
});

// 6. Navigation to Log In and Legal Links Preserved
runTest('Bottom Log In navigation and Terms of Service are preserved', () => {
  assert.ok(signUpContent.includes("navigation?.navigate('LoginScreen')"), 'Bottom Log In link must navigate to LoginScreen');
  assert.ok(signUpContent.includes('alreadyHaveAccount') || signUpContent.includes('Already have an account?'), 'Already have an account text must be present');
  assert.ok(signUpContent.includes('Terms of Service') || signUpContent.includes('termsOfService'), 'Terms of Service must be present');
  assert.ok(signUpContent.includes('Privacy Policy') || signUpContent.includes('privacyPolicy'), 'Privacy Policy must be present');
});

console.log('\n----------------------------------------------------');
console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
console.log('----------------------------------------------------');

if (passedTests !== totalTests) {
  process.exit(1);
} else {
  console.log('ALL SIGN UP SCREEN UI TESTS PASSED SUCCESSFULLY!\n');
}
