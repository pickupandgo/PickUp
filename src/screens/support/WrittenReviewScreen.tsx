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
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import BottomNavBar from '../../components/BottomNavBar';
import { navigateToTab } from '../../navigation/tabRoutes';

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

const SUGGESTED_TOPICS = [
  'Vehicle Cleanliness',
  'Driving Smoothness',
  'Navigation',
  'Professionalism',
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
          >
            <Feather name="arrow-left" size={24} color={colors.onSurfaceVariant} />
          </Pressable>
          <Text style={styles.headerTitle}>Write a Review</Text>
          <Pressable
            style={styles.skipHeaderButton}
            onPress={() =>
              onSkip ? onSkip() : navigation?.navigate('TripCompletedSummaryScreen')
            }
          >
            <Text style={styles.skipHeaderText}>Skip</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Header Text */}
          <View style={styles.textHeader}>
            <Text style={styles.title}>How can we improve?</Text>
            <Text style={styles.subtitle}>
              Your detailed feedback helps us ensure a premium experience for everyone on the platform.
            </Text>
          </View>

          {/* Text Area Container */}
          <View style={[styles.inputContainer, isFocused && styles.inputContainerFocused]}>
            <TextInput
              style={styles.textInput}
              placeholder="Tell us more about your experience..."
              placeholderTextColor={colors.outlineVariant}
              multiline
              maxLength={MAX_CHARS}
              value={reviewText}
              onChangeText={setReviewText}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              textAlignVertical="top"
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
            <Text style={styles.tagsLabel}>SUGGESTED TOPICS</Text>
            <View style={styles.tagsRow}>
              {SUGGESTED_TOPICS.map((topic) => (
                <Pressable
                  key={topic}
                  style={styles.tagChip}
                  onPress={() => handleTopicPress(topic)}
                >
                  <Text style={styles.tagChipText}>{topic}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Spacer */}
          <View style={{ flexGrow: 1, minHeight: 40 }} />

          {/* Submit Button */}
          <Pressable
            style={[styles.submitButton, isSubmitDisabled && styles.submitButtonDisabled]}
            onPress={() => {
              onSubmit?.(reviewText);
              navigation?.navigate('HomeScreen');
            }}
            disabled={isSubmitDisabled}
          >
            <Text style={styles.submitButtonText}>SUBMIT REVIEW</Text>
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
