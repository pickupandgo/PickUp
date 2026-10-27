import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
} from 'react';
import {
  KeyboardAvoidingView,
  ScrollView,
  View,
  StyleSheet,
  Platform,
  Keyboard,
  TextInput,
  Dimensions,
  findNodeHandle,
  UIManager,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { spacing } from '../../theme';

export interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
  readonly footerStyle?: StyleProp<ViewStyle>;
  readonly keyboardVerticalOffset?: number;
  readonly contentContainerStyle?: StyleProp<ViewStyle>;
  readonly extraScrollPadding?: number;
  readonly extraScrollHeight?: number;
  readonly autoScrollToFocusedInput?: boolean;
}

export interface KeyboardAwareScrollViewRef {
  scrollTo: (options: { x?: number; y?: number; animated?: boolean }) => void;
  scrollToEnd: (options?: { animated?: boolean }) => void;
  scrollToFocusedInput: (extraOffset?: number) => void;
  scrollIntoView: (target: any, extraOffset?: number) => void;
  getScrollResponder: () => any;
  getNativeScrollRef: () => any;
  getInnerViewRef: () => any;
  getScrollRef: () => any;
}

export interface KeyboardAwareContextType {
  readonly scrollToInput: (inputRefOrNode: any, extraOffset?: number) => void;
  readonly isKeyboardVisible: boolean;
  readonly keyboardHeight: number;
}

export const KeyboardAwareContext = createContext<KeyboardAwareContextType>({
  scrollToInput: () => {},
  isKeyboardVisible: false,
  keyboardHeight: 0,
});

export const useKeyboardAware = () => useContext(KeyboardAwareContext);

/**
 * Hook for inputs inside a KeyboardAwareScrollView to ensure they notify the
 * container immediately on focus and scroll into view above the keyboard and footer.
 */
export const useKeyboardAwareInput = <T extends TextInput = TextInput>(
  onFocusProp?: (e: any) => void
) => {
  const inputRef = useRef<T | null>(null);
  const { scrollToInput } = useKeyboardAware();

  const handleFocus = useCallback(
    (e: any) => {
      onFocusProp?.(e);
      const target = inputRef.current || e?.target || e?.nativeEvent?.target;
      if (target) {
        scrollToInput(target);
      }
    },
    [onFocusProp, scrollToInput]
  );

  return { ref: inputRef, onFocus: handleFocus, scrollToInput };
};

/**
 * Shared KeyboardAwareScrollView organism.
 * Provides:
 * 1. Automatic focused-input detection & smooth auto-scrolling to keep active fields visible above the keyboard.
 * 2. Real-time adjustment when switching between consecutive fields without keyboard flicker.
 * 3. Content layout shift awareness (e.g. validation error messages expanding under fields).
 * 4. Pinned / sticky footer support with dynamic height measurement to prevent button overlap.
 * 5. Platform-tailored keyboard avoiding (Android adjustResize native handling + iOS padding).
 * 6. Forwarded imperative controls (scrollTo, scrollToEnd, scrollToFocusedInput, scrollIntoView).
 */
