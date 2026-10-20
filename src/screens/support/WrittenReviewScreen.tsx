import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommonActions } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import BottomNavBar from '../../components/BottomNavBar';
import { navigateToTab } from '../../navigation/tabRoutes';
import { useBooking } from '../../state/BookingContext';
import { useI18n } from '../../i18n';

export interface WrittenReviewScreenProps {
  readonly onBack?: () => void;
  readonly onSkip?: () => void;
  readonly onSubmit?: (text: string) => void;
  readonly onAddPhoto?: () => void;
  readonly onAddLocation?: () => void;
  // bottom nav props
  readonly currentTab?: string;
  readonly onTabPress?: (tabId: string) => void;
}

const SUGGESTED_TOPIC_KEYS = [
  'feedback.topicCleanliness',
  'feedback.topicDriving',
  'feedback.topicNavigation',
  'feedback.topicProfessionalism',
];

const MAX_CHARS = 500;

const WrittenReviewScreen: React.FC<WrittenReviewScreenProps & { navigation?: any }> = ({
  onBack,
  onSkip,
  onSubmit,
  onAddPhoto,
  onAddLocation,
  currentTab = 'profile', // Feedback/Review is somewhat related to profile/history
  onTabPress,
  navigation,
}) => {
  const { clearActiveRide } = useBooking();
  const { t } = useI18n();
  const [reviewText, setReviewText] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const charCount = reviewText.length;
  const isOverLimit = charCount > MAX_CHARS; // Input won't allow this if maxLength is set, but good practice
  const isSubmitDisabled = charCount === 0 || isOverLimit;

  const handleTopicPress = (topic: string) => {
    // Append topic to text
    const newText = reviewText.length > 0 ? `${reviewText} ${topic}` : topic;
    setReviewText(newText.slice(0, MAX_CHARS));
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Top App Bar */}
        <View style={styles.header}>
          <Pressable
            style={styles.iconButton}
            onPress={() => (onBack ? onBack() : navigation?.goBack())}
            accessibilityRole="button"
            accessibilityLabel={t('common.goBack')}
          >
            <Feather name="arrow-left" size={24} color={colors.onSurfaceVariant} />
          </Pressable>
          <Text style={styles.headerTitle}>{t('trip.writeReview')}</Text>
          <Pressable
            style={styles.skipHeaderButton}
            onPress={() =>
              onSkip ? onSkip() : navigation?.navigate('TripCompletedSummaryScreen')
            }
            accessibilityRole="button"
            accessibilityLabel={t('common.skip')}
          >
            <Text style={styles.skipHeaderText}>{t('common.skip')}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Header Text */}
          <View style={styles.textHeader}>
            <Text style={styles.title}>{t('feedback.howCanWeImprove')}</Text>
            <Text style={styles.subtitle}>
              {t('feedback.improveSubtitle')}
            </Text>
          </View>

          {/* Text Area Container */}
          <View style={[styles.inputContainer, isFocused && styles.inputContainerFocused]}>
            <TextInput
              style={styles.textInput}
              placeholder={t('feedback.tellUsMorePlaceholder')}
              placeholderTextColor={colors.outlineVariant}
              multiline
              maxLength={MAX_CHARS}
              value={reviewText}
              onChangeText={setReviewText}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              textAlignVertical="top"
              accessibilityLabel={t('feedback.tellUsMorePlaceholder')}
            />
            
            {/* Footer of Text Area */}
            <View style={styles.inputFooter}>
              <View style={styles.actionButtons}>
                {onAddPhoto ? (
                  <Pressable style={styles.actionIconButton} onPress={() => onAddPhoto()}>
                    <Feather name="camera" size={20} color={colors.onSurfaceVariant} />
                  </Pressable>
                ) : (
                  <View style={styles.actionIconButton}>
                    <Feather name="camera" size={20} color={colors.onSurfaceVariant} />
                  </View>
                )}
                {onAddLocation ? (
                  <Pressable style={styles.actionIconButton} onPress={() => onAddLocation()}>
                    <Feather name="map-pin" size={20} color={colors.onSurfaceVariant} />
                  </Pressable>
                ) : (
                  <View style={styles.actionIconButton}>
                    <Feather name="map-pin" size={20} color={colors.onSurfaceVariant} />
                  </View>
                )}
              </View>
              <Text style={[styles.charCount, charCount >= 450 && styles.charCountWarning]}>
                {charCount} / {MAX_CHARS}
              </Text>
            </View>
          </View>

          {/* Contextual Tags */}
          <View style={styles.tagsContainer}>
            <Text style={styles.tagsLabel}>{t('feedback.suggestedTopics')}</Text>
            <View style={styles.tagsRow}>
              {SUGGESTED_TOPIC_KEYS.map((key) => {
                const topicText = t(key);
                return (
                  <Pressable
                    key={key}
                    style={styles.tagChip}
                    onPress={() => handleTopicPress(topicText)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.tagChipText}>{topicText}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Spacer */}
          <View style={{ flexGrow: 1, minHeight: 40 }} />

          {/* Submit Button */}
          <Pressable
            style={[styles.submitButton, isSubmitDisabled && styles.submitButtonDisabled]}
            onPress={() => {
              onSubmit?.(reviewText);
              clearActiveRide();
              navigation?.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: 'MainTabs', params: { screen: 'HomeScreen' } }],
                })
              );
            }}
            disabled={isSubmitDisabled}
            accessibilityRole="button"
          >
            <Text style={styles.submitButtonText}>{t('trip.submitReview').toUpperCase()}</Text>
            <Feather name="send" size={18} color={colors.onPrimary} />
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomNavBar
        currentTab={currentTab}
        onTabPress={(tabId) => (onTabPress ? onTabPress(tabId) : navigateToTab(navigation, tabId))}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
    zIndex: -1,
  },
  skipHeaderButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  skipHeaderText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },

  textHeader: {
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onBackground,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    lineHeight: 22,
  },

  // Input
  inputContainer: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  inputContainerFocused: {
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainer,
    ...shadows.card,
  },
  textInput: {
    minHeight: 200,
    padding: spacing.lg,
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
    lineHeight: 24, // Approximation of relaxed
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  charCount: {
    fontSize: typography.dataMono.fontSize,
    color: colors.outline,
    fontFamily: typography.dataMono.fontFamily,
  },
  charCountWarning: {
    color: colors.error,
  },

  // Tags
  tagsContainer: {
    marginTop: spacing.xl,
  },
  tagsLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelSm.letterSpacing,
    marginBottom: spacing.md,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tagChip: {
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  tagChipText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Submit
  submitButton: {
    flexDirection: 'row',
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default WrittenReviewScreen;
