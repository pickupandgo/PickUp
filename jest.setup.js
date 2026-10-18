/* eslint-env jest */
/* global globalThis */
// Jest setup: stub the native modules that are unavailable in the test environment, and the
// ESM-only packages Jest cannot transform. Individual tests may override these mocks.

// Lets react-test-renderer's act() work under the node test environment.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  },
}));

// Native UI / device modules used by screens.
jest.mock('react-native-vector-icons/Feather', () => 'Feather');
jest.mock('react-native-vector-icons/MaterialIcons', () => 'MaterialIcons');
jest.mock('@react-native-community/geolocation', () => ({
  getCurrentPosition: jest.fn(),
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
}));
jest.mock('react-native-maps', () => {
  const React = require('react');
  const MockMap = (props) => React.createElement('MapView', props, props.children);
  MockMap.Marker = 'Marker';
  MockMap.Polyline = 'Polyline';
  return { __esModule: true, default: MockMap, Marker: 'Marker', Polyline: 'Polyline', PROVIDER_GOOGLE: 'google' };
});
