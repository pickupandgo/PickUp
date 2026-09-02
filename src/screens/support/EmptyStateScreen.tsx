import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { Feather } from '@expo/vector-icons';

export interface EmptyStateScreenProps {
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
  
  // Empty State Content
  readonly iconName?: keyof typeof Feather.glyphMap;
  readonly title: string;
  readonly description: string;
  readonly buttonText?: string;
  readonly onButtonPress?: () => void;
  readonly isSecondaryButton?: boolean;
}

const EmptyStateScreen: React.FC<EmptyStateScreenProps & { navigation?: any }> = ({
  onBack,
  onHelp,
  iconName = 'inbox',
  title,
  description,
  buttonText,
  onButtonPress,
  isSecondaryButton = false,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top Navigation */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
        >
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Pick Up</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
        >
          <Feather name="help-circle" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <Feather name={iconName} size={32} color={colors.onSurfaceVariant} />
          </View>
          
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{description}</Text>

          {buttonText && onButtonPress && (
            <Pressable
              style={isSecondaryButton ? styles.secondaryButton : styles.primaryButton}
              onPress={() => onButtonPress()}
            >
              <Text
                style={isSecondaryButton ? styles.secondaryButtonText : styles.primaryButtonText}
              >
                {buttonText}
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface + 'CC', // 80% opacity
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    minHeight: 320,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
    marginBottom: 32,
    maxWidth: 280,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    borderRadius: borderRadius.full,
  },
  primaryButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.labelSm.fontFamily,
  },
  secondaryButton: {
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    borderRadius: borderRadius.full,
  },
  secondaryButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default EmptyStateScreen;
