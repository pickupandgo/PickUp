import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { VehicleStatusScreen } from '../src/screens/account/VehicleStatusScreen';
import { DriverOnboardingService } from '../src/services/onboarding/DriverOnboardingService';

jest.mock('../src/components/atoms/Icon', () => 'Icon');
const mockRefresh = jest.fn(async () => {});
jest.mock('../src/hooks/useDriverOnboarding', () => ({ useDriverOnboarding: () => ({
  summary: { vehicles: [], activeVehicle: null, requiredDocuments: { vehicle: [] } },
  loading: false, error: null, refresh: mockRefresh,
}) }));
test('no-registration action provides a form using the existing createVehicle contract', async () => {
  const api = DriverOnboardingService.getInstance();
  const create = jest.spyOn(api, 'createVehicle').mockResolvedValue({} as Awaited<ReturnType<typeof api.createVehicle>>);
  const replace = jest.spyOn(api, 'requestReplacement');
  let view!: Renderer.ReactTestRenderer;
  await act(() => { view = Renderer.create(<VehicleStatusScreen navigation={{ goBack: jest.fn() } as unknown as React.ComponentProps<typeof VehicleStatusScreen>['navigation']} />); });
  const save = () => view.root.findAll(node => node.props.label === 'Save vehicle registration')[0];
  expect(save().props.disabled).toBe(true);
  await act(() => {
    view.root.findAllByType(TextInput).find(node => node.props.placeholder === 'Registration number')!.props.onChangeText('RJ19AB5678');
    view.root.findAllByType(TextInput).find(node => node.props.placeholder === 'Make and model')!.props.onChangeText('Actual model');
  });
  expect(save().props.disabled).toBe(false);
  await act(async () => save().props.onPress());
  expect(create).toHaveBeenCalledWith({ category: 'TWO_WHEELER', registrationNumber: 'RJ19AB5678', makeModel: 'Actual model' });
  expect(mockRefresh).toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  await act(() => view.unmount());
  jest.restoreAllMocks();
}, 30_000);
