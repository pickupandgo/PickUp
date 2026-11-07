import React from 'react';
import { View, Image, Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { APP_NAME, APP_LOGO } from '../../config/brand';
import { colors, spacing, typography } from '../../theme';

export default function BrandMark({ textStyle, size = spacing.xxl }: { textStyle?: StyleProp<TextStyle>; size?: number }) {
  return <View style={styles.row} accessible accessibilityLabel={APP_NAME}>
    <Image source={APP_LOGO} style={{ width: size, height: size }} resizeMode="contain" />
    <Text style={[styles.name, textStyle]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{APP_NAME}</Text>
  </View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 }, name: { ...typography.headlineSm, color: colors.homeAction, flexShrink: 1 } });
