import React from 'react';
import UnifiedLocationScreen, { type UnifiedLocationScreenProps } from './UnifiedLocationScreen';

/**
 * Re-exported wrapper for backwards compatibility with navigation.
 * All logic has been moved to UnifiedLocationScreen.
 */
const SelectDropLocationScreen: React.FC<UnifiedLocationScreenProps> = (props) => {
  // If not explicitly provided a mode, default to 'drop' since this was the old drop screen.
  const routeParams = props.route?.params ?? {};
  if (!routeParams.mode) {
    routeParams.mode = 'drop';
  }
  
  return <UnifiedLocationScreen {...props} route={{ ...props.route, params: routeParams }} />;
};

export default SelectDropLocationScreen;
