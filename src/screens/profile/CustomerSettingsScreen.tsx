import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';

export interface CustomerSettingsScreenProps {
  readonly onBack?: () => void;
  readonly onLogout?: () => void;
}

interface SettingsItem {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  /** Destination route name, or undefined for informational rows. */
  readonly route?: string;
  readonly value?: string;
}

const SETTINGS_ITEMS: readonly SettingsItem[] = [
  { id: 'profile', title: 'Profile', icon: 'user', route: 'EditProfileScreen' },
  { id: 'addresses', title: 'Saved Addresses', icon: 'map-pin', route: 'SavedAddressesScreen' },
  { id: 'notifications', title: 'Notifications', icon: 'bell', route: 'NotificationCenterScreen' },
  { id: 'history', title: 'Booking History', icon: 'clock', route: 'TripHistoryScreen' },
  { id: 'language', title: 'Language', icon: 'globe', value: 'English' },
  { id: 'account', title: 'Account', icon: 'settings', route: 'ProfileScreen' },
];

const CustomerSettingsScreen: React.FC<CustomerSettingsScreenProps & { navigation?: any }> = ({
  onBack,
  onLogout,
  navigation,
}) => {

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={() => (onBack ? onBack() : navigation?.goBack())}>
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        {/* Spacer keeps the title centred */}
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Settings List */}
        <View style={styles.settingsList}>
          {SETTINGS_ITEMS.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === SETTINGS_ITEMS.length - 1;
            const rowStyle = [
              styles.settingRow,
              isFirst && styles.settingRowFirst,
              isLast && styles.settingRowLast,
            ];
            const rowContent = (
              <>
                <View style={styles.rowLeft}>
                  <Feather name={item.icon as any} size={24} color={colors.onSurfaceVariant} />
                  <Text style={styles.rowTitle}>{item.title}</Text>
                </View>
                
                <View style={styles.rowRight}>
                  {item.value && (
                    <Text style={styles.rowValue}>{item.value}</Text>
                  )}
                  <Feather name="chevron-right" size={24} color={colors.outlineVariant} />
                </View>
              </>
            );

            // Rows without a destination render as plain views, never as dead buttons.
            if (!item.route) {
              return (
                <View key={item.id} style={rowStyle}>
                  {rowContent}
                </View>
              );
            }

            return (
              <Pressable
                key={item.id}
                style={rowStyle}
                onPress={() => navigation?.navigate(item.route)}
              >
                {rowContent}
              </Pressable>
            );
          })}
        </View>

        {/* Destructive Action Section */}
        <View style={styles.logoutContainer}>
          <Pressable
            style={styles.logoutButton}
            onPress={() => (onLogout ? onLogout() : navigation?.navigate('LogoutConfirmationScreen'))}
          >
            <MaterialIcons name="logout" size={24} color={colors.error} />
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.lg,
  },
  
  // Settings List
  settingsList: {
    flexDirection: 'column',
    gap: 8,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.md,
  },
  settingRowFirst: {
    borderTopLeftRadius: borderRadius.md,
    borderTopRightRadius: borderRadius.md,
  },
  settingRowLast: {
    borderBottomLeftRadius: borderRadius.md,
    borderBottomRightRadius: borderRadius.md,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowTitle: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowValue: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Logout
  logoutContainer: {
    marginTop: spacing.xl,
    marginBottom: spacing.xl * 2,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.errorContainer + '33', // 20% opacity
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.full,
  },
  logoutText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.error,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default CustomerSettingsScreen;
