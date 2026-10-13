import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing } from '../../theme';
import { formatRupees } from '../../services/payments/money';

export type TransactionRowType = 'credit' | 'debit';

export interface TransactionRowProps {
  readonly title: string;
  readonly description?: string;
  readonly amount: number;
  readonly currency: string;
  readonly type: TransactionRowType;
  readonly date: string;
  readonly iconName?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const TransactionRow: React.FC<TransactionRowProps> = ({
  title,
  description,
  amount,
  currency,
  type,
  date,
  iconName = 'receipt',
  style,
  testID,
}) => {
  const isCredit = type === 'credit';
  const prefix = isCredit ? '+' : '-';

  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      <View style={[styles.iconContainer, isCredit ? styles.iconCredit : styles.iconDebit]}>
        <Icon name={iconName} style={[styles.icon, isCredit ? styles.iconTextCredit : styles.iconTextDebit]} />
      </View>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {description ? (
          <Text style={styles.description} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
        <Text style={styles.date}>{date}</Text>
      </View>
      <Text style={[styles.amount, isCredit ? styles.amountCredit : styles.amountDebit]}>
        {prefix}{formatRupees(amount, currency)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.gutter,
    gap: spacing.gutter,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCredit: {
    backgroundColor: '#e8f5e9',
  },
  iconDebit: {
    backgroundColor: colors.errorContainer,
  },
  icon: {
    fontSize: 20,
  },
  iconTextCredit: {
    color: '#2e7d32',
  },
  iconTextDebit: {
    color: colors.error,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.onSurface,
  },
  description: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  date: {
    ...typography.labelSm,
    color: colors.outline,
  },
  amount: {
    ...typography.dataMono,
  },
  amountCredit: {
    color: '#2e7d32',
  },
  amountDebit: {
    color: colors.error,
  },
});

export default TransactionRow;
