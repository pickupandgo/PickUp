import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';

export interface ChangeProfilePhotoScreenProps {
  readonly onClose?: () => void;
}

const ChangeProfilePhotoScreen: React.FC<ChangeProfilePhotoScreenProps & { navigation?: any }> = ({
  onClose,
  navigation,
}) => {
  return (
    <View style={styles.container}>
      {/* Scrim Overlay */}
      <Pressable
        style={styles.scrim}
        onPress={() => navigation?.goBack()}
        accessibilityRole="button"
        accessibilityLabel="Close"
      />

      {/* Bottom Sheet */}
      <View style={styles.bottomSheet}>
        {/* Drag Handle */}
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Change Profile Photo</Text>
          <Text style={styles.subtitle}>Choose how you'd like to update your photo.</Text>
        </View>

        {/* Action List */}
        <View style={styles.actionList}>
          {/* Take Photo */}
          <Pressable
            style={styles.actionRow}
            onPress={() => navigation?.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Take Photo"
          >
            <Feather name="camera" size={22} color={colors.onSurfaceVariant} />
            <Text style={styles.actionText}>Take Photo</Text>
          </Pressable>

          <View style={styles.divider} />

          {/* Choose from Gallery */}
          <Pressable
            style={styles.actionRow}
            onPress={() => navigation?.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Choose from Gallery"
          >
            <Feather name="image" size={22} color={colors.onSurfaceVariant} />
            <Text style={styles.actionText}>Choose from Gallery</Text>
          </Pressable>

          <View style={styles.divider} />

          {/* Remove Photo */}
          <Pressable
            style={styles.actionRow}
            onPress={() => navigation?.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Remove Photo"
          >
            <Feather name="trash-2" size={22} color={colors.error} />
            <Text style={styles.actionTextDanger}>Remove Photo</Text>
          </Pressable>
        </View>

        {/* Cancel Button */}
        <SafeAreaView edges={['bottom']} style={styles.cancelContainer}>
          <Pressable
            style={styles.cancelButton}
            onPress={() => navigation?.goBack()}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  bottomSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  handleContainer: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  handle: {
    width: 48,
    height: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceVariant,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: spacing.marginMobile,
    marginBottom: spacing.xxl,
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    lineHeight: typography.headlineSm.lineHeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  actionList: {
    width: '100%',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.marginMobile,
    height: 56,
    gap: spacing.lg,
  },
  actionText: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
    flex: 1,
  },
  actionTextDanger: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.error,
    fontFamily: typography.bodyMd.fontFamily,
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: colors.surfaceVariant,
    marginLeft: 56,
    opacity: 0.5,
  },
  cancelContainer: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.xxl,
  },
  cancelButton: {
    height: spacing.rowHeightStandard,
    backgroundColor: colors.secondaryContainer,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default ChangeProfilePhotoScreen;
