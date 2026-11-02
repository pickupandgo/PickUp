import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius } from '../../theme';

export interface NotificationCardProps {
  readonly title: string;
  readonly description: string;
  readonly timestamp: string;
  readonly iconName: string;
  readonly isRead: boolean;
  readonly category?: string;
  readonly reference?: string;
  readonly expanded?: boolean;
  readonly onPress?: () => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const NotificationCard: React.FC<NotificationCardProps> = ({
  title,
  description,
  timestamp,
  iconName,
  isRead,
  category,
  reference,
  expanded,
  onPress,
  style,
  testID,
}) => {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        !isRead && styles.unread,
        pressed && onPress ? styles.pressed : null,
        style,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${description}`}
      testID={testID}
    >
      <View style={[styles.iconContainer, !isRead && styles.iconUnread]}>
        <Icon name={iconName} size={20} color={colors.navigationIcon} />
      </View>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={[styles.title, !isRead && styles.titleUnread]}>{title}</Text>
        </View>
        {category ? <Text style={styles.timestamp}>{category}{!isRead ? ' · Unread' : ''}</Text> : null}
        <Text style={styles.description} numberOfLines={expanded ? undefined : 3}>{description}</Text>
        {reference ? <Text style={styles.timestamp}>{reference}</Text> : null}
        <Text style={styles.timestamp}>{timestamp}</Text>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: spacing.containerPadding,
    gap: spacing.gutter,
    borderRadius: borderRadius.md,
  },
  unread: {
    backgroundColor: colors.surfaceContainerLow,
  },
  pressed: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconUnread: {
    backgroundColor: colors.surfaceContainerLow,
  },
  icon: {
    fontSize: 20,
    color: colors.onSurfaceVariant,
  },
  content: {
    flex: 1,
    gap: spacing.unit,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    ...typography.bodyMd,
    color: colors.onSurface,
    flex: 1,
  },
  titleUnread: {
    fontWeight: '600',
  },
  timestamp: {
    ...typography.labelSm,
    color: colors.outline,
  },
  description: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
});

export default NotificationCard;
