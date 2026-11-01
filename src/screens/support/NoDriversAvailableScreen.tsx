import React from 'react';
import FindingDriverScreen from '../tracking/FindingDriverScreen';
/** Legacy recovery entry; server state is rechecked before showing the shared in-place result. */
export default function NoDriversAvailableScreen({ navigation, route }: { navigation?: any; route?: any }) {
  return <FindingDriverScreen navigation={navigation} route={route} />;
}
