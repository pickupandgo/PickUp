import React, { useState } from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Platform, StyleSheet, TextInput } from 'react-native';
import { OTPInput } from '../src/components/atoms/OTPInput';
import { colors } from '../src/theme';

let renderer: Renderer.ReactTestRenderer;
const changed = jest.fn();
const completed = jest.fn();
const focus = Array.from({ length: 6 }, () => jest.fn());

function Harness({ length = 6, hasError = false, disabled = false }) {
  const [value, setValue] = useState('');
  return (
    <OTPInput
      value={value}
      length={length}
      hasError={hasError}
      disabled={disabled}
      testID="otp"
      onChange={next => { changed(next); setValue(next); }}
      onComplete={completed}
    />
  );
}
const cells = () => renderer.root.findAllByType(TextInput);
const value = () => cells().map(cell => cell.props.value).join('');
const enter = async (text: string, index = 0) => {
  await act(() => cells()[index].props.onChangeText(text));
};

beforeEach(async () => {
  jest.clearAllMocks();
  await act(() => {
    renderer = Renderer.create(<Harness />);
  });
  cells().forEach((cell, index) => { cell.instance.focus = focus[index]; });
});
afterEach(async () => { await act(() => renderer.unmount()); });

test('all six empty borders start neutral, with only the focused border changing', async () => {
  expect(cells()).toHaveLength(6);
  expect(completed).not.toHaveBeenCalled();
  expect(cells().every(cell => StyleSheet.flatten(cell.props.style).borderColor === colors.onSurface)).toBe(true);
  await act(() => cells()[2].props.onFocus());
  expect(StyleSheet.flatten(cells()[2].props.style).borderColor).toBe(colors.primary);
  expect(StyleSheet.flatten(cells()[0].props.style).borderColor).toBe(colors.onSurface);
});

test.each([0, 1, 3, 5])('full paste at cell %i fills every cell in one update', async index => {
  await act(() => cells()[index].props.onFocus());
  // This is the native truncation regression: the field must receive all digits.
  expect(cells()[index].props.maxLength).toBeUndefined();
  await enter('483921', index);
  expect(cells().map(cell => cell.props.value)).toEqual(['4', '8', '3', '9', '2', '1']);
  expect(changed.mock.calls).toEqual([['483921']]);
  expect(completed.mock.calls).toEqual([['483921']]);
  expect(focus[5]).toHaveBeenCalled();
});

test.each([
  ['48 39 21', '483921'],
  ['483\n921', '483921'],
  ['a4b8-3.9x2!1', '483921'],
  ['483921765', '483921'],
  ['483', '483'],
  [' 4 8\n3 ', '483'],
])('sanitizes %p into %p', async (pasted, expected) => {
  await enter(pasted);
  expect(value()).toBe(expected);
  if (expected.length === 6) expect(completed).toHaveBeenCalledWith(expected);
  else expect(completed).not.toHaveBeenCalled();
});

test('partial paste focuses the next empty cell and can be completed manually', async () => {
  await enter('483');
  expect(focus[3]).toHaveBeenCalled();
  await enter('9', 3);
  await enter('2', 4);
  await enter('1', 5);
  expect(value()).toBe('483921');
  expect(completed).toHaveBeenCalledTimes(1);
});

test('overwrites an individual digit after paste', async () => {
  await enter('483921');
  await act(() => cells()[2].props.onFocus());
  await enter('7', 2);
  expect(value()).toBe('487921');
  expect(completed).toHaveBeenLastCalledWith('487921');
});

test.each([0, 2, 5])('deletes and reinserts digit %i without losing the suffix', async index => {
  await enter('483921');
  const removed = value()[index];
  await act(() => cells()[index].props.onFocus());
  await enter('', index);
  expect(value()).toHaveLength(5);
  await enter(removed, index);
  expect(value()).toBe('483921');
});

test('Backspace in an empty cell removes the previous digit and moves focus', async () => {
  await enter('483');
  await act(() => cells()[3].props.onKeyPress({ nativeEvent: { key: 'Backspace' } }));
  expect(value()).toBe('48');
  expect(focus[2]).toHaveBeenCalled();
  await enter('3', 2);
  expect(value()).toBe('483');
});

test('rapid events in the same React batch do not overwrite earlier digits', async () => {
  await act(() => {
    cells()[0].props.onChangeText('4');
    cells()[1].props.onChangeText('8');
    cells()[2].props.onChangeText('3');
  });
  expect(value()).toBe('483');
});

test('ignores nonnumeric input and allows replacement of a previously pasted code', async () => {
  await enter('483');
  await enter('abc', 3);
  expect(value()).toBe('483');
  await enter('654321', 3);
  expect(value()).toBe('654321');
});

test('keeps four-digit trip OTP consumers compatible', async () => {
  await act(() => renderer.update(<Harness length={4} />));
  await enter('123456');
  expect(cells()).toHaveLength(4);
  expect(value()).toBe('1234');
  expect(completed).toHaveBeenLastCalledWith('1234');
});

test('error styling overrides focus only when explicitly supplied', async () => {
  await act(() => renderer.update(<Harness hasError />));
  expect(cells().every(cell => StyleSheet.flatten(cell.props.style).borderColor === colors.error)).toBe(true);
  await act(() => renderer.update(<Harness />));
  expect(cells().every(cell => StyleSheet.flatten(cell.props.style).borderColor === colors.onSurface)).toBe(true);
});

test('configures platform OTP suggestions without SMS permissions or a one-character limit', () => {
  for (const cell of cells()) {
    expect(cell.props.keyboardType).toBe('number-pad');
    expect(cell.props.autoComplete).toBe(Platform.OS === 'android' ? 'sms-otp' : 'one-time-code');
    expect(cell.props.importantForAutofill).toBe('yes');
    expect(cell.props.maxLength).toBeUndefined();
    expect(cell.props.editable).toBe(true);
  }
});

