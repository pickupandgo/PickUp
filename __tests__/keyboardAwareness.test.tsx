import React from 'react';
import { Keyboard, Platform, Text, TextInput, View } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import DraggableBottomSheet from '../src/components/organisms/DraggableBottomSheet';
import KeyboardAwareScrollView, {
  useKeyboardAware,
  type KeyboardAwareScrollViewRef,
} from '../src/components/organisms/KeyboardAwareScrollView';
import InputField from '../src/components/atoms/InputField';

describe('Keyboard Awareness & Auto-Adjustment', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('DraggableBottomSheet registers keyboard listeners and cleans them up on unmount', () => {
    const removeMock = jest.fn();
    const addListenerSpy = jest.spyOn(Keyboard, 'addListener').mockReturnValue({ remove: removeMock } as any);

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <DraggableBottomSheet snapPoints={[100, 300, 600]}>
          <Text>Sheet Content</Text>
        </DraggableBottomSheet>
      );
    });

    expect(addListenerSpy).toHaveBeenCalledWith(
      expect.stringMatching(/keyboard(Will|Did)Show/),
      expect.any(Function)
    );
    expect(addListenerSpy).toHaveBeenCalledWith(
      expect.stringMatching(/keyboard(Will|Did)Hide/),
      expect.any(Function)
    );

    act(() => {
      renderer?.unmount();
    });
    expect(removeMock).toHaveBeenCalledTimes(2);
  });

  it('DraggableBottomSheet dynamically adjusts padding and height when keyboard opens', () => {
    let showCallback: ((e: any) => void) | undefined;
    let hideCallback: (() => void) | undefined;

    jest.spyOn(Keyboard, 'addListener').mockImplementation((event: string, cb: any) => {
      if (event.includes('Show')) showCallback = cb;
      if (event.includes('Hide')) hideCallback = cb;
      return { remove: jest.fn() } as any;
    });

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <DraggableBottomSheet snapPoints={[100, 300, 600]}>
          <Text>Form Input Inside Sheet</Text>
        </DraggableBottomSheet>
      );
    });

    expect(JSON.stringify(renderer?.toJSON())).toContain('100');

    act(() => {
      showCallback?.({ endCoordinates: { height: 320 } });
      jest.advanceTimersByTime(100);
    });

    const expectedPadding = Platform.OS === 'ios' ? '336' : '16';
    expect(JSON.stringify(renderer?.toJSON())).toContain(expectedPadding);

    act(() => {
      hideCallback?.();
      jest.advanceTimersByTime(100);
    });

    expect(JSON.stringify(renderer?.toJSON())).toContain('100');
  });

  it('KeyboardAwareScrollView renders children, pinned footer, and registers cleanup', () => {
    const removeMock = jest.fn();
    const addListenerSpy = jest.spyOn(Keyboard, 'addListener').mockReturnValue({ remove: removeMock } as any);

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <KeyboardAwareScrollView
          footer={
            <View>
              <Text>CONFIRM AND PROCEED</Text>
            </View>
          }
        >
          <View>
            <Text>Receiver Name</Text>
            <TextInput value="John Doe" />
          </View>
        </KeyboardAwareScrollView>
      );
    });

    const str = JSON.stringify(renderer?.toJSON());
    expect(str).toContain('Receiver Name');
    expect(str).toContain('CONFIRM AND PROCEED');
    expect(str).toContain('handled');

    expect(addListenerSpy).toHaveBeenCalledWith(
      expect.stringMatching(/keyboard(Will|Did)Show/),
      expect.any(Function)
    );

    act(() => {
      renderer?.unmount();
    });
    expect(removeMock).toHaveBeenCalled();
    expect(removeMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('calculates auto-scroll when focused field is near or below the visible viewport', () => {
    let showCallback: ((e: any) => void) | undefined;
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event: string, cb: any) => {
      if (event.includes('Show')) showCallback = cb;
      return { remove: jest.fn() } as any;
    });

    const ref = React.createRef<any>();
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = TestRenderer.create(
        <KeyboardAwareScrollView
          ref={ref}
          footer={
            <View>
              <Text>STICKY BUTTON</Text>
            </View>
          }
        >
          <View style={{ height: 1000 }}>
            <TextInput testID="field-at-bottom" />
          </View>
        </KeyboardAwareScrollView>
      );
    });

    const scrollViewInstance = renderer?.root.findByType('RCTScrollView' as any);
    expect(scrollViewInstance).toBeDefined();

    // Mock scrollTo on the underlying native ScrollView instance
    const scrollToMock = jest.fn();
    const nativeScrollRef = ref.current?.getScrollRef?.();
    if (nativeScrollRef) {
      nativeScrollRef.scrollTo = scrollToMock;
    }

    // Set container layout height to 400
    act(() => {
      (scrollViewInstance?.props as any)?.onLayout?.({
        nativeEvent: { layout: { height: 400, width: 360, x: 0, y: 0 } },
      });
    });

    // Mock an input target positioned at top: 350, height: 50.
    // effectiveVisibleHeight: 400. inputBottom: 350 + 50 + 20 = 420 > 400.
    // It is partly hidden, so it MUST auto-scroll!
    const mockInput = {
      measureLayout: jest.fn((relativeTo, onSuccess) => {
        onSuccess(0, 350, 300, 50);
      }),
    };

    act(() => {
      ref.current?.scrollIntoView(mockInput);
      jest.advanceTimersByTime(200);
    });

    expect(mockInput.measureLayout).toHaveBeenCalled();
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({
        y: expect.any(Number),
        animated: true,
      })
    );
  });

  it('no-ops auto-scroll if the focused field is already comfortably within visible viewport', () => {
    const ref = React.createRef<any>();
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = TestRenderer.create(
        <KeyboardAwareScrollView ref={ref}>
          <View style={{ height: 600 }}>
            <TextInput testID="field-top" />
          </View>
        </KeyboardAwareScrollView>
      );
    });

    const scrollViewInstance = renderer?.root.findByType('RCTScrollView' as any);
    const scrollToMock = jest.fn();
    const nativeScrollRef = ref.current?.getScrollRef?.();
    if (nativeScrollRef) {
      nativeScrollRef.scrollTo = scrollToMock;
    }

    // Container height: 500, scroll Y: 0
    act(() => {
      (scrollViewInstance?.props as any)?.onLayout?.({
        nativeEvent: { layout: { height: 500, width: 360, x: 0, y: 0 } },
      });
      (scrollViewInstance?.props as any)?.onScroll?.({
        nativeEvent: { contentOffset: { y: 0, x: 0 } },
      });
    });

    // Input top at 50, height 40. inputBottom: 110, visibleBottom: 500. Fully visible!
    const mockInput = {
      measureLayout: jest.fn((relativeTo, onSuccess) => {
        onSuccess(0, 50, 300, 40);
      }),
    };

    act(() => {
      ref.current?.scrollIntoView(mockInput);
      jest.advanceTimersByTime(200);
    });

    expect(mockInput.measureLayout).toHaveBeenCalled();
    expect(scrollToMock).not.toHaveBeenCalled();
  });

  it('InputField connects with KeyboardAwareContext and notifies scrollToInput on focus', () => {
    let focusNotified = false;
    const TestConsumer = () => {
      return (
        <View>
          <InputField
            label="Full Name"
            placeholder="Enter name"
            value="Alice"
            onChangeText={() => {}}
            onFocus={() => {
              focusNotified = true;
            }}
          />
        </View>
      );
    };

    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <KeyboardAwareScrollView>
          <TestConsumer />
        </KeyboardAwareScrollView>
      );
    });

    const textInput = renderer?.root.findByType(TextInput);
    expect(textInput).toBeDefined();

    act(() => {
      (textInput?.props as any)?.onFocus?.({ nativeEvent: {} });
      jest.advanceTimersByTime(100);
    });

    expect(focusNotified).toBe(true);
  });

  it('detects layout shift on content size changes while keyboard is open', () => {
    let showCallback: ((e: any) => void) | undefined;
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event: string, cb: any) => {
      if (event.includes('Show')) showCallback = cb;
      return { remove: jest.fn() } as any;
    });

    const onContentSizeChangeProp = jest.fn();
    const ref = React.createRef<any>();
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = TestRenderer.create(
        <KeyboardAwareScrollView ref={ref} onContentSizeChange={onContentSizeChangeProp}>
          <Text>Form Content</Text>
        </KeyboardAwareScrollView>
      );
    });

    // Keyboard opens
    act(() => {
      showCallback?.({ endCoordinates: { height: 280 } });
      jest.advanceTimersByTime(100);
    });

    const scrollView = renderer?.root.findByType('RCTScrollView' as any);

    // Content size expands (e.g. error message renders under field)
    act(() => {
      (scrollView?.props as any)?.onContentSizeChange?.(360, 850);
      jest.advanceTimersByTime(150);
    });

    expect(onContentSizeChangeProp).toHaveBeenCalledWith(360, 850);
  });

  it('dynamic footer height increases content bottom padding so sticky buttons do not obstruct inputs', () => {
    let renderer: ReactTestRenderer | undefined;
    const ref = React.createRef<any>();

    act(() => {
      renderer = TestRenderer.create(
        <KeyboardAwareScrollView
          ref={ref}
          footer={
            <View testID="footer-view">
              <Text>CONFIRM & PROCEED</Text>
            </View>
          }
        >
          <View>
            <TextInput testID="input-1" />
          </View>
        </KeyboardAwareScrollView>
      );
    });

    const footerView = (renderer?.root as any)?.findByProps({ testID: 'footer-view' });
    const footerContainer = footerView?.parent;

    // Simulate footer layout measurement with height = 90
    act(() => {
      (footerContainer?.props as any)?.onLayout?.({
        nativeEvent: { layout: { height: 90, width: 360, x: 0, y: 0 } },
      });
      jest.advanceTimersByTime(100);
    });

    const scrollView = renderer?.root.findByType('RCTScrollView' as any);
    const contentStyle = (scrollView?.props as any)?.contentContainerStyle;
    const flattened = Array.isArray(contentStyle)
      ? Object.assign({}, ...contentStyle.filter(Boolean))
      : contentStyle;

    // paddingBottom should include footerHeight (90) + finalExtraPadding (20) + spacing.md (16) = 126
    expect(flattened?.paddingBottom).toBeGreaterThanOrEqual(120);
  });

  it('switching fields while keyboard is open triggers auto-scroll to newly focused field', () => {
    let showCallback: ((e: any) => void) | undefined;
    jest.spyOn(Keyboard, 'addListener').mockImplementation((event: string, cb: any) => {
      if (event.includes('Show')) showCallback = cb;
      return { remove: jest.fn() } as any;
    });

    const ref = React.createRef<any>();
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = TestRenderer.create(
        <KeyboardAwareScrollView
          ref={ref}
          footer={
            <View>
              <Text>ACTION BUTTON</Text>
            </View>
          }
        >
          <View style={{ height: 1200 }}>
            <TextInput testID="field-1" />
            <TextInput testID="field-2" />
          </View>
        </KeyboardAwareScrollView>
      );
    });

    const scrollViewInstance = renderer?.root.findByType('RCTScrollView' as any);
    const scrollToMock = jest.fn();
    const nativeScrollRef = ref.current?.getScrollRef?.();
    if (nativeScrollRef) {
      nativeScrollRef.scrollTo = scrollToMock;
    }

    // Set container height to 380 (shrunk by keyboard)
    act(() => {
      (scrollViewInstance?.props as any)?.onLayout?.({
        nativeEvent: { layout: { height: 380, width: 360, x: 0, y: 0 } },
      });
      showCallback?.({ endCoordinates: { height: 300 } });
      jest.advanceTimersByTime(100);
    });

    // Mock field 1 (already at top: 40)
    const mockInput1 = {
      measureLayout: jest.fn((relativeTo, onSuccess) => {
        onSuccess(0, 40, 300, 40);
      }),
    };

    act(() => {
      ref.current?.scrollIntoView(mockInput1);
      jest.advanceTimersByTime(200);
    });

    expect(scrollToMock).not.toHaveBeenCalled();

    // Now user switches to field 2 (positioned near bottom at top: 320, height: 48)
    // effectiveVisibleHeight: 380 - 76 = 304. inputBottom = 320 + 48 + 20 = 388 > 304!
    const mockInput2 = {
      measureLayout: jest.fn((relativeTo, onSuccess) => {
        onSuccess(0, 320, 300, 48);
      }),
    };

    act(() => {
      ref.current?.scrollIntoView(mockInput2);
      jest.advanceTimersByTime(200);
    });

    expect(mockInput2.measureLayout).toHaveBeenCalled();
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({
        y: expect.any(Number),
        animated: true,
      })
    );
  });

  it('handles missing container measurement safely and retries when layout becomes available', () => {
    const ref = React.createRef<any>();
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = TestRenderer.create(
        <KeyboardAwareScrollView ref={ref}>
          <View style={{ height: 1000 }}>
            <TextInput testID="delayed-layout-field" />
          </View>
        </KeyboardAwareScrollView>
      );
    });

    const scrollViewInstance = renderer?.root.findByType('RCTScrollView' as any);
    const scrollToMock = jest.fn();
    const nativeScrollRef = ref.current?.getScrollRef?.();
    if (nativeScrollRef) {
      nativeScrollRef.scrollTo = scrollToMock;
    }

    const mockInput = {
      measureLayout: jest.fn((relativeTo, onSuccess) => {
        onSuccess(0, 350, 300, 50);
      }),
    };

    // Before onLayout fires, containerHeight is 0. Calling scrollIntoView should NOT guess or crash.
    act(() => {
      ref.current?.scrollIntoView(mockInput);
      jest.advanceTimersByTime(100);
    });

    // Should not scroll yet since layout wasn't ready
    expect(scrollToMock).not.toHaveBeenCalled();

    // Now layout arrives with height: 320
    act(() => {
      (scrollViewInstance?.props as any)?.onLayout?.({
        nativeEvent: { layout: { height: 320, width: 360, x: 0, y: 0 } },
      });
      jest.advanceTimersByTime(100);
    });

    // Pending scroll request is now fulfilled!
    expect(mockInput.measureLayout).toHaveBeenCalled();
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({
        y: expect.any(Number),
        animated: true,
      })
    );
  });

  it('deduplicates rapid repeated focus events on the same input to prevent jitter', () => {
    const ref = React.createRef<any>();
    let renderer: ReactTestRenderer | undefined;

    act(() => {
      renderer = TestRenderer.create(
        <KeyboardAwareScrollView ref={ref}>
          <View>
            <TextInput testID="single-input" />
          </View>
        </KeyboardAwareScrollView>
      );
    });

    const scrollViewInstance = renderer?.root.findByType('RCTScrollView' as any);
    const scrollToMock = jest.fn();
    const nativeScrollRef = ref.current?.getScrollRef?.();
    if (nativeScrollRef) {
      nativeScrollRef.scrollTo = scrollToMock;
    }

    act(() => {
      (scrollViewInstance?.props as any)?.onLayout?.({
        nativeEvent: { layout: { height: 300, width: 360, x: 0, y: 0 } },
      });
    });

    const mockNode = {
      measureLayout: jest.fn((relativeTo, onSuccess) => {
        onSuccess(0, 280, 300, 50);
      }),
    };

    // Simulate event bubbling to ScrollView onFocus twice within 20ms
    act(() => {
      (scrollViewInstance?.props as any)?.onFocus?.({ target: mockNode });
      (scrollViewInstance?.props as any)?.onFocus?.({ target: mockNode });
      jest.advanceTimersByTime(100);
    });

    // Deduplicated: measureLayout should only be triggered once
    expect(mockNode.measureLayout).toHaveBeenCalledTimes(1);
  });
});
