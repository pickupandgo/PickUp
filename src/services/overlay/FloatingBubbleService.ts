import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface FloatingBubbleModuleInterface {
  canDrawOverlays(): Promise<boolean>;
  requestOverlayPermission(): Promise<boolean>;
  setFeatureEnabled(enabled: boolean): Promise<boolean>;
  setDriverEligible(eligible: boolean): Promise<boolean>;
  showBubble(): Promise<boolean>;
  hideBubble(): Promise<boolean>;
  isBubbleShowing(): Promise<boolean>;
}

const STORAGE_KEY = 'pickup.driver.floating_bubble_enabled';

// Mock implementation for Jest unit testing and non-Android environments
class MockFloatingBubbleModule implements FloatingBubbleModuleInterface {
  private _canDraw = true;
  private _enabled = false;
  private _eligible = false;
  private _showing = false;

  async canDrawOverlays(): Promise<boolean> {
    return this._canDraw;
  }

  async requestOverlayPermission(): Promise<boolean> {
    this._canDraw = true;
    return true;
  }

  async setFeatureEnabled(enabled: boolean): Promise<boolean> {
    this._enabled = enabled;
    if (!enabled) this._showing = false;
    return true;
  }

  async setDriverEligible(eligible: boolean): Promise<boolean> {
    this._eligible = eligible;
    if (!eligible) this._showing = false;
    return true;
  }

  async showBubble(): Promise<boolean> {
    if (this._canDraw && this._enabled && this._eligible) {
      this._showing = true;
      return true;
    }
    return false;
  }

  async hideBubble(): Promise<boolean> {
    this._showing = false;
    return true;
  }

  async isBubbleShowing(): Promise<boolean> {
    return this._showing;
  }

  // Test helpers
  __setCanDraw(val: boolean) {
    this._canDraw = val;
  }
  __getState() {
    return { canDraw: this._canDraw, enabled: this._enabled, eligible: this._eligible, showing: this._showing };
  }
}

const nativeModule: FloatingBubbleModuleInterface =
  Platform.OS === 'android' && NativeModules.FloatingBubbleModule
    ? NativeModules.FloatingBubbleModule
    : new MockFloatingBubbleModule();

type StateListener = (enabled: boolean) => void;

export class FloatingBubbleService {
  private static instance: FloatingBubbleService | null = null;
  private enabled = false;
  private initialized = false;
  private listeners: Set<StateListener> = new Set();

  static getInstance(): FloatingBubbleService {
    if (!this.instance) {
      this.instance = new FloatingBubbleService();
    }
    return this.instance;
  }

  __resetForTesting() {
    this.enabled = true;
    this.initialized = false;
    this.listeners.clear();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      // Default to enabled if user hasn't explicitly disabled it
      const isEnabled = stored !== null ? stored === 'true' : true;
      this.enabled = isEnabled;
      await nativeModule.setFeatureEnabled(isEnabled);
    } catch {
      this.enabled = false;
    } finally {
      this.initialized = true;
    }
  }

  async canDrawOverlays(): Promise<boolean> {
    try {
      return await nativeModule.canDrawOverlays();
    } catch {
      return false;
    }
  }

  async requestOverlayPermission(): Promise<boolean> {
    try {
      return await nativeModule.requestOverlayPermission();
    } catch {
      return false;
    }
  }

  isFeatureEnabled(): boolean {
    return this.enabled;
  }

  async setFeatureEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, String(enabled));
      await nativeModule.setFeatureEnabled(enabled);
      this.notifyListeners(enabled);
    } catch (err) {
      console.warn('[FloatingBubble] Error saving feature preference:', err);
    }
  }

  async syncDriverState(isEligible: boolean): Promise<void> {
    try {
      await nativeModule.setDriverEligible(isEligible);
    } catch (err) {
      console.warn('[FloatingBubble] Error updating driver state:', err);
    }
  }

  async showBubble(): Promise<boolean> {
    try {
      return await nativeModule.showBubble();
    } catch {
      return false;
    }
  }

  async hideBubble(): Promise<boolean> {
    try {
      return await nativeModule.hideBubble();
    } catch {
      return false;
    }
  }

  async isBubbleShowing(): Promise<boolean> {
    try {
      return await nativeModule.isBubbleShowing();
    } catch {
      return false;
    }
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.enabled);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(enabled: boolean) {
    this.listeners.forEach((listener) => {
      try {
        listener(enabled);
      } catch (e) {
        console.error('[FloatingBubble] Listener error:', e);
      }
    });
  }
}

export const floatingBubbleService = FloatingBubbleService.getInstance();
