import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';

interface BottomNavBarProps {
  readonly currentTab?: string;
  readonly onTabPress?: (tab: string) => void;
}

const tabs = [
  { id: 'home', label: 'Home', icon: 'home' as const },
  { id: 'trips', label: 'Trips', icon: 'map' as const },
  { id: 'activity', label: 'Activity', icon: 'clock' as const },
  { id: 'profile', label: 'Profile', icon: 'user' as const },
];

const BottomNavBar: React.FC<BottomNavBarProps> = ({ currentTab = 'home', onTabPress }) => {
  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;
        return (
          <Pressable
            key={tab.id}
            style={styles.tab}
            onPress={() => onTabPress?.(tab.id)}
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
