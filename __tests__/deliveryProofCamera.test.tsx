import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { CameraOverlay } from '../src/components/organisms/CameraOverlay';
import { DeliveryProofCameraScreen } from '../src/screens/trip/DeliveryProofCameraScreen';

jest.mock('../src/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: 'en',
    setLocale: jest.fn(),
  }),
}));

describe('CameraOverlay & DeliveryProofCameraScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('CameraOverlay component', () => {
    it('renders title, instructions, and shutter button', () => {
      const onCapture = jest.fn();
      let renderer: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        renderer = ReactTestRenderer.create(
          <CameraOverlay
            title="Delivery Photo"
            instructions="Position the package clearly within the frame"
            captureLabel="CAPTURE"
            onCapture={onCapture}
          />
        );
      });

      const root = renderer!.root;
      const texts = root.findAllByType(Text);
      const stringContents = texts.map((t) => t.props.children);

      expect(stringContents).toContain('Delivery Photo');
      expect(stringContents).toContain('Position the package clearly within the frame');

      const captureBtn = root.findByProps({ accessibilityLabel: 'CAPTURE' });
      expect(captureBtn).toBeDefined();

      act(() => {
        captureBtn.props.onPress();
      });
      expect(onCapture).toHaveBeenCalledTimes(1);
    });

    it('renders back button when onBack is provided and calls onBack when pressed', () => {
      const onCapture = jest.fn();
      const onBack = jest.fn();
      let renderer: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        renderer = ReactTestRenderer.create(
          <CameraOverlay
            title="Delivery Photo"
            instructions="Position the package clearly within the frame"
            captureLabel="CAPTURE"
            onCapture={onCapture}
            onBack={onBack}
          />
        );
      });

      const root = renderer!.root;
      const backBtn = root.findByProps({ accessibilityLabel: 'Back' });
      expect(backBtn).toBeDefined();

      act(() => {
        backBtn.props.onPress();
      });
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('DeliveryProofCameraScreen auto-access flow', () => {
    it('automatically launches camera on mount without requiring manual shutter button tap', async () => {
      (launchCamera as jest.Mock).mockResolvedValueOnce({
        didCancel: false,
        assets: [{ uri: 'file:///path/to/captured_proof.jpg' }],
      });

      const mockReplace = jest.fn();
      const mockGoBack = jest.fn();
      const navigation = {
        replace: mockReplace,
        navigate: jest.fn(),
        goBack: mockGoBack,
      } as any;
      const route = {
        params: {
          tripId: 'trip-123',
          stopId: 'stop-456',
        },
      } as any;

      let renderer: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        renderer = ReactTestRenderer.create(
          <DeliveryProofCameraScreen navigation={navigation} route={route} />
        );
      });

      // Advance timers by 50ms so auto-launch timer triggers
      await act(async () => {
        jest.advanceTimersByTime(60);
      });

      expect(launchCamera).toHaveBeenCalledTimes(1);
      expect(launchCamera).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: 'photo',
          cameraType: 'back',
        })
      );

      // Successfully replaces to DeliveryProofPreview with captured photo URI
      expect(mockReplace).toHaveBeenCalledWith('DeliveryProofPreview', {
        tripId: 'trip-123',
        stopId: 'stop-456',
        photoUri: 'file:///path/to/captured_proof.jpg',
      });
    });

    it('stays on screen when driver cancels camera, allowing manual retry via shutter button', async () => {
      (launchCamera as jest.Mock).mockResolvedValueOnce({
        didCancel: true,
      });

      const mockReplace = jest.fn();
      const mockGoBack = jest.fn();
      const navigation = {
        replace: mockReplace,
        navigate: jest.fn(),
        goBack: mockGoBack,
      } as any;
      const route = {
        params: {
          tripId: 'trip-123',
          stopId: 'stop-456',
        },
      } as any;

      let renderer: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        renderer = ReactTestRenderer.create(
          <DeliveryProofCameraScreen navigation={navigation} route={route} />
        );
      });

      await act(async () => {
        jest.advanceTimersByTime(60);
      });

      expect(launchCamera).toHaveBeenCalledTimes(1);
      // Did not replace to preview because user cancelled
      expect(mockReplace).not.toHaveBeenCalled();

      // Now driver manually taps shutter button to retry
      (launchCamera as jest.Mock).mockResolvedValueOnce({
        didCancel: false,
        assets: [{ uri: 'file:///path/to/second_attempt.jpg' }],
      });

      const root = renderer!.root;
      const captureBtn = root.findByProps({ accessibilityLabel: 'deliveryProof.capture' });

      await act(async () => {
        captureBtn.props.onPress();
      });

      expect(launchCamera).toHaveBeenCalledTimes(2);
      expect(mockReplace).toHaveBeenCalledWith('DeliveryProofPreview', {
        tripId: 'trip-123',
        stopId: 'stop-456',
        photoUri: 'file:///path/to/second_attempt.jpg',
      });
    });

    it('navigates back when driver taps the back button on camera overlay', async () => {
      (launchCamera as jest.Mock).mockResolvedValueOnce({
        didCancel: true,
      });

      const mockGoBack = jest.fn();
      const navigation = {
        replace: jest.fn(),
        navigate: jest.fn(),
        goBack: mockGoBack,
      } as any;
      const route = {
        params: {
          tripId: 'trip-123',
          stopId: 'stop-456',
        },
      } as any;

      let renderer: ReactTestRenderer.ReactTestRenderer;
      act(() => {
        renderer = ReactTestRenderer.create(
          <DeliveryProofCameraScreen navigation={navigation} route={route} />
        );
      });

      await act(async () => {
        jest.advanceTimersByTime(60);
      });

      const root = renderer!.root;
      const backBtn = root.findByProps({ accessibilityLabel: 'Back' });
      act(() => {
        backBtn.props.onPress();
      });

      expect(mockGoBack).toHaveBeenCalledTimes(1);
    });
  });
});
