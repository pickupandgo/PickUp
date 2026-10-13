import React, { useMemo } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, borderRadius } from '../../theme';
import { qrMatrix, qrPath } from '../../services/payments/qrMatrix';

export interface PaymentQrCodeProps {
  /** The Razorpay payment link to encode. */
  readonly value: string;
  /** Rendered width and height in points. */
  readonly size: number;
  readonly accessibilityLabel: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

/** The 4-module white border the QR specification requires around the code. */
const QUIET_ZONE = 4;

/** A scannable QR code drawn as one SVG path (dark on white for every scanner). */
export const PaymentQrCode: React.FC<PaymentQrCodeProps> = ({
  value,
  size,
  accessibilityLabel,
  style,
  testID,
}) => {
  const { path, extent } = useMemo(() => {
    const matrix = qrMatrix(value);
    return {
      path: qrPath(matrix, QUIET_ZONE),
      extent: matrix.length + QUIET_ZONE * 2,
    };
  }, [value]);

  return (
    <View
      style={[styles.frame, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${extent} ${extent}`}>
        <Rect
          x={0}
          y={0}
          width={extent}
          height={extent}
          fill={colors.surfaceContainerLowest}
        />
        {/* One path, so adjacent modules are filled together without hairline seams. */}
        <Path d={path} fill={colors.primary} />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'center',
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceContainerLowest,
  },
});

export default PaymentQrCode;
