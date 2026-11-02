/* eslint-env jest */
// Lifecycle tests control completion explicitly. Visual timing/performance is
// verified on Android; this mock does not claim to simulate the native renderer.
const React = require('react');
const { View, Image, Text, Easing } = require('react-native');
module.exports = {
  __esModule: true,
  default: { View, Image, Text },
  Easing,
  ReduceMotion: { Never: 'never', Always: 'always', System: 'system' },
  useSharedValue: initial => React.useRef({ value: initial }).current,
  useAnimatedStyle: callback => callback(),
  useReducedMotion: jest.fn(() => false),
  withTiming: jest.fn(value => value),
  cancelAnimation: jest.fn(),
  runOnJS: callback => callback,
};

