/* eslint-env jest */
// Jest setup file for mocking native modules unavailable in the test environment.

// react-native-config and @react-native-firebase/* ship ESM that Jest's default
// transformIgnorePatterns does not reach (the Firebase SDK pulls @firebase/* from a nested
// node_modules dir, which the top-level allowlist does not match). Mock them globally so any
// test that imports App.tsx or src/config/env.ts can start. Individual suites can override.
jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  getAuth: () => ({
    currentUser: null,
  }),
  getIdToken: jest.fn(async () => 'test-token'),
  // Named function exports AuthService.ts imports (the SDK's modular API).
  onAuthStateChanged: jest.fn(() => () => {}),
  signInWithPhoneNumber: jest.fn(async () => ({ confirm: jest.fn() })),
  signOut: jest.fn(async () => undefined),
  signInWithEmailAndPassword: jest.fn(async () => ({ user: { uid: 'test' } })),
  createUserWithEmailAndPassword: jest.fn(async () => ({
    user: { uid: 'test' },
  })),
  default: () => ({
    currentUser: null,
  }),
}));
jest.mock('@react-native-firebase/app', () => ({
  __esModule: true,
  getApp: () => ({ name: 'test', options: {} }),
  default: () => ({ name: 'test', options: {} }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
    multiGet: jest.fn(async () => []),
    multiSet: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  },
}));

// Mock the NativeLocationModule before anything imports it
jest.mock('./src/location/NativeLocationModule', () => ({
  NativeLocationModule: {
    getPermissionStatus: jest.fn().mockResolvedValue('granted'),
    hasBackgroundPermission: jest.fn().mockResolvedValue(true),
    isProviderEnabled: jest.fn().mockResolvedValue(true),
    getCurrentLocation: jest.fn().mockResolvedValue({
      latitude: 0,
      longitude: 0,
      accuracy: 10,
      timestamp: Date.now(),
    }),
    startTracking: jest.fn().mockResolvedValue(true),
    stopTracking: jest.fn().mockResolvedValue(true),
    isTracking: jest.fn().mockResolvedValue(false),
    startForegroundService: jest.fn().mockResolvedValue(true),
    stopForegroundService: jest.fn().mockResolvedValue(true),
    isForegroundServiceRunning: jest.fn().mockResolvedValue(false),
    addGeofence: jest.fn().mockResolvedValue(true),
    removeGeofence: jest.fn().mockResolvedValue(true),
  },
  LocationEventEmitter: {
    addListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
    removeAllListeners: jest.fn(),
    removeSubscription: jest.fn(),
    listenerCount: jest.fn().mockReturnValue(0),
  },
  LOCATION_EVENTS: {
    LOCATION_UPDATE: 'onLocationUpdate',
    LOCATION_ERROR: 'onLocationError',
    TRACKING_STATE_CHANGED: 'onTrackingStateChanged',
    GEOFENCE_EVENT: 'onGeofenceEvent',
    GEOFENCE_ERROR: 'onGeofenceError',
  },
}));

// Mock react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  const mockView = require('react-native').View;
  const mockScrollView = require('react-native').ScrollView;
  const mockTextInput = require('react-native').TextInput;
  const mockFlatList = require('react-native').FlatList;
  return {
    GestureHandlerRootView: mockView,
    Swipeable: mockView,
    DrawerLayout: mockView,
    State: {},
    ScrollView: mockScrollView,
    Slider: mockView,
    Switch: mockView,
    TextInput: mockTextInput,
    ToolbarAndroid: mockView,
    ViewPagerAndroid: mockView,
    DrawerLayoutAndroid: mockView,
    WebView: mockView,
    NativeViewGestureHandler: mockView,
    TapGestureHandler: mockView,
    FlingGestureHandler: mockView,
    ForceTouchGestureHandler: mockView,
    LongPressGestureHandler: mockView,
    PanGestureHandler: mockView,
    PinchGestureHandler: mockView,
    RotationGestureHandler: mockView,
    RawButton: mockView,
    BaseButton: mockView,
    RectButton: mockView,
    BorderlessButton: mockView,
    FlatList: mockFlatList,
    gestureHandlerRootHOC: component => component,
    Directions: {},
    Gesture: {
      Pan: () => ({
        onStart: () => ({}),
        onUpdate: () => ({}),
        onEnd: () => ({}),
      }),
      Tap: () => ({ onStart: () => ({}), onEnd: () => ({}) }),
    },
    GestureDetector: mockView,
  };
});

