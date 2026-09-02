import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';

export interface NoDriversAvailableScreenProps {
  readonly onRetry?: () => void;
  readonly onReturnHome?: () => void;
  readonly onMenu?: () => void;
}

const NoDriversAvailableScreen: React.FC<NoDriversAvailableScreenProps & { navigation?: any }> = ({
  onRetry,
  onReturnHome,
  onMenu,
  navigation,
}) => {
  return (
    <View style={styles.container}>
      {/* Dimmed Map Background Mock */}
      <View style={styles.mapBackground} />
      <View style={styles.blurOverlay} />

      {/* Top App Bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable
              style={styles.iconButton}
              onPress={() => (onMenu ? onMenu() : navigation?.goBack())}
            >
              <Feather name="menu" size={24} color={colors.primary} />
            </Pressable>
            <Text style={styles.headerTitle}>Pick Up</Text>
          </View>
          <View style={styles.profileIconBox}>
            <Feather name="user" size={16} color={colors.onSurfaceVariant} />
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.mainContent}>
        {/* Error Card */}
        <View style={styles.cardContainer}>
          <View style={styles.errorCard}>
            <View style={styles.iconCircle}>
              <Feather name="search" size={40} color={colors.outline} />
            </View>
            
            <Text style={styles.title}>No drivers available at the moment</Text>
            <Text style={styles.subtitle}>
              High demand in your area. Please try again or wait a few minutes.
            </Text>

            <View style={styles.actionsContainer}>
              <Button
                label="Retry Search"
                onPress={() =>
                  onRetry ? onRetry() : navigation?.navigate('AssignmentFailedScreen')
                }
                variant="primary"
                fullWidth
              />
              <Button
                label="Return to Home"
                onPress={() =>
                  onReturnHome ? onReturnHome() : navigation?.navigate('HomeScreen')
                }
                variant="secondary"
                fullWidth
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
  },
  mapBackground: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceVariant, // Using surfaceVariant as a placeholder for grayscale map
  },
  blurOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface + 'CC', // 80% opacity
  },
  headerSafeArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: colors.surface + 'CC', // 80% opacity
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  profileIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  mainContent: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContainer: {
    width: '100%',
    maxWidth: 340,
    paddingHorizontal: spacing.marginMobile,
    zIndex: 10,
  },
  errorCard: {
    backgroundColor: colors.surface + 'F2', // 95% opacity
    borderRadius: borderRadius.lg,
    padding: spacing.xxl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    ...shadows.card,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.xxl,
    paddingHorizontal: spacing.xs,
  },
  actionsContainer: {
    width: '100%',
    gap: spacing.sm,
  },
});

export default NoDriversAvailableScreen;
