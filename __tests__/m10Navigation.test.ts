import {
  StackRouter,
  CommonActions,
  StackActions,
} from '@react-navigation/routers';
declare const require: any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const app: string = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');
const routeNames = (name: string) => {
  const text = app.slice(app.indexOf(`function ${name}(`));
  const block = text.slice(
    0,
    text.indexOf('function ', 10) < 0
      ? text.length
      : text.indexOf('function ', 10),
  );
  return Array.from(
    block.matchAll(/<Stack.Screen name="([^"]+)"/g),
    (m) => m[1],
  );
};
const options = (names: string[]) => ({
  routeNames: names,
  routeParamList: Object.fromEntries(names.map((name) => [name, undefined])),
  routeGetIdList: Object.fromEntries(names.map((name) => [name, undefined])),
});
it('bubbles shared chat/share targets out of booking stack and preserves booking identity on Back', () => {
  const rootNames = routeNames('MainNavigator');
  const bookingNames = routeNames('BookingStackNavigator');
  const root = StackRouter({ initialRouteName: 'MainTabs' });
  const child = StackRouter({ initialRouteName: bookingNames[0] });
  let state: any = root.getInitialState(options(rootNames));
  const booking = child.getInitialState(options(bookingNames));
  for (const target of ['ActiveTripChatScreen', 'ShareTrackingSheetScreen']) {
    const action = CommonActions.navigate(target, {
      paymentBookingId: 'booking-A',
      bookingId: 'booking-A',
    });
    expect(
      child.getStateForAction(booking, action, options(bookingNames)),
    ).toBeNull();
    const next: any = root.getStateForAction(state, action, options(rootNames));
    expect(next?.routes[next.index].name).toBe(target);
    expect(next?.routes[next.index].params).toMatchObject({
      bookingId: 'booking-A',
    });
    state = root.getStateForAction(
      next!,
      StackActions.pop(),
      options(rootNames),
    )!;
    expect(state.routes[state.index].name).toBe('MainTabs');
  }
});
it('keeps secondary trip pages on the server-backed projection and gallery development-only', () => {
  for (const name of [
    'MultiDropProgressScreen',
    'CurrentDropDetailsScreen',
    'FinalDeliverySummaryScreen',
    'DropCompletedStateScreen',
    'NextDropScreen',
  ]) {
    expect(app).toContain(`name="${name}" component={TripRouteDetailsScreen}`);
  }
  expect(app).toContain('{__DEV__ && <Stack.Screen name="Gallery"');
});
