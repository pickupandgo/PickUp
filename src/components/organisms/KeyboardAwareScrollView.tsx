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

    const lastFocusedInputRef = useRef<any>(null);
    const isAutoScrollingRef = useRef<boolean>(false);

    // Track scroll Y
    const handleScroll = useCallback(
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollYRef.current = e.nativeEvent.contentOffset.y;
        onScroll?.(e);
      },
      [onScroll]
    );

    // Track container height
    const handleLayout = useCallback(
      (e: LayoutChangeEvent) => {
        setContainerHeight(e.nativeEvent.layout.height);
        onLayout?.(e);
      },
      [onLayout]
    );

    // Track footer height dynamically
    const handleFooterLayout = useCallback((e: LayoutChangeEvent) => {
      setFooterHeight(e.nativeEvent.layout.height);
    }, []);

    // Perform the actual scroll calculation and command
    const performAutoScroll = useCallback(
      (top: number, height: number, customExtraOffset?: number) => {
        if (!scrollRef.current) return;
        const offset = customExtraOffset ?? finalExtraPadding;

        // Viewport inside ScrollView above footer
        const effectiveVisibleHeight = Math.max(
          120,
          containerHeight > 0
            ? containerHeight - (footer ? footerHeight : 0)
            : Dimensions.get('window').height * 0.45
        );

        const inputTop = top - offset;
        const inputBottom = top + height + offset;
        const currentY = scrollYRef.current;
        const visibleBottom = currentY + effectiveVisibleHeight;

        if (inputBottom > visibleBottom) {
          // Input is partly or fully hidden by bottom/keyboard/footer: scroll down
          const targetY = Math.max(0, inputBottom - effectiveVisibleHeight);
          isAutoScrollingRef.current = true;
          scrollRef.current.scrollTo({ x: 0, y: targetY, animated: true });
          setTimeout(() => {
            isAutoScrollingRef.current = false;
          }, 300);
        } else if (inputTop < currentY) {
          // Input is cut off above top of viewport: scroll up
          const targetY = Math.max(0, inputTop);
          isAutoScrollingRef.current = true;
          scrollRef.current.scrollTo({ x: 0, y: targetY, animated: true });
          setTimeout(() => {
            isAutoScrollingRef.current = false;
          }, 300);
        }
        // Else input is already visible within the clear viewport: no-op!
      },
      [containerHeight, footer, footerHeight, finalExtraPadding]
    );

    // Fallback: measure in window
    const measureInWindowFallback = useCallback(
      (target: any, customExtraOffset?: number) => {
        if (typeof target?.measureInWindow === 'function') {
          target.measureInWindow((ix: number, iy: number, iw: number, ih: number) => {
            const scrollNode = scrollRef.current;
            if (typeof (scrollNode as any)?.measureInWindow === 'function') {
              (scrollNode as any).measureInWindow((sx: number, sy: number, sw: number, sh: number) => {
                const relativeTop = iy - sy + scrollYRef.current;
                performAutoScroll(relativeTop, ih, customExtraOffset);
              });
            } else {
              const windowH = Dimensions.get('window').height;
              const effectiveBottom =
                windowH -
                (keyboardHeight > 0 ? keyboardHeight : 280) -
                (footer ? footerHeight : 0);
              const offset = customExtraOffset ?? finalExtraPadding;
              if (iy + ih + offset > effectiveBottom) {
                const diff = iy + ih + offset - effectiveBottom;
                scrollRef.current?.scrollTo({
                  x: 0,
                  y: scrollYRef.current + diff,
                  animated: true,
                });
              }
            }
          });
        } else if (
          typeof (scrollRef.current as any)?.scrollResponderScrollNativeHandleToKeyboard ===
          'function'
        ) {
          (scrollRef.current as any).scrollResponderScrollNativeHandleToKeyboard(
            target,
            customExtraOffset ?? finalExtraPadding,
            true
          );
        }
      },
      [finalExtraPadding, footer, footerHeight, keyboardHeight, performAutoScroll]
    );

    // Scroll a given target or currently focused input into view
    const scrollIntoView = useCallback(
      (targetNodeOrRef?: any, customExtraOffset?: number) => {
        if (!autoScrollToFocusedInput) return;

        let target = targetNodeOrRef;
        if (!target) {
          if (typeof TextInput.State?.currentlyFocusedInput === 'function') {
            target = TextInput.State.currentlyFocusedInput();
          } else if (typeof (TextInput.State as any)?.currentlyFocusedField === 'function') {
            target = (TextInput.State as any).currentlyFocusedField();
          } else {
            target = null;
          }
        }
        if (!target || !scrollRef.current) return;

        lastFocusedInputRef.current = target;

        if (typeof target.measureLayout === 'function') {
          const innerRef =
            (scrollRef.current as any)?.getInnerViewRef?.() ||
            (scrollRef.current as any)?.getScrollableNode?.() ||
            scrollRef.current;
          try {
            target.measureLayout(
              innerRef,
              (left: number, top: number, width: number, height: number) => {
                performAutoScroll(top, height, customExtraOffset);
              },
              () => {
                measureInWindowFallback(target, customExtraOffset);
              }
            );
          } catch {
            measureInWindowFallback(target, customExtraOffset);
          }
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

    // Keyboard listeners
    useEffect(() => {
      const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
      const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

      const onKeyboardShow = (e: any) => {
        const height = e?.endCoordinates?.height || 260;
        setKeyboardHeight(height);
        setIsKeyboardVisible(true);

        // Automatically reveal currently focused input when keyboard appears
        if (autoScrollToFocusedInput) {
          setTimeout(() => {
            scrollIntoView();
          }, 60);
        }
      };

      const onKeyboardHide = () => {
        setIsKeyboardVisible(false);
        setKeyboardHeight(0);
        lastFocusedInputRef.current = null;
      };

      const showSub = Keyboard.addListener(showEvent, onKeyboardShow);
      const hideSub = Keyboard.addListener(hideEvent, onKeyboardHide);

      return () => {
        showSub.remove();
        hideSub.remove();
      };
    }, [autoScrollToFocusedInput, scrollIntoView]);

    // Active input watcher while keyboard is open:
    // Detects when user switches fields without keyboard closing
    useEffect(() => {
      if (!isKeyboardVisible || !autoScrollToFocusedInput) return;

      const interval = setInterval(() => {
        const currentInput = TextInput.State?.currentlyFocusedInput?.() ?? null;
        if (currentInput && currentInput !== lastFocusedInputRef.current) {
          lastFocusedInputRef.current = currentInput;
          scrollIntoView(currentInput);
        }
      }, 150);

      return () => clearInterval(interval);
    }, [isKeyboardVisible, autoScrollToFocusedInput, scrollIntoView]);

    // Content size change: re-verify visibility if layout shifted while typing
    const handleContentSizeChange = useCallback(
      (w: number, h: number) => {
        onContentSizeChange?.(w, h);
        if (isKeyboardVisible && autoScrollToFocusedInput && !isAutoScrollingRef.current) {
          setTimeout(() => {
            scrollIntoView();
          }, 80);
        }
      },
      [onContentSizeChange, isKeyboardVisible, autoScrollToFocusedInput, scrollIntoView]
    );

    // Touch end: re-check focus when user taps around in scrollview while keyboard is open
    const handleTouchEnd = useCallback(
      (e: any) => {
        onTouchEnd?.(e);
        if (isKeyboardVisible && autoScrollToFocusedInput) {
          setTimeout(() => {
            const currentInput = TextInput.State?.currentlyFocusedInput?.() ?? null;
            if (currentInput) {
              scrollIntoView(currentInput);
            }
          }, 100);
        }
      },
      [onTouchEnd, isKeyboardVisible, autoScrollToFocusedInput, scrollIntoView]
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
              footer ? { paddingBottom: extraScrollPadding + spacing.xl } : undefined,
            ]}
            keyboardShouldPersistTaps={keyboardShouldPersistTaps}
            showsVerticalScrollIndicator={showsVerticalScrollIndicator}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onLayout={handleLayout}
            onContentSizeChange={handleContentSizeChange}
            onTouchEnd={handleTouchEnd}
            {...scrollViewProps}
          >
            {children}
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
  footerContainer: {
    width: '100%',
  },
});

export { KeyboardAwareScrollView };
export default KeyboardAwareScrollView;
