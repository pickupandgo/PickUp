import AsyncStorage from '@react-native-async-storage/async-storage';
import { FloatingBubbleService } from '../src/services/overlay/FloatingBubbleService';

describe('MultipleRide Driver App - Floating Circular Overlay Bubble', () => {
  let service: FloatingBubbleService;

  beforeEach(async () => {
    service = FloatingBubbleService.getInstance();
    service.__resetForTesting();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    await service.initialize();
  });

  afterEach(async () => {
    await service.hideBubble();
  });

  it('1. Initializes with default enabled state and persists user preference to AsyncStorage', async () => {
    expect(service.isFeatureEnabled()).toBe(true);

    await service.setFeatureEnabled(false);
    expect(service.isFeatureEnabled()).toBe(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('pickup.driver.floating_bubble_enabled', 'false');

    await service.setFeatureEnabled(true);
    expect(service.isFeatureEnabled()).toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('pickup.driver.floating_bubble_enabled', 'true');
  });

  it('2. Checks and requests SYSTEM_ALERT_WINDOW overlay permission gracefully', async () => {
    const canDraw = await service.canDrawOverlays();
    expect(typeof canDraw).toBe('boolean');

    const requested = await service.requestOverlayPermission();
    expect(requested).toBe(true);
  });

  it('3. Notifies subscribers when feature toggle state changes in Settings', async () => {
    const mockListener = jest.fn();
    const unsubscribe = service.subscribe(mockListener);

    // Initial subscriber call
    expect(mockListener).toHaveBeenCalledWith(true);

    await service.setFeatureEnabled(false);
    expect(mockListener).toHaveBeenCalledWith(false);

    await service.setFeatureEnabled(true);
    expect(mockListener).toHaveBeenCalledWith(true);

    unsubscribe();
  });

  it('4. Shows bubble only when feature is enabled and driver state is eligible (Online/Trip)', async () => {
    await service.setFeatureEnabled(true);

    // Driver is initially not eligible (e.g. offline) -> showBubble fails
    await service.syncDriverState(false);
    const shownWhenOffline = await service.showBubble();
    expect(shownWhenOffline).toBe(false);
    expect(await service.isBubbleShowing()).toBe(false);

    // Driver goes Online / Active Trip -> eligible -> showBubble succeeds
    await service.syncDriverState(true);
    const shownWhenOnline = await service.showBubble();
    expect(shownWhenOnline).toBe(true);
    expect(await service.isBubbleShowing()).toBe(true);
  });

  it('5. Avoids duplicate bubbles across repeated show requests', async () => {
    await service.setFeatureEnabled(true);
    await service.syncDriverState(true);

    const firstShow = await service.showBubble();
    expect(firstShow).toBe(true);

    // Repeated minimize requests do not create duplicate bubbles
    const secondShow = await service.showBubble();
    expect(secondShow).toBe(true);
    expect(await service.isBubbleShowing()).toBe(true);
  });

  it('6. Hides bubble immediately when driver transitions to Offline or logs out', async () => {
    await service.setFeatureEnabled(true);
    await service.syncDriverState(true);
    await service.showBubble();
    expect(await service.isBubbleShowing()).toBe(true);

    // Driver goes Offline or logs out
    await service.syncDriverState(false);
    expect(await service.isBubbleShowing()).toBe(false);

    // Direct hideBubble call succeeds
    const hidden = await service.hideBubble();
    expect(hidden).toBe(true);
    expect(await service.isBubbleShowing()).toBe(false);
  });

  it('7. Suppresses bubble display when user has disabled the feature in Settings', async () => {
    await service.setFeatureEnabled(false);
    await service.syncDriverState(true);

    const shown = await service.showBubble();
    expect(shown).toBe(false);
    expect(await service.isBubbleShowing()).toBe(false);
  });
});
