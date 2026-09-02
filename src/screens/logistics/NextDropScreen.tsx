import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';

export interface NextDropScreenProps {
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
  readonly onTrackDriver?: () => void;
  readonly onCall?: () => void;
  readonly onChat?: () => void;
}

const NextDropScreen: React.FC<NextDropScreenProps & { navigation?: any }> = ({
  onBack,
  onHelp,
  onTrackDriver,
  onCall,
  onChat,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Trip Progress</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
          accessibilityRole="button"
        >
          <Feather name="help-circle" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Status Banner */}
        <View style={styles.statusBannerContainer}>
          <View style={styles.statusBanner}>
            <MaterialIcons name="local-shipping" size={16} color={colors.onSecondaryContainer} />
            <Text style={styles.statusBannerText}>On the way to Drop 3</Text>
          </View>
        </View>

        {/* Next Drop Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderTextContainer}>
              <Text style={styles.dropLabel}>Drop 3 of 3</Text>
              <Text style={styles.dropAddress}>Basni Phase II, Jodhpur</Text>
              <Text style={styles.dropReceiver}>Receiver: Vikram Singh</Text>
            </View>
            <View style={styles.etaBadge}>
              <Text style={styles.etaTime}>12</Text>
              <Text style={styles.etaUnit}>MINS</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.driverSection}>
            <View style={styles.driverAvatar}>
              <Feather name="user" size={24} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.driverInfo}>
              <Text style={styles.driverStatus}>In Transit</Text>
              <Text style={styles.driverName}>Ramesh is driving to your location</Text>
            </View>
          </View>

          <View style={styles.actionsContainer}>
            <Button
              label="Track Driver"
              onPress={() => (onTrackDriver ? onTrackDriver() : navigation?.navigate('CustomerLiveTrackingScreen'))}
              variant="primary"
              fullWidth
            />
            <View style={styles.secondaryActions}>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => (onCall ? onCall() : navigation?.navigate('CallDriverScreen'))}
                accessibilityRole="button"
              >
                <Feather name="phone" size={18} color={colors.onSecondaryContainer} />
                <Text style={styles.secondaryBtnText}>Call</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryBtn}
                onPress={() => (onChat ? onChat() : navigation?.navigate('ActiveTripChatScreen'))}
                accessibilityRole="button"
              >
                <Feather name="message-circle" size={18} color={colors.onSecondaryContainer} />
                <Text style={styles.secondaryBtnText}>Chat</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* Route Context Timeline */}
        <View style={styles.card}>
          <Text style={styles.timelineTitle}>Journey Details</Text>
          
          <View style={styles.timelineContainer}>
            {/* Drop 2 */}
            <View style={styles.timelineItem}>
              <View style={styles.timelineDotCompleted}>
                <View style={styles.timelineDotInner} />
              </View>
              <View style={styles.timelineContent}>
                <Text style={styles.timelineItemTitleCompleted}>Drop 2</Text>
                <Text style={styles.timelineItemSubtitleCompleted}>Completed at 10:45 AM</Text>
              </View>
            </View>

            {/* Connecting Line */}
            <View style={styles.timelineLine} />

            {/* Drop 3 */}
            <View style={[styles.timelineItem, styles.timelineItemLast]}>
              <View style={styles.timelineDotActive} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineItemTitleActive}>Drop 3</Text>
                <Text style={styles.timelineItemSubtitleActive}>Next Stop</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
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
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  statusBannerContainer: {
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.secondaryContainer,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  statusBannerText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    ...shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  cardHeaderTextContainer: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  dropLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  dropAddress: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  dropReceiver: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 4,
  },
  etaBadge: {
    backgroundColor: colors.primaryContainer,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  etaTime: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  etaUnit: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant + '4D', // 30% opacity
    marginBottom: spacing.lg,
  },
  driverSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  driverAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  driverInfo: {
    flex: 1,
  },
  driverStatus: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: 4,
  },
  driverName: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  actionsContainer: {
    gap: spacing.sm,
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryBtn: {
    flex: 1,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.secondaryContainer,
    borderRadius: borderRadius.full,
  },
  secondaryBtnText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelSm.fontFamily,
  },
  timelineTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.xl,
  },
  timelineContainer: {
    paddingLeft: spacing.sm,
    position: 'relative',
  },
  timelineLine: {
    position: 'absolute',
    left: spacing.sm + 7, // offset to center of 16px dot
    top: 24,
    bottom: 24,
    width: 2,
    backgroundColor: colors.surfaceVariant,
    zIndex: 1,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xl,
    zIndex: 2,
  },
  timelineItemLast: {
    marginBottom: 0,
  },
  timelineDotCompleted: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    marginRight: spacing.md,
  },
  timelineDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.outline,
  },
  timelineDotActive: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
    marginTop: 4,
    marginRight: spacing.md,
    ...shadows.card, // simple shadow
  },
  timelineContent: {
    flex: 1,
  },
  timelineItemTitleCompleted: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  timelineItemSubtitleCompleted: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.outline,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 4,
  },
  timelineItemTitleActive: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  timelineItemSubtitleActive: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 4,
  },
});

export default NextDropScreen;
