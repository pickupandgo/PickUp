import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import BottomNavBar from '../../components/BottomNavBar';
import LocationInputRow from '../../components/molecules/LocationInputRow';
import { navigateToTab } from '../../navigation/tabRoutes';

export interface SearchUnavailableScreenProps {
  readonly onRetry?: () => void;
  readonly onManualEntry?: () => void;
}

const SearchUnavailableScreen: React.FC<SearchUnavailableScreenProps & { navigation?: any }> = ({
  onRetry,
  onManualEntry,
  navigation,
}) => {
  return (
    <View style={styles.container}>
      {/* Top App Bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.profileIconBox}>
              <MaterialIcons name="account-circle" size={24} color={colors.onSurfaceVariant} />
            </View>
          </View>
          <Text style={styles.headerTitle}>LogisticsPro</Text>
          <Pressable
            style={styles.iconButton}
            onPress={() => navigation?.navigate('NotificationCenterScreen')}
          >
            <Feather name="bell" size={20} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>
      </SafeAreaView>

      <View style={styles.mainContent}>
        {/* Background Mockup (Map and search inputs) */}
        <View style={styles.mapBackground} />
        
        <View style={styles.searchContainerMockup}>
          <View style={styles.searchCard}>
            <LocationInputRow
              label="Pickup"
              address="Current Location"
              dotColor={colors.statusGreen}
              showConnector
            />
            <LocationInputRow
              label="Drop-off"
              placeholder="Where to?"
              dotColor={colors.statusRed}
            />
          </View>
        </View>

        {/* Error Overlay Modal */}
        <View style={styles.errorOverlay}>
          <Pressable style={styles.scrimClickArea} onPress={() => navigation?.goBack()} />
          
          <SafeAreaView edges={['bottom']} style={styles.bottomSheetWrapper}>
            <View style={styles.bottomSheet}>
              
              <View style={styles.sheetContent}>
                <View style={styles.iconCircle}>
                  <Feather name="wifi-off" size={32} color={colors.onErrorContainer} />
                </View>

                <Text style={styles.title}>Search temporarily unavailable</Text>
                <Text style={styles.subtitle}>
                  We're having trouble connecting to the network. Please check your connection and try again.
                </Text>

                <View style={styles.actionsContainer}>
                  <Pressable
                    style={styles.primaryButton}
                    onPress={() => (onRetry ? onRetry() : navigation?.goBack())}
                  >
                    <Feather name="refresh-cw" size={18} color={colors.onPrimary} />
                    <Text style={styles.primaryButtonText}>Retry Connection</Text>
                  </Pressable>
                  
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() =>
                      onManualEntry ? onManualEntry() : navigation?.navigate('AddressSearchScreen')
                    }
                  >
                    <Text style={styles.secondaryButtonText}>Enter address manually</Text>
                  </Pressable>
                </View>

                <View style={styles.bottomHandle} />
              </View>

            </View>
          </SafeAreaView>
        </View>
      </View>

      <BottomNavBar
        currentTab="home"
        onTabPress={(tabId) => navigateToTab(navigation, tabId)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
  },
  headerSafeArea: {
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
  },
  profileIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainContent: {
    flex: 1,
    position: 'relative',
  },
  mapBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surfaceContainerLow,
  },
  searchContainerMockup: {
    width: '100%',
    padding: spacing.marginMobile,
    paddingTop: spacing.lg,
    zIndex: 10,
  },
  searchCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  
  errorOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface + '99', // 60% opacity
    justifyContent: 'flex-end',
    zIndex: 20,
  },
  scrimClickArea: {
    flex: 1,
  },
  bottomSheetWrapper: {
    width: '100%',
  },
  bottomSheet: {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 20,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  sheetContent: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  actionsContainer: {
    width: '100%',
    gap: spacing.sm,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    ...shadows.card,
  },
  primaryButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  secondaryButton: {
    height: 56,
    backgroundColor: colors.secondaryContainer,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.headlineSm.fontFamily,
  },
  bottomHandle: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant + '80',
    marginTop: spacing.md,
  },
});

export default SearchUnavailableScreen;
