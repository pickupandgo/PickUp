import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../../theme';
export function TripMapSheet({
  title,
  children,
  footer,
  onHeightChange,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onHeightChange: (height: number) => void;
}) {
  const { height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(true);
  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.sheet, { maxHeight: height * 0.55 }]}
      onLayout={event => onHeightChange(event.nativeEvent.layout.height)}
    >
      <Pressable
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Show more map' : 'Show trip details'}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(value => !value)}
      >
        <View style={styles.handle} />
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.toggle}>{expanded ? 'More map' : 'Details'}</Text>
        </View>
      </Pressable>
      {expanded ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          nestedScrollEnabled
        >
          {children}
        </ScrollView>
      ) : null}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: spacing.containerPadding,
    paddingTop: 8,
    paddingBottom: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
    alignSelf: 'center',
    marginBottom: 10,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { ...typography.headlineSm, color: colors.onSurface, flex: 1 },
  toggle: { ...typography.labelSm, color: colors.primary },
  scroll: { flexShrink: 1 },
  body: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.containerPadding,
    gap: spacing.gutter,
  },
  footer: {
    padding: spacing.containerPadding,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
});
