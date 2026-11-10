import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, spacing, typography, borderRadius } from '../../theme';
import { SUPPORT_EMAIL, SUPPORT_PHONE_LABEL } from '../../config/support';
import { openSupportContact } from '../../services/supportContact';

export function SupportContactPanel() {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>How can we help?</Text>
      <Text style={styles.body}>
        Account review, documents, trips or payments.
      </Text>
      {(['call', 'email'] as const).map(channel => (
        <Pressable
          key={channel}
          style={styles.card}
          accessibilityRole="button"
          accessibilityLabel={
            channel === 'call' ? 'Call support' : 'Email support'
          }
          onPress={() => void openSupportContact(channel)}
        >
          <View style={styles.icon}>
            <Icon
              name={channel === 'call' ? 'call' : 'mail'}
              size={24}
              color={colors.primary}
            />
          </View>
          <View style={styles.copy}>
            <Text style={styles.label}>
              {channel === 'call' ? 'Call support' : 'Email support'}
            </Text>
            <Text selectable style={styles.body}>
              {channel === 'call' ? SUPPORT_PHONE_LABEL : SUPPORT_EMAIL}
            </Text>
          </View>
          <Icon name="arrow_outward" size={18} color={colors.primary} />
        </Pressable>
      ))}
      <Text style={styles.body}>
        Do not share OTPs, passwords or bank PINs. Support chat is not available
        yet.
      </Text>
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { gap: spacing.gutter },
  title: { ...typography.headlineMd, color: colors.onSurface },
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gutter,
    padding: spacing.containerPadding,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surfaceContainerLow,
  },
  icon: {
    padding: 10,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
  },
  copy: { flex: 1, gap: 4 },
  label: { ...typography.headlineSm, color: colors.onSurface },
});
