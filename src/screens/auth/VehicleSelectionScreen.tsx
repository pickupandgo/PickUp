import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { vehicleCategories } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { useI18n } from '../../i18n';
import { saveSelectedVehicleId, getSelectedVehicleId } from '../../state/vehicle';

export interface VehicleSelectionScreenProps {
  readonly navigation: any;
  readonly route?: any;
  readonly onComplete?: (vehicleId: string, language: string) => void;
  readonly testID?: string;
}

export const VehicleSelectionScreen: React.FC<VehicleSelectionScreenProps> = ({
  navigation,
  route,
  onComplete,
  testID,
}) => {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    getSelectedVehicleId()
      .then((id) => {
        if (isMounted && id) {
          setSelectedId(id);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const categoryNameMap: Record<string, string> = {
    two_wheeler: t('vehicle.twoWheeler'),
    three_wheeler: t('vehicle.threeWheeler'),
    mini_truck: t('vehicle.miniTruck'),
    pickup: t('vehicle.pickup'),
    jcb: t('vehicle.jcb'),
    crane: t('vehicle.crane'),
  };

  const handleContinue = async () => {
    if (selectedId) {
      await saveSelectedVehicleId(selectedId);
      if (onComplete) {
        onComplete(selectedId, route?.params?.language || 'en');
      } else {
        navigation.goBack();
      }
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={t('vehicle.title')}
        onBackPress={() => navigation.goBack()}
        showBackButton
        showDivider
      />
      <View style={styles.container}>
        <Text style={styles.subtitle}>
          {t('vehicle.subtitle')}
        </Text>
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {vehicleCategories.map((item, index) => {
            const isSelected = item.id === selectedId;
            const categoryName = categoryNameMap[item.id] || item.name;
            const vehicleItem = item as { id: string; name: string; iconName: string; description: string; image?: any };
            return (
              <React.Fragment key={item.id}>
                {index > 0 && <View style={styles.separator} />}
                <Pressable
                  style={[styles.card, isSelected && styles.cardSelected]}
                  onPress={() => setSelectedId(item.id)}
                  accessibilityRole="radio"
                  accessibilityLabel={categoryName}
                  accessibilityState={{ selected: isSelected }}
                >
                  <View style={styles.iconContainer}>
                    {vehicleItem.image ? (
                      <Image
                        source={vehicleItem.image}
                        style={styles.vehicleImage}
                        resizeMode="contain"
                        fadeDuration={0}
                      />
                    ) : (
                      <Icon name={vehicleItem.iconName} style={styles.icon} />
                    )}
                  </View>
                  <View style={styles.cardContent}>
                    <Text style={[styles.cardTitle, isSelected && styles.cardTitleSelected]}>{categoryName}</Text>
                  </View>
                  <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                    {isSelected && <View style={styles.radioDot} />}
                  </View>
                </Pressable>
              </React.Fragment>
            );
          })}
        </ScrollView>
        <PrimaryButton
          label={t('vehicle.continue')}
          onPress={handleContinue}
          disabled={!selectedId}
          style={styles.continueButton}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.containerPadding,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  list: {
    paddingBottom: spacing.containerPadding,
  },
  separator: {
    height: spacing.gutter,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    gap: spacing.gutter,
    ...shadows.sm,
  },
  cardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.surfaceContainerLow,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: borderRadius.lg,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  vehicleImage: {
    width: 52,
    height: 52,
  },
  icon: {
    fontSize: 26,
    color: colors.onSurfaceVariant,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  cardTitle: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.onSurface,
  },
  cardTitleSelected: {
    color: colors.primary,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  continueButton: {
    marginBottom: spacing.lg,
    borderRadius: 100,
  },
});

export default VehicleSelectionScreen;

