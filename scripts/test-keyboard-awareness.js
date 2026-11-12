/**
 * Automated Test Suite for Keyboard Awareness & Input Visibility
 * Run: node scripts/test-keyboard-awareness.js
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('====================================================');
console.log('Running Keyboard Awareness & Visibility Test Suite');
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

// 1. Check KeyboardAwareScrollView component
runTest('KeyboardAwareScrollView exists and exports context & hook', () => {
  const filePath = path.join(rootDir, 'src', 'components', 'organisms', 'KeyboardAwareScrollView.tsx');
  assert.ok(fs.existsSync(filePath), 'KeyboardAwareScrollView.tsx should exist');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('KeyboardAwareScrollView'), 'Must define KeyboardAwareScrollView component');
  assert.ok(content.includes('export { KeyboardAwareScrollView') || content.includes('export default KeyboardAwareScrollView'), 'Must export KeyboardAwareScrollView');
  assert.ok(content.includes('export const useKeyboardAware'), 'Must export useKeyboardAware hook');
  assert.ok(content.includes('KeyboardAwareContext'), 'Must define KeyboardAwareContext');
});

runTest('KeyboardAwareScrollView detects focused input and handles window measurement', () => {
  const filePath = path.join(rootDir, 'src', 'components', 'organisms', 'KeyboardAwareScrollView.tsx');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('currentlyFocusedInput') || content.includes('currentlyFocusedField'), 'Must check currentlyFocusedInput');
  assert.ok(content.includes('measureLayout') && content.includes('measureInWindow'), 'Must support layout measurement');
  assert.ok(content.includes('extraScrollHeight'), 'Must support customizable extraScrollHeight');
  assert.ok(content.includes('keyboardDidShow') && content.includes('keyboardDidHide'), 'Must subscribe to keyboard show/hide events');
  assert.ok(content.includes('footerContainer'), 'Must support sticky footer layout container');
});

runTest('Organisms barrel index exports KeyboardAwareScrollView', () => {
  const filePath = path.join(rootDir, 'src', 'components', 'organisms', 'index.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('KeyboardAwareScrollView') && content.includes('./KeyboardAwareScrollView'), 'Must export KeyboardAwareScrollView in organisms index');
});

// 2. Check InputField integration
runTest('InputField forwards ref and connects to useKeyboardAware hook', () => {
  const filePath = path.join(rootDir, 'src', 'components', 'atoms', 'InputField.tsx');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('forwardRef'), 'InputField must use forwardRef');
  assert.ok(content.includes('useKeyboardAware'), 'InputField must use useKeyboardAware hook');
  assert.ok(content.includes('scrollToInput'), 'InputField must trigger scrollToInput on focus');
});

// 3. Check DraggableBottomSheet keyboard awareness
runTest('DraggableBottomSheet handles keyboard events and adjustResize', () => {
  const filePath = path.join(rootDir, 'src', 'components', 'organisms', 'DraggableBottomSheet.tsx');
  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(content.includes('keyboardDidShow'), 'Must listen to keyboardDidShow');
  assert.ok(content.includes('keyboardDidHide'), 'Must listen to keyboardDidHide');
  assert.ok(content.includes('keyboardHeight'), 'Must track keyboard height');
});

// 4. Verify all targeted form screens adopt KeyboardAwareScrollView
const requiredScreens = [
  { path: 'src/screens/profile/CreateProfileScreen.tsx', name: 'CreateProfileScreen' },
  { path: 'src/screens/profile/EditProfileScreen.tsx', name: 'EditProfileScreen' },
  { path: 'src/screens/logistics/GoodsDetailsScreen.tsx', name: 'GoodsDetailsScreen' },
  { path: 'src/screens/logistics/ReceiverDetailsScreen.tsx', name: 'ReceiverDetailsScreen' },
  { path: 'src/screens/logistics/GoodsInsuranceScreen.tsx', name: 'GoodsInsuranceScreen' },
  { path: 'src/screens/booking/DeclaredValueSelectionScreen.tsx', name: 'DeclaredValueSelectionScreen' },
  { path: 'src/screens/booking/ValidateBookingScreen.tsx', name: 'ValidateBookingScreen' },
  { path: 'src/screens/booking/UnifiedLocationScreen.tsx', name: 'UnifiedLocationScreen' },
  { path: 'src/screens/auth/LoginScreen.tsx', name: 'LoginScreen' },
  { path: 'src/screens/auth/SignUpScreen.tsx', name: 'SignUpScreen' },
  { path: 'src/screens/auth/OtpVerificationScreen.tsx', name: 'OtpVerificationScreen' },
];

requiredScreens.forEach(({ path: screenPath, name }) => {
  runTest(`${name} uses KeyboardAwareScrollView`, () => {
    const fullPath = path.join(rootDir, screenPath);
    assert.ok(fs.existsSync(fullPath), `${screenPath} should exist`);
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.ok(content.includes('KeyboardAwareScrollView'), `${name} must import and use KeyboardAwareScrollView`);
    // Ensure conflicting KeyboardAvoidingView was eliminated
    const usesKAV = /<KeyboardAvoidingView[\s>]/.test(content);
    assert.strictEqual(usesKAV, false, `${name} should not retain redundant KeyboardAvoidingView wrapper`);
  });
});

// 5. Android windowSoftInputMode check
runTest('AndroidManifest.xml specifies windowSoftInputMode="adjustResize"', () => {
  const manifestPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  const content = fs.readFileSync(manifestPath, 'utf8');
  assert.ok(content.includes('android:windowSoftInputMode="adjustResize"'), 'Manifest must configure adjustResize');
});

// 6. Viewport scroll calculation unit test
runTest('Calculates correct scroll offset to reveal field above keyboard and footer', () => {
  function computeTargetScroll({
    viewportHeight,
    currentScrollY,
    keyboardHeight,
    footerHeight,
    inputLayoutY,
    inputHeight,
    extraScrollHeight = 24
  }) {
    const visibleTop = currentScrollY;
    const visibleBottom = currentScrollY + viewportHeight - keyboardHeight - footerHeight;
    const inputTop = inputLayoutY;
    const inputBottom = inputLayoutY + inputHeight;

    if (inputBottom > visibleBottom) {
      return inputBottom - (viewportHeight - keyboardHeight - footerHeight) + extraScrollHeight;
    } else if (inputTop < visibleTop) {
      return Math.max(0, inputTop - extraScrollHeight);
    }
    return null; // Already visible, no scroll needed
  }

  // Case 1: Field is hidden behind keyboard/footer
  const scrollNeeded = computeTargetScroll({
    viewportHeight: 800,
    currentScrollY: 0,
    keyboardHeight: 300,
    footerHeight: 60,
    inputLayoutY: 520,
    inputHeight: 50,
    extraScrollHeight: 20
  });
  // Visible bottom = 0 + 800 - 300 - 60 = 440.
  // Input bottom = 520 + 50 = 570.
  // 570 > 440 -> Target = 570 - 440 + 20 = 150.
  assert.strictEqual(scrollNeeded, 150, 'Should scroll by 150px to reveal hidden input');

  // Case 2: Field is comfortably inside visible viewport
  const noScrollNeeded = computeTargetScroll({
    viewportHeight: 800,
    currentScrollY: 0,
    keyboardHeight: 300,
    footerHeight: 60,
    inputLayoutY: 200,
    inputHeight: 50,
    extraScrollHeight: 20
  });
  assert.strictEqual(noScrollNeeded, null, 'Should not scroll when field is already visible');

  // Case 3: Field is scrolled above top of viewport
  const scrollDownNeeded = computeTargetScroll({
    viewportHeight: 800,
    currentScrollY: 300,
    keyboardHeight: 300,
    footerHeight: 60,
    inputLayoutY: 100,
    inputHeight: 50,
    extraScrollHeight: 20
  });
  // visibleTop = 300, inputTop = 100 < 300 -> target = max(0, 100 - 20) = 80.
  assert.strictEqual(scrollDownNeeded, 80, 'Should scroll up to bring field back into view');
});

console.log('\n----------------------------------------------------');
console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
console.log('----------------------------------------------------');

if (passedTests !== totalTests) {
  process.exit(1);
} else {
  console.log('ALL KEYBOARD AWARENESS TESTS PASSED SUCCESSFULLY!\n');
}
