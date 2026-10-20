import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, typography } from '../theme';
import { useI18n } from '../i18n';

interface BottomNavBarProps {
  readonly currentTab?: string;
  readonly onTabPress?: (tab: string) => void;
}

const BottomNavBar: React.FC<BottomNavBarProps> = ({ currentTab = 'home', onTabPress }) => {
  const { t } = useI18n();

  const tabs = [
    { id: 'home', label: t('nav.home'), icon: 'home' as const },
    { id: 'trips', label: t('nav.trips'), icon: 'map' as const },
    { id: 'activity', label: t('nav.activity'), icon: 'clock' as const },
    { id: 'profile', label: t('nav.profile'), icon: 'user' as const },
  ];

  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;
        return (
          <Pressable
            key={tab.id}
            style={styles.tab}
            onPress={() => onTabPress?.(tab.id)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: isActive }}
          >
            <Feather
              name={tab.icon}
              size={22}
              color={isActive ? colors.primary : colors.onSurfaceVariant}
            />
            <Text
              style={[
                styles.label,
                { color: isActive ? colors.primary : colors.onSurfaceVariant },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  label: {
    ...typography.labelSm,
    fontSize: 10,
    marginTop: 2,
  },
});

export default BottomNavBar;
