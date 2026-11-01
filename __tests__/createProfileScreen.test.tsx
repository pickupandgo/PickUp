import React from 'react';
import { TextInput, Pressable, Text } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { getAuth } from '@react-native-firebase/auth';
import CreateProfileScreen from '../src/screens/profile/CreateProfileScreen';
import Button from '../src/components/atoms/Button';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from '../src/api/http';
const mockSave = jest.fn(async () => undefined);
const mockLogout = jest.fn(async () => undefined);
let mockProfile: any = null;
jest.mock('../src/state/SessionContext', () => ({ useSession: () => ({
  userProfile: mockProfile, markProfileDone: mockSave, logout: mockLogout,
}) }));
jest.mock('@react-native-firebase/auth', () => ({ getAuth: jest.fn() }));
let renderer: any;
const navigation = { reset: jest.fn(), navigate: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks(); mockProfile = null;
  (getAuth as jest.Mock).mockReturnValue({ currentUser: { uid: 'qa-google', displayName: 'Google name',
    email: 'google@example.com', phoneNumber: '+919876543210' } });
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
});
afterEach(() => { act(() => renderer?.unmount()); });
async function mount() { await act(async () => { renderer = TestRenderer.create(<CreateProfileScreen navigation={navigation} />); }); }
const press = (label: string): any => renderer.root.findAll((n: any) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const button = () => renderer.root.findByType(Button);
const field = (label: string) => renderer.root.findAllByType(TextInput).find((i: any) => i.props.accessibilityLabel === label)!;
async function fill() { await act(async () => {
  field('Full name').props.onChangeText('Chosen name'); field('Email address').props.onChangeText('chosen@example.com');
  field('Age').props.onChangeText('29'); field('Location / address').props.onChangeText('Jaipur');
}); }
it('prefills Google name/email but allows both to be edited', async () => {
  await mount(); expect(field('Full name').props.value).toBe('Google name');
  expect(field('Email address').props.value).toBe('google@example.com');
  expect(field('Full name').props.editable).toBe(true);
  await fill(); expect(field('Full name').props.value).toBe('Chosen name'); expect(field('Email address').props.value).toBe('chosen@example.com');
});
it('requires age and location even when Google supplies name/email', async () => {
  await mount(); expect(button().props.disabled).toBe(true);
  await act(async () => { field('Age').props.onChangeText('29'); }); expect(button().props.disabled).toBe(true);
  await act(async () => { field('Location / address').props.onChangeText('Jaipur'); }); expect(button().props.disabled).toBe(false);
});
it('submits required edited details without a second registration call or manual Home navigation', async () => {
  await mount(); await fill(); await act(async () => { await button().props.onPress(); });
  expect(mockSave).toHaveBeenCalledWith({ fullName: 'Chosen name', email: 'chosen@example.com', age: '29', address: 'Jaipur' });
  expect(navigation.navigate).not.toHaveBeenCalled();
});
it('keeps inputs and a scoped draft after a failed backend save', async () => {
  mockSave.mockRejectedValueOnce(new ApiError('http', 'missing', 404));
  await mount(); await fill(); await act(async () => { await button().props.onPress(); });
  expect(field('Full name').props.value).toBe('Chosen name');
  expect(renderer.root.findAllByType(Text).some((t: any) => String(t.props.children).includes('Profile saving is unavailable'))).toBe(true);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('pickup.profileDraft.qa-google.onboarding', expect.stringContaining('Chosen name'));
});
it('restores a failed-save draft without overwriting its edited name with Google', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(JSON.stringify({
    fullName: 'Draft chosen name', email: 'draft@example.com', age: '30', address: 'Delhi',
  }));
  await mount(); expect(field('Full name').props.value).toBe('Draft chosen name'); expect(button().props.disabled).toBe(false);
});
it('signs out through session state without resetting another navigator', async () => {
  await mount(); await act(async () => { await press('Sign out').props.onPress(); });
  expect(mockLogout).toHaveBeenCalledTimes(1); expect(navigation.reset).not.toHaveBeenCalled(); expect(mockSave).not.toHaveBeenCalled();
});
it('blocks invalid age, whitespace location and duplicate save taps', async () => {
  await mount(); await fill();
  await act(async () => { field('Age').props.onChangeText('121'); }); expect(button().props.disabled).toBe(true);
  await act(async () => { field('Age').props.onChangeText('29'); field('Location / address').props.onChangeText('  '); }); expect(button().props.disabled).toBe(true);
  await fill(); await act(async () => { await Promise.all([button().props.onPress(), button().props.onPress()]); });
  expect(mockSave).toHaveBeenCalledTimes(1);
});

