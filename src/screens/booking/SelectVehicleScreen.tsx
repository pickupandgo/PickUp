import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings, mockVehicleTypes } from '../../data/mockData';
import { useBooking } from '../../state/BookingContext';
import { getFareEstimate } from '../../api/engine';
import { Feather } from '@expo/vector-icons';
import TopAppBar from '../../components/organisms/TopAppBar';
import VehicleOptionCard from '../../components/molecules/VehicleOptionCard';

export interface SelectVehicleScreenProps {
  readonly onBack?: () => void;
  readonly onContinue?: (vehicleId: string) => void;
  readonly onHelp?: () => void;
}

const SelectVehicleScreen: React.FC<SelectVehicleScreenProps & { navigation?: any }> = ({
  onBack,
  onContinue,
  onHelp,
  navigation,
}) => {
  const { draft, primaryDrop, setVehicleType } = useBooking();
  const [selectedId, setSelectedId] = useState<string>('mini-truck');
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (draft.pickup && primaryDrop) {
      setIsLoading(true);
      getFareEstimate(draft.pickup, primaryDrop, 10)
        .then((res) => {
          setDistanceKm(res.distanceKm);
          setIsLoading(false);
        })
        .catch(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
  }, [draft.pickup, primaryDrop]);

  const selectedVehicle = mockVehicleTypes.find((v) => v.id === selectedId);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <TopAppBar
        title={strings.booking.selectVehicle}
        leadingIcon={<Text style={styles.backIcon}>←</Text>}
        onLeadingPress={() => (onBack ? onBack() : navigation?.goBack())}
        trailingIcon={<Text style={styles.helpText}>Help</Text>}
        onTrailingPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Route Summary Card */}
        <View style={styles.routeSummaryCard}>
          <View style={styles.routeRow}>
            <View style={styles.routeTimeline}>
              <View style={styles.dotGreen} />
              <View style={styles.timelineLine} />
            </View>
            <View style={styles.routeItem}>
              <Text style={styles.routeItemTitle}>
                {draft.senderName || 'Sender'} · {draft.senderPhone || 'No Number'}
              </Text>
              <Text style={styles.routeItemAddress} numberOfLines={1}>
                {draft.pickup?.address || 'Pickup Location'}
              </Text>
            </View>
          </View>
          
          {draft.drops.map((drop, index) => {
             const isLast = index === draft.drops.length - 1;
             return (
               <View key={`drop-${index}`} style={styles.routeRow}>
                 <View style={styles.routeTimeline}>
                   <View style={styles.dotRed} />
                   {!isLast && <View style={styles.timelineLine} />}
                 </View>
                 <View style={styles.routeItem}>
                   <Text style={styles.routeItemTitle}>
                     {drop.receiverName || 'Receiver'} · {drop.receiverPhone || 'No Number'}
                   </Text>
                   <Text style={styles.routeItemAddress} numberOfLines={1}>
                     {drop.address || 'Drop Location'}
                   </Text>
                 </View>
               </View>
             );
          })}

          <View style={styles.routeActions}>
            <Pressable style={styles.routeActionBtn} onPress={() => navigation?.navigate('SelectDropLocationScreen', { mode: 'stop' })}>
              <Feather name="plus-circle" size={16} color={colors.primary} />
              <Text style={styles.routeActionText}>Add Stop</Text>
            </Pressable>
            <View style={styles.routeActionDivider} />
            <Pressable style={styles.routeActionBtn} onPress={() => navigation?.navigate('SelectLocationScreen', { mode: 'edit' })}>
              <Feather name="edit-2" size={16} color={colors.primary} />
              <Text style={styles.routeActionText}>Edit Locations</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.subtitleContainer}>
          <Text style={styles.subtitle}>
            Choose the right vehicle for your load.
          </Text>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: spacing.xxl }} />
        ) : (
          <View style={styles.vehicleList}>
            {mockVehicleTypes.map((vehicle) => {
              const displayPrice = vehicle.baseFare === 0 
                ? vehicle.estimatedPrice
                : distanceKm 
                  ? `₹${Math.round(vehicle.baseFare + (distanceKm * vehicle.perKmCharge))}`
                  : `₹${parseInt(vehicle.estimatedPrice.replace(/[^0-9]/g, ''), 10) || vehicle.baseFare}`;

              return (
                <VehicleOptionCard
                  key={vehicle.id}
                  name={vehicle.name}
                  description={vehicle.description}
                  capacity={vehicle.capacity}
                  estimatedPrice={displayPrice}
                  eta={vehicle.eta}
                  image={vehicle.image}
                  selected={selectedId === vehicle.id}
                  onPress={() => setSelectedId(vehicle.id)}
                />
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Bottom CTA */}
      <View style={styles.footer}>
        <Pressable
          style={styles.footerContent}
          onPress={() => {
            setVehicleType(selectedVehicle?.name ?? selectedId);
            onContinue?.(selectedId);
            navigation?.navigate('GoodsDetailsScreen');
          }}
        >
          <Text style={styles.ctaLabel}>Proceed With {selectedVehicle?.name?.split(' /')[0] ?? 'Vehicle'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
  },
  backIcon: {
    fontSize: 22,
    color: colors.onSurface,
  },
  helpText: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingBottom: spacing.xxl,
  },
  routeSummaryCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    ...shadows.sm,
  },
  routeRow: {
    flexDirection: 'row',
  },
  routeTimeline: {
    width: 24,
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  dotGreen: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.statusGreen,
    marginTop: 16,
  },
  dotRed: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.statusRed,
    marginTop: 16,
  },
  timelineLine: {
    width: 1,
    flex: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: 4,
    borderStyle: 'dashed',
    minHeight: 24,
  },
  routeItem: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  routeItemTitle: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  routeItemAddress: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
    fontWeight: '500',
    marginTop: 2,
  },
  routeActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  routeActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  routeActionText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
    fontWeight: '600',
  },
  routeActionDivider: {
    width: 1,
    backgroundColor: colors.outlineHairline,
  },
  subtitleContainer: {
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  subtitle: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
  },
  vehicleList: {
    gap: spacing.md,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
  },
  footerContent: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  ctaLabel: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  priceText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  arrowIcon: {
    fontSize: 18,
    color: colors.onPrimary,
  },
});

export default SelectVehicleScreen;
