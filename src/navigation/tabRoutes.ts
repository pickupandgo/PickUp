/**
 * Maps BottomNavBar tab ids to their destination route names.
 *
 * `BottomNavBar` emits tab ids ('home' | 'trips' | 'activity' | 'profile'),
 * while the root stack in App.tsx registers screens by their component name.
 * Screens that render BottomNavBar use `navigateToTab` so every tab bar in the
 * app resolves to the same destinations.
 */
export const TAB_ROUTES: Readonly<Record<string, string>> = {
  home: 'HomeScreen',
  trips: 'TripHistoryScreen',
  activity: 'NotificationCenterScreen',
  profile: 'ProfileScreen',
};

/**
 * Navigates to the screen backing a BottomNavBar tab.
 * No-op for unknown tab ids or when `navigation` is unavailable.
 */
export const navigateToTab = (navigation: any, tabId: string): void => {
  const route = TAB_ROUTES[tabId];
  if (route) {
    navigation?.navigate(route);
  }
};
