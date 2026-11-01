import React from 'react';
import ReviewBookingScreen from '../booking/ReviewBookingScreen';
/** Recovery/deep-link entry only. Shares the exact review finding state, not a second search UI. */
export default function FindingDriverScreen({ navigation, route }: { navigation?: any; route?: any }) {
  return <ReviewBookingScreen navigation={navigation} route={{ ...route, params: { ...route?.params, searchMode: true } }} />;
}
