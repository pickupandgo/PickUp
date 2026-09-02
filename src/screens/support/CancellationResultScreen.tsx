import React from 'react';
import {
  View,
  Text,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { MaterialIcons } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';

export interface CancellationResultScreenProps {
  readonly tripId?: string;
  readonly feeAmount?: string | null;
  readonly onHome?: () => void;
}

const CancellationResultScreen: React.FC<CancellationResultScreenProps & { navigation?: any }> = ({
  tripId = '#TRP-8472-X',
  feeAmount = '₹112.50',
  onHome,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {/* Cancel Icon */}
        <View style={styles.iconContainer}>
          <View style={styles.iconRingOuter} />
          <View style={styles.iconRingInner} />
          <View style={styles.iconBox}>
            <MaterialIcons name="cancel" size={40} color={colors.onSurfaceVariant} />
          </View>
        </View>

        {/* Text Content */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>Trip Cancelled</Text>
          <View style={styles.subtitleRow}>
            <Text style={styles.subtitleText}>Your trip </Text>
            <View style={styles.tripIdBadge}>
              <Text style={styles.tripIdText}>{tripId}</Text>
            </View>
            <Text style={styles.subtitleText}> has been cancelled.</Text>
          </View>

          {/* Fee Info Box */}
          {feeAmount && (
            <View style={styles.infoBox}>
              <MaterialIcons name="info" size={20} color={colors.onSurfaceVariant} style={styles.infoIcon} />
              <Text style={styles.infoText}>
                A cancellation fee of <Text style={styles.feeText}>{feeAmount}</Text> has been charged to your account.
              </Text>
            </View>
          )}
        </View>

        {/* Action */}
        <View style={styles.actionContainer}>
          <Button
            label="BACK TO HOME"
            onPress={() => (onHome ? onHome() : navigation?.navigate('HomeScreen'))}
            variant="primary"
            fullWidth
            size="lg"
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.marginMobile,
  },
  iconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 96,
    height: 96,
    marginBottom: spacing.xxl,
  },
  iconRingOuter: {
    position: 'absolute',
    width: 125, // approx scale 1.3
    height: 125,
    borderRadius: 62.5,
    borderWidth: 1,
    borderColor: colors.outlineVariant + '1A', // 10% opacity
  },
  iconRingInner: {
    position: 'absolute',
    width: 110, // approx scale 1.15
    height: 110,
    borderRadius: 55,
    borderWidth: 1,
    borderColor: colors.outlineVariant + '4D', // 30% opacity
  },
  iconBox: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceVariant + '80', // 50% opacity
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    alignItems: 'center',
    width: '100%',
    marginBottom: spacing.xxxl,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.md,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: spacing.xl,
  },
  subtitleText: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
  },
  tripIdBadge: {
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  tripIdText: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: typography.dataMono.letterSpacing,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    width: '100%',
  },
  infoIcon: {
    marginTop: 2,
    marginRight: spacing.sm,
  },
  infoText: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    lineHeight: 20,
  },
  feeText: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },
  actionContainer: {
    width: '100%',
    position: 'absolute',
    bottom: spacing.marginMobile,
  },
});

export default CancellationResultScreen;
