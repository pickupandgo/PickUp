import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, type AppStateStatus } from 'react-native';
import { TimerBadge } from '../src/components/atoms/TimerBadge';

let change: (state: AppStateStatus) => void;
let view: Renderer.ReactTestRenderer;
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date('2026-11-07T10:00:00Z'));
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => { change = callback; return { remove: jest.fn() }; });
});
afterEach(async () => { if (view) await act(async () => view.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

test('does not round a live offer down to expired before its exact deadline', async () => {
  const expired = jest.fn();
  await act(async () => { view = Renderer.create(<TimerBadge expiresAt={Date.now() + 2500} onExpired={expired} />); });
  await act(async () => jest.advanceTimersByTime(2499)); expect(expired).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTime(1)); expect(expired).toHaveBeenCalledTimes(1);
});

test('recalculates absolute deadline on foreground and expires only once', async () => {
  const expired = jest.fn();
  await act(async () => { view = Renderer.create(<TimerBadge expiresAt={Date.now() + 1000} onExpired={expired} />); });
  await act(async () => { change('background'); jest.advanceTimersByTime(10_000); });
  expect(expired).not.toHaveBeenCalled();
  await act(async () => { change('active'); change('active'); });
  expect(expired).toHaveBeenCalledTimes(1);
});

test('already-expired offers are processed immediately without a one-second grace window', async () => {
  const expired = jest.fn();
  await act(async () => { view = Renderer.create(<TimerBadge expiresAt={Date.now() - 1} onExpired={expired} />); });
  expect(expired).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(2000)); expect(expired).toHaveBeenCalledTimes(1);
});