// Mock react-native-reanimated
jest.mock('react-native-reanimated', () => {
  const mockReanimated = require('react-native-reanimated/mock');
  mockReanimated.default.call = () => {};
  return mockReanimated;
});

// Mock react-native-safe-area-context with proper React context
jest.mock('react-native-safe-area-context', () => {
  const mockReact = require('react');
  const mockView = require('react-native').View;
  const mockInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  const mockFrame = { x: 0, y: 0, width: 393, height: 852 };
  const mockSafeAreaContext = mockReact.createContext({
    insets: mockInsets,
    frame: mockFrame,
  });

  return {
    SafeAreaProvider: ({ children }) =>
      mockReact.createElement(
        mockSafeAreaContext.Provider,
        { value: { insets: mockInsets, frame: mockFrame } },
        children,
      ),
    SafeAreaConsumer: ({ children }) =>
      mockReact.createElement(mockSafeAreaContext.Consumer, null, () =>
        children(mockInsets),
      ),
    SafeAreaInsetsContext: mockSafeAreaContext,
    SafeAreaFrameContext: mockReact.createContext(mockFrame),
    useSafeAreaInsets: () => mockInsets,
    useSafeAreaFrame: () => mockFrame,
    SafeAreaView: mockView,
    initialWindowMetrics: { insets: mockInsets, frame: mockFrame },
  };
});

// Mock react-native-screens
jest.mock('react-native-screens', () => {
  const mockView = require('react-native').View;
  return {
    enableScreens: jest.fn(),
    screensEnabled: jest.fn().mockReturnValue(true),
    Screen: mockView,
    ScreenContainer: mockView,
    ScreenStack: mockView,
    ScreenStackHeaderConfig: mockView,
    ScreenStackHeaderSubview: mockView,
    ScreenStackHeaderBackButtonImage: mockView,
    SearchBar: mockView,
    FullWindowOverlay: mockView,
    NativeScreen: mockView,
    NativeScreenContainer: mockView,
    NativeScreenNavigationContainer: mockView,
    useTransitionProgress: jest.fn().mockReturnValue({ progress: 1 }),
    isNewBackTitleImplementation: true,
  };
});

// Mock @react-navigation/native-stack internals
jest.mock('@react-navigation/native-stack', () => {
  const mockReact = require('react');
  const mockCreateNativeStackNavigator = () => {
    const mockStack = {
      Navigator: ({ children }) => children,
      Screen: () => null,
      Group: ({ children }) => children,
    };
    return mockStack;
  };
  return {
    createNativeStackNavigator: mockCreateNativeStackNavigator,
  };
});

// Mock react-native-maps
jest.mock('react-native-maps', () => {
  const mockReact = require('react');
  const mockView = require('react-native').View;
  const MockMapView = props => mockReact.createElement(mockView, props);
  MockMapView.Marker = mockView;
  MockMapView.Polyline = mockView;
  MockMapView.Callout = mockView;
  MockMapView.Circle = mockView;
  MockMapView.Polygon = mockView;
  MockMapView.Overlay = mockView;
  MockMapView.Animated = MockMapView;
  return {
    __esModule: true,
    default: MockMapView,
    Marker: mockView,
    Polyline: mockView,
    PROVIDER_GOOGLE: 'google',
  };
});

// Mock react-native-image-picker
jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));

// Mock react-native-razorpay: native Checkout is not available in tests.
jest.mock('react-native-razorpay', () => ({
  __esModule: true,
  default: {
    open: jest.fn(),
    onExternalWalletSelection: jest.fn(),
  },
}));
