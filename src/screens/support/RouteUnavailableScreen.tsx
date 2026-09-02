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
import Button from '../../components/atoms/Button';
import { navigateToTab } from '../../navigation/tabRoutes';

export interface RouteUnavailableScreenProps {
  readonly onRetry?: () => void;
  readonly onChangeLocation?: () => void;
}

const RouteUnavailableScreen: React.FC<RouteUnavailableScreenProps & { navigation?: any }> = ({
  onRetry,
  onChangeLocation,
  navigation,
}) => {
  return (
    <View style={styles.container}>
      {/* Top App Bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.profileIconBox}>
              <Feather name="user" size={16} color={colors.onSurfaceVariant} />
            </View>
            <Text style={styles.headerTitle}>Pick Up</Text>
          </View>
          <Pressable
            style={styles.iconButton}
            onPress={() => navigation?.navigate('NotificationCenterScreen')}
          >
            <Feather name="bell" size={20} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>
      </SafeAreaView>

      <View style={styles.mainContent}>
        {/* Blurred Map Background Mock */}
        <View style={styles.mapBackground} />
        
        {/* Overlay to ensure text legibility */}
        <View style={styles.blurOverlay} />

        {/* Error Card */}
        <View style={styles.cardContainer}>
          <View style={styles.errorCard}>
            <View style={styles.iconCircle}>
              <Feather name="map" size={32} color={colors.onErrorContainer} />
            </View>
            
            <Text style={styles.title}>Route unavailable</Text>
            <Text style={styles.subtitle}>
              We couldn't calculate a valid route for the selected locations. Please verify the addresses or try again later.
            </Text>

            <View style={styles.actionsContainer}>
              <Button
                label="Retry"
                onPress={() =>
                  onRetry ? onRetry() : navigation?.navigate('MultiDropProgressScreen')
                }
                variant="primary"
                fullWidth
              />
              <Pressable
                style={styles.secondaryButton}
                onPress={() =>
                  onChangeLocation
                    ? onChangeLocation()
                    : navigation?.navigate('SelectDropLocationScreen')
                }
              >
                <Text style={styles.secondaryButtonText}>Change location</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      <BottomNavBar
        currentTab="trips"
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
    backgroundColor: colors.surfaceContainerLow,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapBackground: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceContainerLow,
  },
  blurOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceContainerLowest + '66', // 40% opacity
  },
  cardContainer: {
    width: '100%',
    maxWidth: 400,
    paddingHorizontal: spacing.marginMobile,
    zIndex: 10,
  },
  errorCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadows.card,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.xl,
    maxWidth: 280,
  },
  actionsContainer: {
    width: '100%',
    gap: spacing.sm,
  },
  secondaryButton: {
    height: 48,
    backgroundColor: colors.secondaryContainer,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default RouteUnavailableScreen;
