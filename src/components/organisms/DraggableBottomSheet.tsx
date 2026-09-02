import React, { useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  Dimensions,
  LayoutChangeEvent,
} from 'react-native';
import { colors, shadows, borderRadius, spacing } from '../../theme';

export interface DraggableBottomSheetProps {
  children: React.ReactNode;
  snapPoints?: number[]; // e.g. [100, Dimensions.get('window').height * 0.6]
  initialSnapIndex?: number;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const DraggableBottomSheet: React.FC<DraggableBottomSheetProps> = ({
  children,
  snapPoints = [100, SCREEN_HEIGHT * 0.5, SCREEN_HEIGHT * 0.8],
  initialSnapIndex = 1,
}) => {
  const sortedSnapPoints = snapPoints.sort((a, b) => b - a); // highest to lowest (from top)
  const initialY = SCREEN_HEIGHT - sortedSnapPoints[initialSnapIndex];

  const panY = useRef(new Animated.Value(initialY)).current;
  const currentY = useRef(initialY);

  const snapTo = (y: number) => {
    Animated.spring(panY, {
      toValue: y,
      useNativeDriver: false,
      bounciness: 0,
    }).start();
    currentY.current = y;
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only claim the responder if they're actually dragging vertically
        return Math.abs(gestureState.dy) > 5;
      },
      onPanResponderMove: (_, gestureState) => {
        const newY = currentY.current + gestureState.dy;
        // Prevent dragging higher than the highest snap point (which is the lowest Y value)
        const minY = SCREEN_HEIGHT - sortedSnapPoints[0];
        if (newY >= minY) {
          panY.setValue(newY);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const draggedY = currentY.current + gestureState.dy;
        const velocityY = gestureState.vy;

        // Predict where it should snap based on velocity and position
        const predictedY = draggedY + velocityY * 50;

        // Find closest snap point
        let closestY = SCREEN_HEIGHT - sortedSnapPoints[0];
        let minDistance = Infinity;

        sortedSnapPoints.forEach((point) => {
          const snapY = SCREEN_HEIGHT - point;
          const distance = Math.abs(snapY - predictedY);
          if (distance < minDistance) {
            minDistance = distance;
            closestY = snapY;
          }
        });

        snapTo(closestY);
      },
    })
  ).current;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          height: sortedSnapPoints[0] + 80, // Set height to max snap point + tab bar padding
          transform: [{ translateY: panY }],
        },
      ]}
    >
      <View {...panResponder.panHandlers} style={styles.dragZone}>
        <View style={styles.handle} />
      </View>
      <View style={styles.contentContainer}>
        {children}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SCREEN_HEIGHT,
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    ...shadows.elevated,
  },
  dragZone: {
    width: '100%',
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.outlineVariant,
  },
  contentContainer: {
    flex: 1,
    paddingBottom: 100, // Account for tabs/safe area
  },
});

export default DraggableBottomSheet;
