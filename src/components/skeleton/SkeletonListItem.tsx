import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { SkeletonCircle } from './SkeletonCircle';
import { SkeletonText } from './SkeletonText';
import { Skeleton } from './Skeleton';
import { spacing, borderRadius } from '../../theme';

export interface SkeletonListItemProps {
  /** Leading icon/avatar size. Defaults to 40. Set to 0 to omit. */
  readonly iconSize?: number;
  /** Whether leading element is square or circle. Defaults to circle. */
  readonly isSquareIcon?: boolean;
  /** Number of text lines. Defaults to 2. */
  readonly lines?: number;
  /** Whether to render trailing placeholder (e.g. price/chevron). Defaults to true. */
  readonly hasTrailing?: boolean;
  /** Number of items to render. Defaults to 1. */
  readonly count?: number;
  /** Alias for iconSize > 0. */
  readonly hasAvatar?: boolean;
  /** Alias for lines >= 2. */
  readonly hasSubtitle?: boolean;
  /** Custom container style overrides. */
  readonly style?: StyleProp<ViewStyle>;
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Standard list row skeleton representing transaction, trip, or settings rows.
 */
export const SkeletonListItem: React.FC<SkeletonListItemProps> = ({
  iconSize = 40,
  isSquareIcon = false,
  lines,
  hasTrailing = true,
  count = 1,
  hasAvatar,
  hasSubtitle,
  style,
  testID = 'skeleton-list-item',
}) => {
  const effectiveIconSize = hasAvatar === false ? 0 : iconSize;
  const effectiveLines = lines !== undefined ? lines : hasSubtitle === false ? 1 : 2;

  const renderSingle = (key: number | string, itemTestId?: string) => (
    <View key={key} style={[styles.container, style]} testID={itemTestId}>
      {effectiveIconSize > 0 && (
        <View style={styles.leading}>
          {isSquareIcon ? (
            <Skeleton width={effectiveIconSize} height={effectiveIconSize} borderRadius={borderRadius.sm} />
          ) : (
            <SkeletonCircle size={effectiveIconSize} />
          )}
        </View>
      )}

      <View style={styles.content}>
        <SkeletonText lines={effectiveLines} lineHeight={14} lineSpacing={6} lastLineWidth="60%" />
      </View>

      {hasTrailing && (
        <View style={styles.trailing}>
          <Skeleton width={48} height={16} borderRadius={4} />
        </View>
      )}
    </View>
  );

  if (count > 1) {
    return (
      <View testID={testID}>
        {Array.from({ length: count }).map((_, idx) => (
          <React.Fragment key={idx}>
            {renderSingle(idx, `${testID}-row`)}
            {idx < count - 1 && <View style={styles.divider} />}
          </React.Fragment>
        ))}
      </View>
    );
  }

  return renderSingle('single', testID);
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.md,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: '#ECEEF1',
  },
  leading: {
    marginRight: spacing.md,
  },
  content: {
    flex: 1,
  },
  trailing: {
    marginLeft: spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: '#ECEEF1',
    marginHorizontal: spacing.md,
  },
});
