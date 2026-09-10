import React from 'react';
import UnifiedLocationScreen, { type UnifiedLocationScreenProps } from './UnifiedLocationScreen';

/**
 * Re-exported wrapper for backwards compatibility with navigation.
 * All logic has been moved to UnifiedLocationScreen.
 */
const SelectLocationScreen: React.FC<UnifiedLocationScreenProps> = (props) => {
  // If not explicitly provided a mode, default to 'pickup' since this was the old pickup screen.
  const routeParams = props.route?.params ?? {};
  if (!routeParams.mode) {
    routeParams.mode = 'pickup';
  }
  
  return <UnifiedLocationScreen {...props} route={{ ...props.route, params: routeParams }} />;
};

export default SelectLocationScreen;
