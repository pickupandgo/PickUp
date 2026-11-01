import { CommonActions } from '@react-navigation/native';
/** Reset at the owning Main navigator: booking and active-trip screens live in different stacks. */
export function resetBookingDestination(navigation: any, stack: 'BookingStack' | 'ActiveTripStack', screen: string, params?: object, keepSearch = false) {
  const root = navigation?.getParent?.();
  const screens = [...(keepSearch ? [{ name: 'FindingDriverScreen' }] : []), { name: screen, params }];
  if (root?.dispatch) root.dispatch(CommonActions.reset({ index: 1, routes: [{ name: 'MainTabs' }, { name: stack, state: { index: screens.length - 1, routes: screens } }] }));
  else if (navigation?.dispatch) navigation.dispatch(CommonActions.reset({ index: 1, routes: [{ name: 'MainTabs' }, { name: stack, state: { index: screens.length - 1, routes: screens } }] }));
  else navigation?.navigate(stack, { screen, params });
}
