import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings, mockActiveTrip } from '../../data/mockData';
import Card from '../../components/molecules/Card';
import ListRow from '../../components/molecules/ListRow';
import Divider from '../../components/atoms/Divider';
import Button from '../../components/atoms/Button';

export interface TripCompletedScreenProps {
  readonly onDone?: () => void;
  readonly onWriteReview?: () => void;
}

const TripCompletedScreen: React.FC<TripCompletedScreenProps & { navigation?: any }> = ({
  onDone,
  onWriteReview,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Success Icon */}
        <View style={styles.heroSection}>
          <View style={styles.successCircle}>
            <Text style={styles.successIcon}>✓</Text>
          </View>
          <Text style={styles.title}>{strings.trip.completed}</Text>
          <Text style={styles.subtitle}>
            Your delivery has been completed successfully
          </Text>
        </View>

        {/* Trip Summary Card */}
        <Card variant="outlined" padding="none">
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryTitle}>{strings.trip.summary}</Text>
            <Text style={styles.tripId}>{mockActiveTrip.id}</Text>
          </View>
          <Divider />
          <ListRow
            title="Distance"
            trailing={
              <Text style={styles.valueText}>{mockActiveTrip.distance}</Text>
            }
          />
          <Divider />
          <ListRow
            title="Vehicle"
            trailing={
              <Text style={styles.valueText}>{mockActiveTrip.vehicleType}</Text>
            }
          />
          <Divider />
          <ListRow
            title="Driver"
            trailing={
              <Text style={styles.valueText}>{mockActiveTrip.driverName}</Text>
            }
          />
          <Divider />
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Total Fare</Text>
            <Text style={styles.fareAmount}>{mockActiveTrip.fare}</Text>
          </View>
        </Card>

        {/* Route Summary */}
        <Card variant="filled" padding="md">
          {mockActiveTrip.stops.map((stop, i) => (
            <View key={`stop-${i}`} style={styles.stopRow}>
              <View
                style={[
                  styles.stopDot,
                  i === 0
                    ? styles.pickupDot
                    : styles.dropDot,
                ]}
              />
              <View style={styles.stopInfo}>
                <Text style={styles.stopLabel}>{stop.label}</Text>
                <Text style={styles.stopAddress}>{stop.address}</Text>
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <Button
          label="Write a Review"
          onPress={() =>
            onWriteReview ? onWriteReview() : navigation?.navigate('DriverRatingScreen')
          }
          variant="outline"
          size="lg"
          fullWidth
        />
        <Button
          label="Done"
          onPress={() => {
            onDone?.();
            navigation?.navigate('TripCompletedSummaryScreen');
          }}
          variant="primary"
          size="lg"
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    gap: spacing.stackGapMd,
    paddingBottom: spacing.xxxl,
  },

  // Hero
  heroSection: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
    gap: spacing.md,
  },
  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.statusGreen,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  successIcon: {
    fontSize: 36,
    color: colors.white,
    fontWeight: '700',
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
  },

  // Summary
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  summaryTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  tripId: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  valueText: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  fareLabel: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  fareAmount: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },

  // Stops
  stopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  pickupDot: {
    backgroundColor: colors.statusGreen,
  },
  dropDot: {
    backgroundColor: colors.primary,
  },
  stopInfo: {
    flex: 1,
    gap: 2,
  },
  stopLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  stopAddress: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Footer
  footer: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
});

export default TripCompletedScreen;
