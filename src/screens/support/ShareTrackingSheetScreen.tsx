import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import { mockActiveTrip } from '../../data/mockData';

export interface ShareTrackingSheetScreenProps {
  readonly onBack?: () => void;
  readonly onClose?: () => void;
  readonly onCopyLink?: () => void;
  readonly onShare?: () => void;
}

const ShareTrackingSheetScreen: React.FC<ShareTrackingSheetScreenProps & { navigation?: any }> = ({
  onBack,
  onClose,
  onCopyLink,
  onShare,
  navigation,
}) => {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const handleCopy = () => {
    setCopied(true);
    onCopyLink?.();
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = () => {
    setSharing(true);
    onShare?.();
    setTimeout(() => {
      setSharing(false);
      navigation?.goBack();
    }, 1500);
  };

  return (
    <View style={styles.container}>
      {/* Background Map Context */}
      <ImageBackground
        source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAUfyJTMJFKQT48Hv2nvHf7ojhbPI0KTimPOsHGbzsTe5rIadCpDoRmqkPMOuMzXH9aFpMxsyzorYePivz1D38_e0HuZ1-cukO5ZEYvqybrDVrCP7ThnBzGnhrQgRAkFUhaDb9etnXh5Ob4-yXjfvFd8b8JEhZu2HHQOiaFVxK0XLV0Ur9Dkvxmn4diJV3xTN8M8twkpbq7EGtp4HpRP0IDUBtueILEzbgPoJtssHaRqtBtYkYcwrG0' }}
        style={styles.mapBackground}
      />

      {/* Top App Bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <Pressable
            style={styles.iconButton}
            onPress={() => (onBack ? onBack() : navigation?.goBack())}
          >
            <Feather name="arrow-left" size={24} color={colors.primary} />
          </Pressable>
          <Text style={styles.headerTitle}>Current Trip</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      {/* Overlay Backdrop */}
      <View style={styles.overlay} />

      {/* Bottom Sheet Modal */}
      <View style={styles.bottomSheet}>
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          {/* Handle */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          {/* Sheet Header */}
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Share Tracking</Text>
            <Pressable
              style={styles.closeButton}
              onPress={() => (onClose ? onClose() : navigation?.goBack())}
            >
              <Feather name="x" size={24} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          <View style={styles.sheetContent}>
            {/* Trip Status Summary */}
            <View style={styles.statusSummary}>
              <View style={styles.statusIcon}>
                <Feather name="truck" size={20} color={colors.onPrimaryContainer} />
              </View>
              <View>
                <Text style={styles.statusLabel}>TRIP STATUS</Text>
                <Text style={styles.statusText}>En route to Drop 1 of 3</Text>
              </View>
            </View>

            {/* Logistics Details Compact */}
            <View style={styles.logisticsCard}>
              <View style={styles.logisticsRow}>
                {/* Visual Connector */}
                <View style={styles.connectorColumn}>
                  <View style={styles.connectorDotTop} />
                  <View style={styles.connectorLine} />
                  <View style={styles.connectorDotBottomRing}>
                    <View style={styles.connectorDotBottomCore} />
                  </View>
                </View>
                
                {/* Text Data */}
                <View style={styles.logisticsTextColumn}>
                  <View style={styles.logisticsItem}>
                    <Text style={styles.logisticsLabel}>Pickup</Text>
                    <Text style={styles.logisticsAddress}>{mockActiveTrip.stops[0]?.address}</Text>
                  </View>
                  <View style={styles.logisticsItem}>
                    <Text style={styles.logisticsLabel}>Next Drop</Text>
                    <Text style={styles.logisticsAddress}>{mockActiveTrip.stops[1]?.address}</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.divider} />

            {/* Tracking Link Section */}
            <View style={styles.trackingSection}>
              <Text style={styles.trackingSectionLabel}>TRACKING LINK</Text>
              <View style={styles.linkRow}>
                <Text style={styles.linkText} numberOfLines={1}>
                  pickup.com/track/TRP4910
                </Text>
                <Pressable style={styles.copyButton} onPress={handleCopy}>
                  <Feather name="copy" size={16} color={colors.primary} />
                </Pressable>
              </View>
              
              <View style={styles.infoRow}>
                <Feather name="info" size={16} color={colors.onSurfaceVariant} style={{ marginTop: 2 }} />
                <Text style={styles.infoText}>
                  Recipients can view the live driver location and ETA without an account.
                </Text>
              </View>

              {copied && (
                <View style={styles.statusMessage}>
                  <Feather name="check-circle" size={16} color={colors.primary} />
                  <Text style={styles.statusMessageText}>Link Copied!</Text>
                </View>
              )}
            </View>
          </View>

          {/* Action Button Area */}
          <View style={styles.actionArea}>
            <Pressable
              style={[styles.shareButton, sharing && styles.shareButtonDisabled]}
              onPress={handleShare}
              disabled={sharing}
            >
              {sharing ? (
                <>
                  <Feather name="loader" size={20} color={colors.onPrimaryContainer} />
                  <Text style={styles.shareButtonText}>PREPARING...</Text>
                </>
              ) : (
                <>
                  <Feather name="share" size={20} color={colors.onPrimaryContainer} />
                  <Text style={styles.shareButtonText}>SHARE TRACKING</Text>
                </>
              )}
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  mapBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  headerSafeArea: {
    position: 'absolute',
    top: 0,
    width: '100%',
    zIndex: 10,
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.onSurface + '66', // 40% opacity
    zIndex: 40,
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 32, // approx bottom sheet radius
    borderTopRightRadius: 32,
    zIndex: 50,
    ...shadows.elevated,
  },
  safeArea: {
    width: '100%',
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 48,
    height: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colors.outlineVariant,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceVariant,
  },
  sheetTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  sheetContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.lg,
    gap: spacing.lg,
  },
  
  // Trip Status Summary
  statusSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: 4,
  },
  statusText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },

  // Logistics Details
  logisticsCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  logisticsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  connectorColumn: {
    alignItems: 'center',
    marginTop: 4,
    width: 12,
  },
  connectorDotTop: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.onSurface,
  },
  connectorLine: {
    width: 2,
    height: 24,
    backgroundColor: colors.outlineVariant,
    marginVertical: 4,
  },
  connectorDotBottomRing: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectorDotBottomCore: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  logisticsTextColumn: {
    flex: 1,
    gap: spacing.md,
  },
  logisticsItem: {},
  logisticsLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  logisticsAddress: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.outlineVariant,
    width: '100%',
  },

  // Tracking Section
  trackingSection: {
    gap: spacing.md,
  },
  trackingSectionLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  linkText: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
    flex: 1,
    paddingRight: spacing.md,
  },
  copyButton: {
    padding: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  infoText: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    lineHeight: typography.bodyMd.lineHeight,
  },
  statusMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  statusMessageText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Action Area
  actionArea: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
  },
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryContainer,
    height: 56,
    borderRadius: borderRadius.full,
  },
  shareButtonDisabled: {
    opacity: 0.8,
  },
  shareButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimaryContainer,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default ShareTrackingSheetScreen;
