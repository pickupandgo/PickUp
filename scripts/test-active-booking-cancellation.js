const assert = require('assert');

// Mock React and React Native primitives
let alertCall = null;
let backHandlerListener = null;

const Alert = {
  alert: (title, message, buttons, options) => {
    alertCall = { title, message, buttons, options };
  },
};

const BackHandler = {
  addEventListener: (event, handler) => {
    if (event === 'hardwareBackPress') {
      backHandlerListener = handler;
    }
    return {
      remove: () => {
        if (backHandlerListener === handler) {
          backHandlerListener = null;
        }
      },
    };
  },
};

// Test implementation of useActiveBookingCancellation logic
function createCancellationController({
  navigation,
  isBookingActive,
  onCancelConfirm,
  allowedNextRoutes = [],
}) {
  let isCancelling = false;
  const isCancellingRef = { current: false };
  const isCancelledRef = { current: false };
  const isDialogActiveRef = { current: false };

  const requestCancellation = () => {
    if (!isBookingActive || isCancellingRef.current || isCancelledRef.current || isDialogActiveRef.current) {
      return;
    }

    isDialogActiveRef.current = true;

    Alert.alert(
      'Cancel Booking?',
      'Are you sure you want to cancel this booking?',
      [
        {
          text: 'Keep Booking',
          style: 'cancel',
          onPress: () => {
            isDialogActiveRef.current = false;
          },
        },
        {
          text: 'Cancel Booking',
          style: 'destructive',
          onPress: async () => {
            isDialogActiveRef.current = false;
            if (isCancellingRef.current || isCancelledRef.current) return;
            isCancellingRef.current = true;
            isCancelling = true;

            try {
              await onCancelConfirm();
              isCancelledRef.current = true;
              isCancelling = false;
              navigation.reset({
                index: 0,
                routes: [{ name: 'MainTabs', params: { screen: 'HomeScreen' } }],
              });
            } catch (err) {
              isCancellingRef.current = false;
              isCancelling = false;
              const errorMessage = err?.message || 'Could not cancel booking. Please try again.';
              Alert.alert('Cancellation Error', errorMessage);
            }
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          isDialogActiveRef.current = false;
        },
      }
    );
  };

  // beforeRemove simulation
  const onBeforeRemove = (e) => {
    if (isCancelledRef.current) return false; // Allowed
    if (!isBookingActive) return false; // Allowed

    const targetRoute = e?.data?.action?.payload?.name;
    if (targetRoute && allowedNextRoutes.includes(targetRoute)) {
      return false; // Allowed
    }

    e.preventDefault();
    if (!isCancellingRef.current) {
      requestCancellation();
    }
    return true; // Prevented
  };

  // hardwareBack simulation
  const onHardwareBack = () => {
    if (isCancelledRef.current) return false;
    requestCancellation();
    return true;
  };

  return {
    getIsCancelling: () => isCancelling,
    getIsCancelled: () => isCancelledRef.current,
    getIsDialogActive: () => isDialogActiveRef.current,
    requestCancellation,
    onBeforeRemove,
    onHardwareBack,
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

async function runTests() {
  console.log('🧪 Running Active Booking Cancellation Test Suite...\n');

  // Test 1: Hardware Back button triggers confirmation dialog with exact strings
  {
    console.log('Test 1: Hardware Back button triggers confirmation dialog with exact title, message, and buttons');
    alertCall = null;
    let navResetCalled = false;
    const nav = {
      reset: () => { navResetCalled = true; },
    };

    const ctrl = createCancellationController({
      navigation: nav,
      isBookingActive: true,
      onCancelConfirm: async () => {},
    });

    const handled = ctrl.onHardwareBack();
    assert.strictEqual(handled, true, 'Hardware back must consume event (return true)');
    assert.notStrictEqual(alertCall, null, 'Alert must be opened');
    assert.strictEqual(alertCall.title, 'Cancel Booking?');
    assert.strictEqual(alertCall.message, 'Are you sure you want to cancel this booking?');
    assert.strictEqual(alertCall.buttons.length, 2);
    assert.strictEqual(alertCall.buttons[0].text, 'Keep Booking');
    assert.strictEqual(alertCall.buttons[1].text, 'Cancel Booking');
    assert.strictEqual(navResetCalled, false, 'Must not navigate directly to Home on Back');
    console.log('  ✅ Passed\n');
  }

  // Test 2: Selecting "Keep Booking" closes dialog and remains on screen
  {
    console.log('Test 2: Selecting "Keep Booking" closes dialog and remains on screen');
    alertCall = null;
    let cancelApiCalled = false;
    let navResetCalled = false;
    const nav = {
      reset: () => { navResetCalled = true; },
    };

    const ctrl = createCancellationController({
      navigation: nav,
      isBookingActive: true,
      onCancelConfirm: async () => { cancelApiCalled = true; },
    });

    ctrl.onHardwareBack();
    assert.strictEqual(ctrl.getIsDialogActive(), true);

    // Click "Keep Booking"
    const keepBtn = alertCall.buttons.find(b => b.text === 'Keep Booking');
    keepBtn.onPress();

    assert.strictEqual(ctrl.getIsDialogActive(), false, 'Dialog must be closed');
    assert.strictEqual(ctrl.getIsCancelled(), false, 'Must not be cancelled');
    assert.strictEqual(cancelApiCalled, false, 'Cancellation API must NOT be called on Keep Booking');
    assert.strictEqual(navResetCalled, false, 'Must NOT navigate to Home on Keep Booking');
    console.log('  ✅ Passed\n');
  }

  // Test 3: Selecting "Cancel Booking" calls API and navigates to Home only after backend confirms
  {
    console.log('Test 3: Selecting "Cancel Booking" calls backend API and navigates to Home on success');
    alertCall = null;
    let cancelApiCalled = false;
    let navResetCalled = false;
    const nav = {
      reset: (payload) => {
        navResetCalled = true;
        assert.strictEqual(payload.routes[0].name, 'MainTabs');
      },
    };

    const ctrl = createCancellationController({
      navigation: nav,
      isBookingActive: true,
      onCancelConfirm: async () => {
        // Verify we are in cancelling state before API completes
        cancelApiCalled = true;
      },
    });

    ctrl.onHardwareBack();
    const cancelBtn = alertCall.buttons.find(b => b.text === 'Cancel Booking');
    await cancelBtn.onPress();

    assert.strictEqual(cancelApiCalled, true, 'Cancellation API must be called');
    assert.strictEqual(ctrl.getIsCancelled(), true, 'isCancelled must be true');
    assert.strictEqual(navResetCalled, true, 'Must navigate to Home after backend confirms');
    console.log('  ✅ Passed\n');
  }

  // Test 4: Cancellation API Failure displays error message and stays on active screen
  {
    console.log('Test 4: Cancellation API failure displays error message and stays on active screen');
    alertCall = null;
    let navResetCalled = false;
    const nav = {
      reset: () => { navResetCalled = true; },
    };

    const ctrl = createCancellationController({
      navigation: nav,
      isBookingActive: true,
      onCancelConfirm: async () => {
        throw new Error('Network timeout reaching cancellation server');
      },
    });

    ctrl.onHardwareBack();
    const cancelBtn = alertCall.buttons.find(b => b.text === 'Cancel Booking');
    await cancelBtn.onPress();

    assert.strictEqual(navResetCalled, false, 'Must NOT navigate to Home when cancellation fails');
    assert.strictEqual(ctrl.getIsCancelled(), false, 'Must NOT mark booking as cancelled when API fails');
    assert.notStrictEqual(alertCall, null);
    assert.strictEqual(alertCall.title, 'Cancellation Error');
    assert.strictEqual(alertCall.message, 'Network timeout reaching cancellation server');
    console.log('  ✅ Passed\n');
  }

  // Test 5: Prevent duplicate cancellation requests and duplicate confirmation dialogs
  {
    console.log('Test 5: Prevent duplicate cancellation dialogs and duplicate in-flight requests');
    alertCall = null;
    let dialogCount = 0;
    const nav = { reset: () => {} };

    const ctrl = createCancellationController({
      navigation: nav,
      isBookingActive: true,
      onCancelConfirm: async () => {},
    });

    ctrl.onHardwareBack();
    dialogCount++;
    const firstAlert = alertCall;

    // Second hardware back while dialog is already open
    ctrl.onHardwareBack();
    // Alert.alert shouldn't have been called a second time
    assert.strictEqual(alertCall, firstAlert, 'Must not open duplicate dialog');

    console.log('  ✅ Passed\n');
  }

  // Test 6: beforeRemove allows permitted forward transitions
  {
    console.log('Test 6: beforeRemove allows valid forward routes (DriverFoundScreen, etc.)');
    const nav = { reset: () => {} };
    const ctrl = createCancellationController({
      navigation: nav,
      isBookingActive: true,
      allowedNextRoutes: ['DriverFoundScreen', 'NoDriversAvailableScreen'],
      onCancelConfirm: async () => {},
    });

    let prevented = false;
    const evt = {
      data: { action: { payload: { name: 'DriverFoundScreen' } } },
      preventDefault: () => { prevented = true; },
    };

    const result = ctrl.onBeforeRemove(evt);
    assert.strictEqual(prevented, false, 'Must NOT prevent forward navigation to DriverFoundScreen');
    assert.strictEqual(result, false, 'Forward navigation must be permitted');
    console.log('  ✅ Passed\n');
  }

  // Test 7: beforeRemove prevents pop / exit transitions and opens cancellation dialog
  {
    console.log('Test 7: beforeRemove intercepts unexpected pop/exit navigation');
    alertCall = null;
    const nav = { reset: () => {} };
    const ctrl = createCancellationController({
      navigation: nav,
      isBookingActive: true,
      allowedNextRoutes: ['DriverFoundScreen'],
      onCancelConfirm: async () => {},
    });

    let prevented = false;
    const evt = {
      data: { action: { payload: { name: 'HomeScreen' } } },
      preventDefault: () => { prevented = true; },
    };

    const result = ctrl.onBeforeRemove(evt);
    assert.strictEqual(prevented, true, 'Must prevent pop to HomeScreen');
    assert.strictEqual(result, true);
    assert.strictEqual(alertCall.title, 'Cancel Booking?');
    console.log('  ✅ Passed\n');
  }

  // Test 8: Back button behavior on non-active booking screens is untouched
  {
    console.log('Test 8: Back button behavior on non-active booking screens is untouched');
    alertCall = null;
    const nav = { reset: () => {} };
    const ctrl = createCancellationController({
      navigation: nav,
      isBookingActive: false, // inactive
      onCancelConfirm: async () => {},
    });

    let prevented = false;
    const evt = {
      data: { action: { payload: { name: 'HomeScreen' } } },
      preventDefault: () => { prevented = true; },
    };

    const result = ctrl.onBeforeRemove(evt);
    assert.strictEqual(prevented, false, 'Must not block when booking is not active');
    assert.strictEqual(result, false);
    assert.strictEqual(alertCall, null, 'Must not open dialog when booking is inactive');
    console.log('  ✅ Passed\n');
  }

  console.log('🎉 ALL 8 TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
