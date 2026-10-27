/* eslint-env jest */
/* global globalThis */
// Jest setup: stub the native modules that are unavailable in the test environment, and the
// ESM-only packages Jest cannot transform. Individual tests may override these mocks.

// Lets react-test-renderer's act() work under the node test environment.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__DEV__ = true;
require('react-native/jest/setup');

// react-native-config ships an ESM entry; the app reads env through it.
jest.mock('react-native-config', () => ({ __esModule: true, default: {} }));

// Firebase native modules. Tests that exercise auth/identity override currentUser.
jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  getAuth: () => ({ currentUser: null }),
  getIdToken: jest.fn(async () => 'test-token'),
  onAuthStateChanged: jest.fn(() => () => {}),
  default: () => ({ currentUser: null }),
}));
jest.mock('@react-native-google-signin/google-signin', () => ({
  __esModule: true,
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn().mockResolvedValue({ data: { idToken: 'google-token' } }),
    signOut: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  },
}));

jest.mock('@invertase/react-native-apple-authentication', () => ({
  __esModule: true,
  appleAuth: {
    isSupported: false,
    performRequest: jest.fn(),
  },
}));


jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

// Native UI / device modules used by screens.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children, style }) => React.createElement('View', { style }, children),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
  };
});
jest.mock('@react-navigation/native', () => {
  const React = require('react');
  return {
    useFocusEffect: (effect) => {
      React.useEffect(() => {
        return effect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
      dispatch: jest.fn(),
      reset: jest.fn(),
    }),
    useRoute: () => ({
      params: {},
    }),
    CommonActions: {
      reset: (action) => ({ type: 'RESET', payload: action }),
      navigate: jest.fn(),
      goBack: jest.fn(),
    },
  };
});
jest.mock('react-native-vector-icons/Feather', () => 'Feather');
jest.mock('react-native-vector-icons/MaterialIcons', () => 'MaterialIcons');
jest.mock('@react-native-community/geolocation', () => ({
  getCurrentPosition: jest.fn(),
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
  setRNConfiguration: jest.fn(),
}));
jest.mock('react-native-maps', () => {
  const React = require('react');
  const MockMap = (props) => React.createElement('MapView', props, props.children);
  MockMap.Marker = 'Marker';
  MockMap.Polyline = 'Polyline';
  return { __esModule: true, default: MockMap, Marker: 'Marker', Polyline: 'Polyline', PROVIDER_GOOGLE: 'google' };
});

try {
  const rn = require('react-native');
  Object.defineProperty(rn, 'Image', {
    configurable: true,
    enumerable: true,
    value: 'Image',
    writable: true,
  });
} catch {
  // Non-fatal
}

const mockPermissions = {
  request: jest.fn(async () => 'granted'),
  check: jest.fn(async () => true),
  PERMISSIONS: {
    ACCESS_FINE_LOCATION: 'android.permission.ACCESS_FINE_LOCATION',
  },
  RESULTS: {
    GRANTED: 'granted',
    DENIED: 'denied',
    NEVER_ASK_AGAIN: 'never_ask_again',
  },
};

jest.mock('react-native/Libraries/PermissionsAndroid/PermissionsAndroid', () => ({
  __esModule: true,
  default: mockPermissions,
  ...mockPermissions,
}));

jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  __esModule: true,
  default: {
    OS: 'android',
    select: (objs) => objs.android ?? objs.default,
  },
  OS: 'android',
  select: (objs) => objs.android ?? objs.default,
}));
