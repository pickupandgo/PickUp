import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  Dimensions,
  Keyboard,
  type KeyboardEvent,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { colors, shadows, borderRadius, spacing } from '../../theme';

export interface DraggableBottomSheetProps {
  children: React.ReactNode;
  snapPoints?: number[]; // e.g. [100, Dimensions.get('window').height * 0.6]
  initialSnapIndex?: number;
  keyboardAware?: boolean;
}

const DraggableBottomSheet: React.FC<DraggableBottomSheetProps> = ({
  children,
  snapPoints,
  initialSnapIndex = 1,
  keyboardAware = true,
}) => {
  const { height: windowHeight } = useWindowDimensions();

  const effectiveSnapPoints = useMemo(
    () => snapPoints ?? [100, windowHeight * 0.5, windowHeight * 0.8],
    [snapPoints, windowHeight]
  );

  const sortedSnapPoints = useMemo(
    () => [...effectiveSnapPoints].sort((a, b) => b - a), // highest to lowest (from top)
    [effectiveSnapPoints]
  );

  const initialY = windowHeight - (sortedSnapPoints[initialSnapIndex] ?? sortedSnapPoints[0]);

  const panY = useRef(new Animated.Value(initialY)).current;
  const currentY = useRef(initialY);
  const isKeyboardVisible = useRef(false);
  const previousYBeforeKeyboard = useRef(initialY);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const snapTo = (y: number) => {
    Animated.spring(panY, {
      toValue: y,
      useNativeDriver: false,
      bounciness: 0,
    }).start();
    currentY.current = y;
  };

  useEffect(() => {
    if (!keyboardAware) return;

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onKeyboardShow = (e: KeyboardEvent) => {
      const kh = e.endCoordinates?.height ?? 0;
      setKeyboardHeight(kh);
      if (!isKeyboardVisible.current) {
        isKeyboardVisible.current = true;
        previousYBeforeKeyboard.current = currentY.current;
      }
      // Snap sheet so maximum vertical space is available above the keyboard.
      // On Android (adjustResize), windowHeight already reflects the space above keyboard.
      // On iOS, window is not resized by the OS so we account for kh.
      const visibleHeight = Platform.OS === 'ios' ? Math.max(100, windowHeight - kh) : windowHeight;
      const targetHeight = Math.min(sortedSnapPoints[0], visibleHeight - 20);
      const targetY = Math.max(10, visibleHeight - targetHeight);
      snapTo(targetY);
    };

    const onKeyboardHide = () => {
      setKeyboardHeight(0);
      if (isKeyboardVisible.current) {
        isKeyboardVisible.current = false;
        snapTo(previousYBeforeKeyboard.current);
      }
    };

    const showSub = Keyboard.addListener(showEvent, onKeyboardShow);
    const hideSub = Keyboard.addListener(hideEvent, onKeyboardHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardAware, sortedSnapPoints, windowHeight]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only claim the responder if they're actually dragging vertically
        return Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        if (isKeyboardVisible.current) {
          Keyboard.dismiss();
        }
      },
      onPanResponderMove: (_, gestureState) => {
        const newY = currentY.current + gestureState.dy;
        // Prevent dragging higher than the highest snap point (which is the lowest Y value)
        const minY = Math.max(10, windowHeight - sortedSnapPoints[0]);
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
        let closestY = Math.max(10, windowHeight - sortedSnapPoints[0]);
        let minDistance = Infinity;

        sortedSnapPoints.forEach((point) => {
          const snapY = Math.max(10, windowHeight - point);
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

  // Clamped max sheet height so the sheet never extends below the keyboard viewport
  const maxSheetHeight = Math.min(sortedSnapPoints[0] + 80, windowHeight);

  // Platform-appropriate bottom padding to prevent double-offsets on Android
  const contentBottomPadding =
    Platform.OS === 'ios'
      ? Math.max(100, keyboardHeight + spacing.lg)
      : keyboardHeight > 0
      ? spacing.lg
      : 100;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          height: maxSheetHeight,
          transform: [{ translateY: panY }],
        },
      ]}
    >
      <View {...panResponder.panHandlers} style={styles.dragZone}>
        <View style={styles.handle} />
      </View>
      <View
        style={[
          styles.contentContainer,
          {
            paddingBottom: contentBottomPadding,
          },
        ]}
      >
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
