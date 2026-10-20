import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing } from '../../theme';
import { NotificationDot } from '../atoms/NotificationDot';
import { useI18n } from '../../i18n';

export interface AppHeaderProps {
  readonly title: string;
  readonly onBackPress?: () => void;
  readonly onTrailingPress?: () => void;
  readonly trailingIconName?: string;
  readonly showNotificationDot?: boolean;
  readonly showBackButton?: boolean;
  readonly showDivider?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  onBackPress,
  onTrailingPress,
  trailingIconName,
  showNotificationDot = false,
  showBackButton = true,
  showDivider = false,
  style,
  testID,
}) => {
  const { t } = useI18n();

  return (
    <View style={[styles.container, showDivider && styles.containerDivider, style]} testID={testID} accessibilityRole="header">
      <View style={styles.leadingContainer}>
        {showBackButton && onBackPress ? (
          <Pressable
            onPress={onBackPress}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Icon name="arrow_back" style={styles.icon} />
          </Pressable>
        ) : (
          <View style={styles.iconPlaceholder} />
        )}
      </View>

      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>

      <View style={styles.trailingContainer}>
        {trailingIconName && onTrailingPress ? (
          <Pressable
            onPress={onTrailingPress}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={trailingIconName}
          >
            <Icon name={trailingIconName} style={styles.icon} />
            <NotificationDot visible={showNotificationDot} />
          </Pressable>
        ) : (
          <View style={styles.iconPlaceholder} />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.gutter,
    backgroundColor: colors.surface,
  },
  containerDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  leadingContainer: {
    width: 40,
    alignItems: 'flex-start',
  },
  trailingContainer: {
    width: 40,
    alignItems: 'flex-end',
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPlaceholder: {
    width: 40,
    height: 40,
  },
  title: {
    ...typography.headlineSm,
    fontWeight: '700',
    color: colors.onSurface,
    flex: 1,
    textAlign: 'center',
  },
  icon: {
    fontSize: 24,
    color: colors.onSurface,
  },
});

export default AppHeader;

