import React, { useCallback, useMemo } from 'react';
import { View, Text, SectionList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { AppHeader } from '../../components/molecules/AppHeader';
import { SettingsRow } from '../../components/molecules/SettingsRow';
import { useAuth } from '../../hooks/useAuth';
import { useI18n } from '../../i18n';
import type { SettingsItem, SettingsSection } from '../../types/user';
import type { AccountScreenProps, AccountStackParamList } from '../../types/navigation';

import { Alert } from 'react-native';
import { floatingBubbleService } from '../../services/overlay/FloatingBubbleService';

export interface SettingsScreenProps {
  readonly navigation: AccountScreenProps<'Settings'>['navigation'];
  readonly testID?: string;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  navigation,
  testID,
}) => {
  const { logout } = useAuth();
  const { t, locale } = useI18n();
  const [bubbleEnabled, setBubbleEnabled] = React.useState(floatingBubbleService.isFeatureEnabled());

  React.useEffect(() => {
    return floatingBubbleService.subscribe((enabled) => {
      setBubbleEnabled(enabled);
    });
  }, []);
  
  const noParamRoutes = new Set<string>([
    'Profile', 'KYCDocuments', 'VehicleDocuments', 'VehicleStatus', 'VehicleSelection',
    'Settings', 'Subscription', 'SubscriptionProcessing', 'LanguageSelection', 'AccountRestricted',
  ]);

  const handlePress = useCallback(async (item: SettingsItem) => {
    if (item.id === 's9') {
      await logout();
      return;
    }
    if (item.id === 's_bubble') {
      if (bubbleEnabled) {
        await floatingBubbleService.setFeatureEnabled(false);
      } else {
        const canDraw = await floatingBubbleService.canDrawOverlays();
        if (!canDraw) {
          Alert.alert(
            t('settings.floatingBubbleTitle'),
            t('settings.floatingBubbleMsg'),
            [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('settings.openSettings'),
                onPress: () => {
                  floatingBubbleService.requestOverlayPermission().catch(() => {});
                },
              },
            ],
          );
        } else {
          await floatingBubbleService.setFeatureEnabled(true);
        }
      }
      return;
    }
    if (item.route && noParamRoutes.has(item.route)) {
      navigation.navigate(item.route as any);
    }
  }, [navigation, logout, bubbleEnabled, t]);

  const sections: { title: string; data: SettingsItem[] }[] = useMemo(() => [
    {
      title: t('settings.personal'),
      data: [
        { id: 's1', label: t('settings.profile'), iconName: 'person', hasChevron: true, route: 'Profile' },
        { id: 's2', label: t('settings.language'), value: locale === 'hi' ? 'हिन्दी' : 'English', iconName: 'language', hasChevron: true, route: 'LanguageSelection' },
      ],
    },
    {
      title: t('settings.vehicleService'),
      data: [
        { id: 's3', label: t('settings.vehicleDetails'), iconName: 'local_shipping', hasChevron: true, route: 'VehicleDocuments' },
        { id: 's3b', label: t('vehicle.changeVehicle'), iconName: 'tune', hasChevron: true, route: 'VehicleSelection' },
        { id: 's4', label: t('settings.kycDocuments'), iconName: 'description', hasChevron: true, route: 'KYCDocuments' },
      ],
    },
    {
      title: t('settings.preferences'),
      data: [
        { id: 's5', label: t('settings.notifications'), iconName: 'notifications', hasChevron: true },
        { id: 's6', label: t('settings.privacy'), iconName: 'lock', hasChevron: true },
        {
          id: 's_bubble',
          label: t('settings.floatingBubble'),
          value: bubbleEnabled ? t('common.enabled') : t('common.disabled'),
          iconName: 'bubble_chart',
          hasChevron: true,
        },
      ],
    },
    {
      title: t('settings.account'),
      data: [
        { id: 's7', label: t('settings.subscription'), iconName: 'card_membership', hasChevron: true, route: 'Subscription' },
        { id: 's8', label: t('settings.helpSupport'), iconName: 'help', hasChevron: true },
        { id: 's9', label: t('settings.logout'), iconName: 'logout', hasChevron: false },
      ],
    },
  ], [t, locale]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={t('settings.title')}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SettingsRow
            label={item.label}
            value={item.value}
            iconName={item.iconName}
            hasChevron={item.hasChevron}
            onPress={() => handlePress(item)}
          />
        )}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  listContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
  },
  sectionHeader: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: spacing.containerPadding,
    marginBottom: spacing.gutter,
  },
  separator: {
    height: 1,
    backgroundColor: colors.outlineVariant,
  },
});

export default SettingsScreen;
