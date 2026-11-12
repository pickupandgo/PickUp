/**
 * Automated Verification Suite for Login Screen UI Modifications
 * Run: node scripts/test-login-ui.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('====================================================');
console.log('Running Login Screen UI Modifications Test Suite');
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
const loginScreenPath = path.join(rootDir, 'src', 'screens', 'auth', 'LoginScreen.tsx');
const loginContent = fs.readFileSync(loginScreenPath, 'utf8');

// 1. Logo Verification
runTest('Logo asset exists and is referenced in LoginScreen', () => {
  const logoAssetPath = path.join(rootDir, 'assets', 'images', 'assets_logo.png');
  assert.ok(fs.existsSync(logoAssetPath), 'assets/images/assets_logo.png must exist');
  assert.ok(
    loginContent.includes('assets_logo.png') || loginContent.includes('assets/logo.png'),
    'LoginScreen must reference the official logo asset'
  );
  assert.ok(loginContent.includes('resizeMode="contain"'), 'Logo must have resizeMode="contain"');
  assert.ok(!loginContent.includes('📦'), 'Package emoji/box illustration must be completely removed');
});

// 2. Removal of Top Sign Up Option & Segmented Switcher
runTest('Top Log In / Sign Up segmented switcher is removed', () => {
  assert.ok(!loginContent.includes('entryModeContainer'), 'entryModeContainer must be removed');
  assert.ok(!loginContent.includes('entryModeActive'), 'entryModeActive must be removed');
  assert.ok(!loginContent.includes('entryModeTab'), 'entryModeTab must be removed');
});

// 3. Removal of Email & Password Option
runTest('Email & Password tab and form fields are completely removed', () => {
  assert.ok(!loginContent.includes('emailPasswordTab'), 'emailPasswordTab must not be rendered');
  assert.ok(!loginContent.includes('Email & Password'), 'Email & Password text must not appear');
  assert.ok(!loginContent.includes('passwordHeaderRow'), 'passwordHeaderRow must be removed');
  assert.ok(!loginContent.includes('passwordInput'), 'passwordInput must be removed');
  assert.ok(!loginContent.includes('forgotPasswordText'), 'forgotPasswordText must be removed');
  assert.ok(!loginContent.includes('signInWithEmail'), 'signInWithEmail must not be imported in LoginScreen');
});

// 4. Mobile OTP Selector is Removed While Underlying Auth is Preserved
runTest('Mobile OTP selector button is removed while phone authentication is preserved', () => {
  assert.ok(!loginContent.includes('tabContainer'), 'tabContainer selector must be removed');
  assert.ok(!loginContent.includes('activeTab'), 'activeTab style must be removed');
  assert.ok(loginContent.includes('+91'), 'Phone number +91 prefix must be present');
  assert.ok(loginContent.includes('sendPhoneOTP'), 'sendPhoneOTP must be wired to handleGetOtp');
  assert.ok(loginContent.includes('keyboardType="phone-pad"'), 'Phone input must use phone-pad keyboard');
});

// 5. Continue with Apple Removed & Continue with Google Retained
runTest('Continue with Apple is removed while Continue with Google is preserved', () => {
  assert.ok(!loginContent.includes('Continue with Apple'), 'Continue with Apple must not be present');
  assert.ok(!loginContent.includes('signInWithApple'), 'signInWithApple must not be imported in LoginScreen');
  assert.ok(loginContent.includes('Continue with Google') || loginContent.includes('continueWithGoogle'), 'Continue with Google must be present');
  assert.ok(loginContent.includes('signInWithGoogle'), 'signInWithGoogle must be wired');
});

// 6. Navigation and Legal Links Preserved
runTest('Bottom Sign Up navigation and Terms of Service are preserved', () => {
  assert.ok(loginContent.includes("navigation?.navigate('SignUpScreen')"), 'Bottom Sign Up link must navigate to SignUpScreen');
  assert.ok(loginContent.includes('Terms of Service') || loginContent.includes('termsOfService'), 'Terms of Service must be present');
  assert.ok(loginContent.includes('Privacy Policy') || loginContent.includes('privacyPolicy'), 'Privacy Policy must be present');
});

// 7. Sign Out Behavior on CreateProfileScreen
runTest('Sign Out on CreateProfileScreen executes session logout and resets navigation', () => {
  const profileScreenPath = path.join(rootDir, 'src', 'screens', 'profile', 'CreateProfileScreen.tsx');
  const profileContent = fs.readFileSync(profileScreenPath, 'utf8');
  assert.ok(profileContent.includes('handleSignOut'), 'handleSignOut handler must be implemented');
  assert.ok(profileContent.includes('logout()'), 'logout() must be called');
  assert.ok(
    profileContent.includes("navigation.reset") && profileContent.includes("LoginScreen"),
    'navigation must reset stack to LoginScreen on sign out'
  );
});

console.log('\n----------------------------------------------------');
console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
console.log('----------------------------------------------------');

if (passedTests !== totalTests) {
  process.exit(1);
} else {
  console.log('ALL LOGIN SCREEN UI TESTS PASSED SUCCESSFULLY!\n');
}
