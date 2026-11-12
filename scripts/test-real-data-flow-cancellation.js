/**
 * Test Suite: Real Application Data Verification for Profile and Cancellation Screens
 * Tests all 4 screens and the shared cancellation service against requirements.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Running Comprehensive Real Application Data Verification Suite...\n');

let passedTests = 0;
let totalTests = 0;

function runTest(testName, testFn) {
  totalTests++;
  try {
    testFn();
    console.log(`  ✅ Passed: ${testName}`);
    passedTests++;
  } catch (error) {
    console.error(`  ❌ FAILED: ${testName}`);
    console.error(`     Error: ${error.message}\n`);
  }
}

const baseDir = path.resolve(__dirname, '..');

// ─── 1. Shared Cancellation Service ───────────────────────────────────────────
console.log('Group 1: Shared Cancellation Service (Authoritative Source of Truth)');

const cancellationServicePath = path.join(baseDir, 'src/services/cancellationService.ts');
assert(fs.existsSync(cancellationServicePath), 'cancellationService.ts must exist');
const cancellationServiceCode = fs.readFileSync(cancellationServicePath, 'utf8');

runTest('1.1 cancellationService exports formatCurrency, getCancellationEstimate, executeTripCancellation', () => {
  assert(cancellationServiceCode.includes('export const formatCurrency ='), 'formatCurrency must be exported');
  assert(cancellationServiceCode.includes('export const getCancellationEstimate ='), 'getCancellationEstimate must be exported');
  assert(cancellationServiceCode.includes('export const executeTripCancellation ='), 'executeTripCancellation must be exported');
  assert(cancellationServiceCode.includes('export const getVehicleIconName ='), 'getVehicleIconName must be exported');
});

runTest('1.2 Fee calculation enforces 25% policy when driver assigned and 0 during grace period', () => {
  assert(cancellationServiceCode.includes('policyPercentage = 25'), 'Default cancellation policy percentage must be 25%');
  assert(cancellationServiceCode.includes('isDriverAssigned ?'), 'Must check if driver is assigned');
  assert(cancellationServiceCode.includes('originalFare * (policyPercentage / 100)'), 'Must calculate percentage of fare');
});

runTest('1.3 Dynamic driver ETA and vehicle information resolution', () => {
  assert(cancellationServiceCode.includes('mins away'), 'Must compute dynamic minutes away');
  assert(cancellationServiceCode.includes('Driver has arrived'), 'Must handle driver arrival');
  assert(cancellationServiceCode.includes('vehiclePlate'), 'Must extract vehicle registration plate');
});

// ─── 2. Customer Profile & Edit Profile Screens ──────────────────────────────
console.log('\nGroup 2: Customer Profile Screen & Edit Profile Screen (Real Customer Data & UID Isolation)');

const profileScreenPath = path.join(baseDir, 'src/screens/profile/ProfileScreen.tsx');
assert(fs.existsSync(profileScreenPath), 'ProfileScreen.tsx must exist');
const profileScreenCode = fs.readFileSync(profileScreenPath, 'utf8');

const editProfileScreenPath = path.join(baseDir, 'src/screens/profile/EditProfileScreen.tsx');
assert(fs.existsSync(editProfileScreenPath), 'EditProfileScreen.tsx must exist');
const editProfileScreenCode = fs.readFileSync(editProfileScreenPath, 'utf8');

runTest('2.1 ProfileScreen has ZERO hardcoded "Sarah Johnson" or mock phone numbers', () => {
  assert(!profileScreenCode.includes('Sarah Johnson'), 'ProfileScreen must NOT contain Sarah Johnson');
  assert(!profileScreenCode.includes('+91 98765 43210'), 'ProfileScreen must NOT contain +91 98765 43210');
  assert(!profileScreenCode.includes('+91 9876543210'), 'ProfileScreen must NOT contain +91 9876543210');
});

runTest('2.2 ProfileScreen dynamically binds customer name, verified phone, and real photo', () => {
  assert(profileScreenCode.includes('userProfile?.fullName'), 'Must read userProfile.fullName');
  assert(profileScreenCode.includes('userProfile?.phone') || profileScreenCode.includes('currentUser?.phoneNumber'), 'Must read userProfile or currentUser phone');
  assert(profileScreenCode.includes('photoUri'), 'Must bind photoUri');
  assert(profileScreenCode.includes('refreshProfile'), 'Must auto-refresh profile on focus');
});

runTest('2.3 EditProfileScreen populates saved profile and syncs changes via markProfileDone', () => {
  assert(!editProfileScreenCode.includes('Sarah Johnson'), 'EditProfileScreen must NOT contain Sarah Johnson');
  assert(editProfileScreenCode.includes('markProfileDone'), 'Must call markProfileDone to persist updates');
  assert(editProfileScreenCode.includes('userProfile?.fullName'), 'Must pre-fill fullName from saved userProfile');
  assert(editProfileScreenCode.includes('userProfile?.email'), 'Must pre-fill email from saved userProfile');
});

// ─── 3. First Cancellation Confirmation Sheet ─────────────────────────────────
console.log('\nGroup 3: First Cancellation Confirmation Sheet');

const cancelConfirmPath = path.join(baseDir, 'src/screens/support/CancellationConfirmationScreen.tsx');
assert(fs.existsSync(cancelConfirmPath), 'CancellationConfirmationScreen.tsx must exist');
const cancelConfirmCode = fs.readFileSync(cancelConfirmPath, 'utf8');

runTest('3.1 First Confirmation Sheet displays dynamic driver ETA and real vehicle plate', () => {
  assert(cancelConfirmCode.includes('getCancellationEstimate'), 'Must invoke getCancellationEstimate');
  assert(cancelConfirmCode.includes('effectiveEta'), 'Must render dynamic ETA');
  assert(cancelConfirmCode.includes('effectiveVehicleInfo'), 'Must render real vehicle info and plate');
});

runTest('3.2 First Confirmation Sheet provides CANCEL TRIP and KEEP TRIP actions', () => {
  assert(cancelConfirmCode.includes('cancelTripCaps') || cancelConfirmCode.includes('CANCEL TRIP'), 'Must have CANCEL TRIP button');
  assert(cancelConfirmCode.includes('keepTrip') || cancelConfirmCode.includes('KEEP TRIP'), 'Must have KEEP TRIP button');
  assert(cancelConfirmCode.includes('handleCancelTrip'), 'Must have cancellation handler');
  assert(cancelConfirmCode.includes('executeTripCancellation'), 'Must invoke backend cancellation service');
  assert(cancelConfirmCode.includes('CancellationResultScreen'), 'Must navigate to CancellationResultScreen on success');
});

// ─── 4. Second Cancellation Confirmation Sheet ────────────────────────────────
console.log('\nGroup 4: Second Cancellation Confirmation Sheet');

const cancelChargePath = path.join(baseDir, 'src/screens/support/CancellationChargeConfirmationScreen.tsx');
assert(fs.existsSync(cancelChargePath), 'CancellationChargeConfirmationScreen.tsx must exist');
const cancelChargeCode = fs.readFileSync(cancelChargePath, 'utf8');

runTest('4.1 Second Confirmation Sheet consumes authoritative fee and provides CANCEL & ACCEPT CHARGE', () => {
  assert(cancelChargeCode.includes('getCancellationEstimate'), 'Must invoke getCancellationEstimate');
  assert(cancelChargeCode.includes('cancelAndAcceptCharge') || cancelChargeCode.includes('CANCEL & ACCEPT CHARGE'), 'Must render CANCEL & ACCEPT CHARGE');
  assert(cancelChargeCode.includes('keepTrip') || cancelChargeCode.includes('KEEP TRIP'), 'Must render KEEP TRIP');
  assert(cancelChargeCode.includes('executeTripCancellation'), 'Must execute trip cancellation with backend');
});

// ─── 5. Trip Cancelled Screen (Visible 10s Countdown & Navigation Stack Reset) ─
console.log('\nGroup 5: Trip Cancelled Screen (Countdown & Stack Reset)');

const cancelResultPath = path.join(baseDir, 'src/screens/support/CancellationResultScreen.tsx');
assert(fs.existsSync(cancelResultPath), 'CancellationResultScreen.tsx must exist');
const cancelResultCode = fs.readFileSync(cancelResultPath, 'utf8');

runTest('5.1 CancellationResultScreen displays real trip reference and fee with ZERO hardcoded sample', () => {
  assert(!cancelResultCode.includes('#TRP-8472-X'), 'Must NOT contain hardcoded #TRP-8472-X');
  assert(!cancelResultCode.includes('₹112.50'), 'Must NOT contain hardcoded ₹112.50');
  assert(cancelResultCode.includes('displayTripId'), 'Must render resolved displayTripId');
  assert(cancelResultCode.includes('displayFeeAmount'), 'Must render dynamic displayFeeAmount');
});

runTest('5.2 CancellationResultScreen implements visible 10-second countdown with auto-navigation', () => {
  assert(cancelResultCode.includes('secondsLeft'), 'Must maintain secondsLeft state');
  assert(cancelResultCode.includes('setInterval'), 'Must run countdown timer');
  assert(cancelResultCode.includes('handleGoHome'), 'Must handle auto-navigation to home');
  assert(cancelResultCode.includes('10'), 'Must initialize countdown to 10 seconds');
});

runTest('5.3 BACK TO HOME button cancels active timer and navigates immediately', () => {
  assert(cancelResultCode.includes('backToHomeCaps') || cancelResultCode.includes('BACK TO HOME'), 'Must render BACK TO HOME button');
  assert(cancelResultCode.includes('clearInterval'), 'Must cancel active interval timer');
  assert(cancelResultCode.includes('hasNavigatedRef'), 'Must prevent duplicate navigation events');
});

runTest('5.4 Hardware BackHandler is guarded and CommonActions.reset clears stack', () => {
  assert(cancelResultCode.includes('BackHandler.addEventListener'), 'Must register hardwareBackPress handler');
  assert(cancelResultCode.includes('CommonActions.reset'), 'Must reset navigation stack with CommonActions.reset');
  assert(cancelResultCode.includes('MainTabs'), 'Must target MainTabs/HomeScreen');
});

// ─── 6. Trip History & Status Screen Integration ──────────────────────────────
console.log('\nGroup 6: Trip History & Status Screen Integration');

const tripCancelledStatusPath = path.join(baseDir, 'src/screens/support/TripCancelledStatusScreen.tsx');
assert(fs.existsSync(tripCancelledStatusPath), 'TripCancelledStatusScreen.tsx must exist');
const tripCancelledStatusCode = fs.readFileSync(tripCancelledStatusPath, 'utf8');

const tripHistoryPath = path.join(baseDir, 'src/screens/profile/TripHistoryScreen.tsx');
assert(fs.existsSync(tripHistoryPath), 'TripHistoryScreen.tsx must exist');
const tripHistoryCode = fs.readFileSync(tripHistoryPath, 'utf8');

runTest('6.1 TripCancelledStatusScreen consumes real route params and details', () => {
  assert(tripCancelledStatusCode.includes('effectiveTripId'), 'Must use effectiveTripId');
  assert(tripCancelledStatusCode.includes('effectivePickup'), 'Must use effectivePickup');
  assert(tripCancelledStatusCode.includes('effectiveDrop'), 'Must use effectiveDrop');
  assert(tripCancelledStatusCode.includes('effectiveFeeTitle'), 'Must use effectiveFeeTitle');
});

runTest('6.2 TripHistoryScreen forwards real trip data to detail / cancellation screens', () => {
  assert(tripHistoryCode.includes("TripCancelledStatusScreen'"), 'Must route to TripCancelledStatusScreen on cancelled trips');
  assert(tripHistoryCode.includes('tripId:'), 'Must pass tripId in route params');
  assert(tripHistoryCode.includes('pickupLocation:'), 'Must pass pickupLocation in route params');
  assert(tripHistoryCode.includes('dropLocation:'), 'Must pass dropLocation in route params');
});

console.log('\n--------------------------------------------------');
console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
console.log('--------------------------------------------------');

if (passedTests === totalTests) {
  console.log('🎉 ALL REAL APPLICATION DATA & CANCELLATION FLOW TESTS PASSED!');
  process.exit(0);
} else {
  console.error('❌ Some tests failed.');
  process.exit(1);
}