const KeyboardAwareScrollView = forwardRef<any, KeyboardAwareScrollViewProps>(
  (
    {
      children,
      footer,
      footerStyle,
      keyboardVerticalOffset = 0,
      contentContainerStyle,
      extraScrollPadding = spacing.xl ?? 20,
      extraScrollHeight,
      keyboardShouldPersistTaps = 'handled',
      showsVerticalScrollIndicator = false,
      autoScrollToFocusedInput = true,
      style,
      onScroll,
      onLayout,
      onContentSizeChange,
      onTouchEnd,
      ...scrollViewProps
    },
    ref
  ) => {
    const finalExtraPadding = extraScrollHeight ?? extraScrollPadding;
    const scrollRef = useRef<ScrollView | null>(null);
    const scrollYRef = useRef<number>(0);

    const [containerHeight, setContainerHeight] = useState<number>(0);
    const [footerHeight, setFooterHeight] = useState<number>(0);
    const [isKeyboardVisible, setIsKeyboardVisible] = useState<boolean>(false);
    const [keyboardHeight, setKeyboardHeight] = useState<number>(0);

    // Refs for synchronous access without waiting for state re-render
    const containerHeightRef = useRef<number>(0);
    const footerHeightRef = useRef<number>(0);
    const isKeyboardVisibleRef = useRef<boolean>(false);
    const keyboardHeightRef = useRef<number>(0);
    const pendingTargetRef = useRef<{ target: any; customExtraOffset?: number } | null>(null);

    const lastFocusedInputRef = useRef<any>(null);
    const isAutoScrollingRef = useRef<boolean>(false);

    // Debouncing / deduplication of bubbled focus events
    const lastFocusTimestampRef = useRef<number>(0);
    const lastFocusedTargetRef = useRef<any>(null);

    // Managed timeout registry for leak-free cleanup
    const activeTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

    const safeSetTimeout = useCallback((cb: () => void, ms: number) => {
      const timer = setTimeout(() => {
        activeTimeoutsRef.current.delete(timer);
        cb();
      }, ms);
      activeTimeoutsRef.current.add(timer);
      return timer;
    }, []);

    // Cleanup all active timers on unmount
    useEffect(() => {
      return () => {
        activeTimeoutsRef.current.forEach((t) => clearTimeout(t));
        activeTimeoutsRef.current.clear();
      };
    }, []);

    // Track scroll Y
    const handleScroll = useCallback(
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollYRef.current = e.nativeEvent.contentOffset.y;
        onScroll?.(e);
      },
      [onScroll]
    );

    // Perform the actual scroll calculation and command
    const performAutoScroll = useCallback(
      (top: number, height: number, customExtraOffset?: number) => {
        if (!scrollRef.current) return;

        const effectiveContainerHeight =
          containerHeightRef.current > 0 ? containerHeightRef.current : containerHeight;

        // If the container has not yet been measured by onLayout, defer until layout is ready
        if (effectiveContainerHeight <= 0) {
          pendingTargetRef.current = { target: lastFocusedInputRef.current, customExtraOffset };
          return;
        }

        const effectiveFooter =
          footer ? (footerHeightRef.current > 0 ? footerHeightRef.current : footerHeight) : 0;

        const currentKHeight =
          keyboardHeightRef.current > 0
            ? keyboardHeightRef.current
            : isKeyboardVisible
            ? keyboardHeight
            : 0;

        const windowHeight = Dimensions.get('window').height;
        const containerShrunkAmount =
          windowHeight > 0 && effectiveContainerHeight > 0
            ? Math.max(0, windowHeight - effectiveContainerHeight)
            : 0;

        const unadjustedKeyboardHeight = Math.max(0, currentKHeight - containerShrunkAmount);

        // Visible vertical viewport above the sticky footer AND unadjusted keyboard
        const effectiveVisibleHeight = Math.max(
          80,
          effectiveContainerHeight - effectiveFooter - unadjustedKeyboardHeight
        );

        const offset = customExtraOffset ?? finalExtraPadding;
        const inputTop = top - offset;
        const inputBottom = top + height + offset;
        const currentY = scrollYRef.current;
        const visibleBottom = currentY + effectiveVisibleHeight;

        if (inputBottom > visibleBottom) {
          // Input is partly or fully hidden by bottom/keyboard/footer: scroll down
          const targetY = Math.max(0, inputBottom - effectiveVisibleHeight);
          if (Math.abs(currentY - targetY) > 2) {
            isAutoScrollingRef.current = true;
            scrollRef.current.scrollTo({ x: 0, y: targetY, animated: true });
            safeSetTimeout(() => {
              isAutoScrollingRef.current = false;
            }, 280);
          }
        } else if (inputTop < currentY) {
          // Input is cut off above top of viewport: scroll up
          const targetY = Math.max(0, inputTop);
          if (Math.abs(currentY - targetY) > 2) {
            isAutoScrollingRef.current = true;
            scrollRef.current.scrollTo({ x: 0, y: targetY, animated: true });
            safeSetTimeout(() => {
              isAutoScrollingRef.current = false;
            }, 280);
          }
        }
      },
      [
        containerHeight,
        footer,
        footerHeight,
        isKeyboardVisible,
        keyboardHeight,
        finalExtraPadding,
        safeSetTimeout,
      ]
    );

    // Fallback: measure in window coordinates and perform exact screen-space scrolling
    const measureInWindowFallback = useCallback(
      (target: any, customExtraOffset?: number) => {
        const unwrapped = target?.current ?? target;
        if (!unwrapped) return;

        const safeFindNodeHandle = (nodeOrRef: any): number | null => {
          if (!nodeOrRef) return null;
          if (typeof nodeOrRef === 'number') return nodeOrRef;
          try {
            return findNodeHandle(nodeOrRef);
          } catch {
            return null;
          }
        };

        const targetHandle = safeFindNodeHandle(unwrapped);

        const handleMeasuredWindowCoords = (ix: number, iy: number, iw: number, ih: number) => {
          if (!scrollRef.current) return;
          const windowHeight = Dimensions.get('window').height;
          const currentKHeight =
            keyboardHeightRef.current > 0
              ? keyboardHeightRef.current
              : isKeyboardVisible
              ? keyboardHeight
              : 0;

          const effFooter =
            footer ? (footerHeightRef.current > 0 ? footerHeightRef.current : footerHeight) : 0;

          const offset = customExtraOffset ?? finalExtraPadding;
          const keyboardTopInWindow =
            currentKHeight > 0 ? windowHeight - currentKHeight : windowHeight;
          const clearBottom = keyboardTopInWindow - effFooter;
          const inputBottom = iy + ih + offset;

          if (inputBottom > clearBottom) {
            const overlap = inputBottom - clearBottom;
            if (overlap > 1) {
              isAutoScrollingRef.current = true;
              scrollRef.current.scrollTo({
                x: 0,
                y: scrollYRef.current + overlap,
                animated: true,
              });
              safeSetTimeout(() => {
                isAutoScrollingRef.current = false;
              }, 280);
            }
          } else if (iy - offset < 0) {
            const cutOff = Math.abs(iy - offset);
            if (cutOff > 1) {
              isAutoScrollingRef.current = true;
              scrollRef.current.scrollTo({
                x: 0,
                y: Math.max(0, scrollYRef.current - cutOff),
                animated: true,
              });
              safeSetTimeout(() => {
                isAutoScrollingRef.current = false;
              }, 280);
            }
          }
        };

        if (typeof unwrapped?.measureInWindow === 'function') {
          unwrapped.measureInWindow(handleMeasuredWindowCoords);
          return;
        }

        if (targetHandle && UIManager?.measureInWindow) {
          UIManager.measureInWindow(targetHandle, handleMeasuredWindowCoords);
          return;
        }

        if (typeof unwrapped?.measure === 'function') {
          unwrapped.measure((x: number, y: number, w: number, h: number, pageX: number, pageY: number) => {
            handleMeasuredWindowCoords(pageX, pageY, w, h);
          });
          return;
        }

        if (targetHandle && UIManager?.measure) {
          UIManager.measure(targetHandle, (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => {
            handleMeasuredWindowCoords(pageX, pageY, w, h);
          });
          return;
        }
      },
      [finalExtraPadding, footer, footerHeight, isKeyboardVisible, keyboardHeight, safeSetTimeout]
    );

    // Scroll a given target or currently focused input into view
    const scrollIntoView = useCallback(
      (targetNodeOrRef?: any, customExtraOffset?: number) => {
        if (!autoScrollToFocusedInput) return;

        let target = targetNodeOrRef?.current ?? targetNodeOrRef;
        if (!target) {
          if (typeof TextInput.State?.currentlyFocusedInput === 'function') {
            target = TextInput.State.currentlyFocusedInput();
          } else if (typeof (TextInput.State as any)?.currentlyFocusedField === 'function') {
            target = (TextInput.State as any).currentlyFocusedField();
          }
          if (!target) {
            target = lastFocusedInputRef.current;
          }
        }
        if (!target || !scrollRef.current) return;

        lastFocusedInputRef.current = target;

        const innerRef =
          (scrollRef.current as any)?.getInnerViewRef?.() ||
          (scrollRef.current as any)?.getScrollableNode?.() ||
          scrollRef.current;

        const safeFindNodeHandle = (nodeOrRef: any): number | null => {
          if (!nodeOrRef) return null;
          if (typeof nodeOrRef === 'number') return nodeOrRef;
          try {
            return findNodeHandle(nodeOrRef);
          } catch {
            return null;
          }
        };

        const targetHandle = safeFindNodeHandle(target);
        const containerHandle = safeFindNodeHandle(innerRef);

        // Always prioritize exact window coordinate measurement if available for accurate keyboard clearance
        const unwrapped = target?.current ?? target;
        if (typeof unwrapped?.measureInWindow === 'function' || (targetHandle && typeof (UIManager as any)?.measureInWindow === 'function')) {
          measureInWindowFallback(target, customExtraOffset);
          return;
        }

        if (typeof target.measureLayout === 'function' && innerRef) {
          try {
            target.measureLayout(
              innerRef,
              (left: number, top: number, width: number, height: number) => {
                performAutoScroll(top, height, customExtraOffset);
              },
              () => {
                if (targetHandle && containerHandle && UIManager?.measureLayout) {
                  UIManager.measureLayout(
                    targetHandle,
                    containerHandle,
                    () => measureInWindowFallback(target, customExtraOffset),
                    (left: number, top: number, width: number, height: number) => {
                      performAutoScroll(top, height, customExtraOffset);
                    }
                  );
                } else {
                  measureInWindowFallback(target, customExtraOffset);
                }
              }
            );
          } catch {
            measureInWindowFallback(target, customExtraOffset);
          }
        } else if (targetHandle && containerHandle && UIManager?.measureLayout) {
          UIManager.measureLayout(
            targetHandle,
            containerHandle,
            () => measureInWindowFallback(target, customExtraOffset),
            (left: number, top: number, width: number, height: number) => {
              performAutoScroll(top, height, customExtraOffset);
            }
          );
        } else {
          measureInWindowFallback(target, customExtraOffset);
        }
      },
      [autoScrollToFocusedInput, measureInWindowFallback, performAutoScroll]
    );

    const scrollToFocusedInput = useCallback(
      (customExtraOffset?: number) => {
        scrollIntoView(undefined, customExtraOffset);
      },
      [scrollIntoView]
    );

    // Track container height (triggers when Android window resizes with adjustResize)
    const handleLayout = useCallback(
      (e: LayoutChangeEvent) => {
        const newHeight = e.nativeEvent.layout.height;
        containerHeightRef.current = newHeight;
        setContainerHeight(newHeight);
        onLayout?.(e);

        if (pendingTargetRef.current) {
          const pending = pendingTargetRef.current;
          pendingTargetRef.current = null;
          scrollIntoView(pending.target, pending.customExtraOffset);
        } else if (lastFocusedInputRef.current) {
          safeSetTimeout(() => {
            scrollIntoView(lastFocusedInputRef.current);
          }, 50);
        }
      },
      [onLayout, scrollIntoView, safeSetTimeout]
    );

    // Track footer height dynamically and re-adjust active field
    const handleFooterLayout = useCallback(
      (e: LayoutChangeEvent) => {
        const newFooterHeight = e.nativeEvent.layout.height;
        footerHeightRef.current = newFooterHeight;
        setFooterHeight(newFooterHeight);

        if (pendingTargetRef.current) {
          const pending = pendingTargetRef.current;
          pendingTargetRef.current = null;
          scrollIntoView(pending.target, pending.customExtraOffset);
        } else if (lastFocusedInputRef.current) {
          safeSetTimeout(() => {
            scrollIntoView(lastFocusedInputRef.current);
          }, 50);
        }
      },
      [scrollIntoView, safeSetTimeout]
    );

    // Keyboard listeners
    useEffect(() => {
      const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

      const onKeyboardShow = (e: any) => {
        const height = e?.endCoordinates?.height || 260;
        keyboardHeightRef.current = height;
        isKeyboardVisibleRef.current = true;
        setKeyboardHeight(height);
        setIsKeyboardVisible(true);

        // Automatically reveal currently focused input when keyboard appears
        if (autoScrollToFocusedInput) {
          const target = lastFocusedInputRef.current;
          safeSetTimeout(() => {
            scrollIntoView(target);
          }, 50);
          safeSetTimeout(() => {
            scrollIntoView(target);
          }, 240);
        }
      };

      const onKeyboardHide = () => {
        keyboardHeightRef.current = 0;
        isKeyboardVisibleRef.current = false;
        setIsKeyboardVisible(false);
        setKeyboardHeight(0);
        lastFocusedInputRef.current = null;
        pendingTargetRef.current = null;
      };

      const showSub = Keyboard.addListener(showEvent, onKeyboardShow);
      const hideSub = Keyboard.addListener(hideEvent, onKeyboardHide);

      return () => {
        showSub.remove();
        hideSub.remove();
      };
    }, [autoScrollToFocusedInput, scrollIntoView, safeSetTimeout]);

    // Active input watcher while keyboard is open:
    // Detects when user switches fields without keyboard closing
    useEffect(() => {
      if (!isKeyboardVisible || !autoScrollToFocusedInput) return;

      const interval = setInterval(() => {
        if (isAutoScrollingRef.current) return;
        const currentInput = TextInput.State?.currentlyFocusedInput?.() ?? null;
        if (currentInput && currentInput !== lastFocusedInputRef.current) {
          lastFocusedInputRef.current = currentInput;
          scrollIntoView(currentInput);
        }
      }, 200);

      return () => clearInterval(interval);
    }, [isKeyboardVisible, autoScrollToFocusedInput, scrollIntoView]);

    // Content size change: re-verify visibility if layout shifted while typing
    const handleContentSizeChange = useCallback(
      (w: number, h: number) => {
        onContentSizeChange?.(w, h);
        if (isKeyboardVisible && autoScrollToFocusedInput && !isAutoScrollingRef.current) {
          safeSetTimeout(() => {
            scrollIntoView();
          }, 80);
        }
      },
      [onContentSizeChange, isKeyboardVisible, autoScrollToFocusedInput, scrollIntoView, safeSetTimeout]
    );

    // Touch end: re-check focus when user taps around in scrollview while keyboard is open
    const handleTouchEnd = useCallback(
      (e: any) => {
        onTouchEnd?.(e);
        if (isKeyboardVisible && autoScrollToFocusedInput) {
          safeSetTimeout(() => {
            const currentInput = TextInput.State?.currentlyFocusedInput?.() ?? null;
            if (currentInput) {
              scrollIntoView(currentInput);
            }
          }, 100);
        }
      },
      [onTouchEnd, isKeyboardVisible, autoScrollToFocusedInput, scrollIntoView, safeSetTimeout]
    );

    // Deduplicated focus handler for bubbling events
    const handleFocusEvent = useCallback(
      (e: any) => {
        const node = e?.target ?? e?.nativeEvent?.target;
        if (!node) return;

        const now = Date.now();
        if (lastFocusedTargetRef.current === node && now - lastFocusTimestampRef.current < 150) {
          return;
        }

        lastFocusedTargetRef.current = node;
        lastFocusTimestampRef.current = now;
        lastFocusedInputRef.current = node;
        scrollIntoView(node);
      },
      [scrollIntoView]
    );

    // Imperative ref forwarding
    useImperativeHandle(
      ref,
      () => ({
        scrollTo: (options: { x?: number; y?: number; animated?: boolean }) => {
          scrollRef.current?.scrollTo(options);
        },
        scrollToEnd: (options?: { animated?: boolean }) => {
          scrollRef.current?.scrollToEnd(options);
        },
        scrollToFocusedInput,
        scrollIntoView,
        getScrollResponder: () => (scrollRef.current as any)?.getScrollResponder?.(),
        getNativeScrollRef: () => (scrollRef.current as any)?.getNativeScrollRef?.() || scrollRef.current,
        getInnerViewRef: () => (scrollRef.current as any)?.getInnerViewRef?.(),
        getScrollRef: () => scrollRef.current,
      }),
      [scrollToFocusedInput, scrollIntoView]
    );

    const contextValue = {
      scrollToInput: scrollIntoView,
      isKeyboardVisible,
      keyboardHeight,
    };

    return (
      <KeyboardAwareContext.Provider value={contextValue}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={keyboardVerticalOffset}
        >
          <ScrollView
            ref={scrollRef}
            style={[styles.scrollView, style]}
            contentContainerStyle={[
              styles.defaultContent,
              contentContainerStyle,
              {
                paddingBottom:
                  (isKeyboardVisible ? keyboardHeight : 0) +
                  (footer
                    ? (footerHeight > 0 ? footerHeight : 76) + finalExtraPadding + spacing.md
                    : finalExtraPadding),
              },
            ]}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}
            showsVerticalScrollIndicator={showsVerticalScrollIndicator}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onLayout={handleLayout}
            onContentSizeChange={handleContentSizeChange}
            onTouchEnd={handleTouchEnd}
            onFocus={handleFocusEvent}
            {...scrollViewProps}
          >
            <View
              collapsable={false}
              onFocus={handleFocusEvent}
              style={styles.innerWrapper}
            >
              {children}
            </View>
          </ScrollView>
          {footer && (
            <View onLayout={handleFooterLayout} style={[styles.footerContainer, footerStyle]}>
              {footer}
            </View>
          )}
        </KeyboardAvoidingView>
      </KeyboardAwareContext.Provider>
    );
  }
);

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  defaultContent: {
    flexGrow: 1,
  },
  innerWrapper: {
    flex: 1,
    width: '100%',
    alignSelf: 'stretch',
  },
  footerContainer: {
    width: '100%',
  },
});

export { KeyboardAwareScrollView };
export default KeyboardAwareScrollView;
