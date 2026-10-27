import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { formatToE164 } from './phoneUtils';

const COOLDOWN_STORAGE_KEY = '@multipleride/otp_cooldowns_v1';
export const DEFAULT_COOLDOWN_SECONDS = 60;

/**
 * Service-level manager that tracks per-phone OTP cooldown expiration timestamps.
 * Cooldowns survive navigation, component remounts, and app restarts.
 * Only expiration timestamps are persisted; NO tokens, OTP codes, or secrets are stored.
 */
export class OtpCooldownManager {
  private static instance: OtpCooldownManager | null = null;

  // Normalized E.164 phone -> Expiration timestamp in epoch milliseconds
  private cooldowns: Map<string, number> = new Map();
  private subscribers: Set<() => void> = new Set();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private isLoaded: boolean = false;
  private loadPromise: Promise<void> | null = null;

  private constructor() {
    this.loadPromise = this.loadFromStorage();
  }

  public static getInstance(): OtpCooldownManager {
    if (!OtpCooldownManager.instance) {
      OtpCooldownManager.instance = new OtpCooldownManager();
    }
    return OtpCooldownManager.instance;
  }

  /**
   * Loads persisted cooldown records from AsyncStorage and prunes expired ones.
   */
  private async loadFromStorage(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(COOLDOWN_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const now = Date.now();
          let hasExpired = false;
          for (const [phone, expiresAt] of Object.entries(parsed)) {
            if (typeof expiresAt === 'number' && expiresAt > now) {
              this.cooldowns.set(phone, expiresAt);
            } else {
              hasExpired = true;
            }
          }
          if (hasExpired) {
            void this.persistToStorage();
          }
        }
      }
    } catch (e) {
      console.warn('[OtpCooldownManager] Error loading persisted cooldowns:', e);
    } finally {
      this.isLoaded = true;
      if (this.cooldowns.size > 0) {
        this.startTicker();
      }
      this.notifySubscribers();
    }
  }

  /**
   * Prunes expired records and saves the minimal record to AsyncStorage.
   */
  private async persistToStorage(): Promise<void> {
    try {
      const now = Date.now();
      const payload: Record<string, number> = {};
      for (const [phone, expiresAt] of this.cooldowns.entries()) {
        if (expiresAt > now) {
          payload[phone] = expiresAt;
        }
      }
      await AsyncStorage.setItem(COOLDOWN_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('[OtpCooldownManager] Error saving cooldowns:', e);
    }
  }

  /**
   * Returns the remaining cooldown in seconds for a specific phone number.
   * Returns 0 if there is no active cooldown or if the phone number is invalid.
   */
  public getRemaining(phone: string): number {
    let normalized: string;
    try {
      normalized = formatToE164(phone);
    } catch {
      return 0;
    }

    const expiresAt = this.cooldowns.get(normalized);
    if (!expiresAt) return 0;

    const remainingSec = Math.ceil((expiresAt - Date.now()) / 1000);
    if (remainingSec <= 0) {
      this.cooldowns.delete(normalized);
      void this.persistToStorage();
      if (this.cooldowns.size === 0) {
        this.stopTicker();
      }
      return 0;
    }

    return remainingSec;
  }

  /**
   * Sets a cooldown for a specific phone number.
   * Keyed strictly by normalized E.164 phone number.
   */
  public setCooldown(phone: string, seconds: number = DEFAULT_COOLDOWN_SECONDS): number {
    let normalized: string;
    try {
      normalized = formatToE164(phone);
    } catch {
      return 0;
    }

    const expiresAt = Date.now() + seconds * 1000;
    this.cooldowns.set(normalized, expiresAt);
    void this.persistToStorage();
    this.startTicker();
    this.notifySubscribers();
    return seconds;
  }

  /**
   * Clears the cooldown for a specific phone number.
   */
  public clearCooldown(phone: string): void {
    let normalized: string;
    try {
      normalized = formatToE164(phone);
    } catch {
      return;
    }

    if (this.cooldowns.has(normalized)) {
      this.cooldowns.delete(normalized);
      void this.persistToStorage();
      if (this.cooldowns.size === 0) {
        this.stopTicker();
      }
      this.notifySubscribers();
    }
  }

  /**
   * Subscribes a listener to cooldown ticks and updates.
   * Returns an unsubscribe function.
   */
  public subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private notifySubscribers(): void {
    this.subscribers.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.warn('[OtpCooldownManager] Listener error:', e);
      }
    });
  }

  private startTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => {
      const now = Date.now();
      let hasChanges = false;
      for (const [phone, expiresAt] of this.cooldowns.entries()) {
        if (expiresAt <= now) {
          this.cooldowns.delete(phone);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        void this.persistToStorage();
      }

      if (this.cooldowns.size === 0) {
        this.stopTicker();
      }

      this.notifySubscribers();
    }, 1000);
  }

  private stopTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }
}

/**
 * React hook that provides real-time per-phone cooldown countdown and state.
 * Automatically recalculates when the entered phone number changes, when seconds tick,
 * and when the app resumes from the background.
 */
export function usePhoneCooldown(phoneNumber: string): {
  cooldownRemaining: number;
  isCoolingDown: boolean;
  normalizedPhone: string | null;
} {
  const manager = OtpCooldownManager.getInstance();

  const getNormalized = useCallback((): string | null => {
    try {
      return formatToE164(phoneNumber);
    } catch {
      return null;
    }
  }, [phoneNumber]);

  const normalizedPhone = getNormalized();

  const [remaining, setRemaining] = useState<number>(() => {
    return normalizedPhone ? manager.getRemaining(normalizedPhone) : 0;
  });

  const prevPhoneRef = useRef<string | null>(normalizedPhone);
  if (prevPhoneRef.current !== normalizedPhone) {
    prevPhoneRef.current = normalizedPhone;
    const initialForNewPhone = normalizedPhone ? manager.getRemaining(normalizedPhone) : 0;
    setRemaining(initialForNewPhone);
  }

  useEffect(() => {
    const update = () => {
      const current = normalizedPhone ? manager.getRemaining(normalizedPhone) : 0;
      setRemaining(current);
    };

    update();
    const unsubscribe = manager.subscribe(update);

    const appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        update();
      }
    });

    return () => {
      unsubscribe();
      appStateSub.remove();
    };
  }, [normalizedPhone, manager]);

  return {
    cooldownRemaining: remaining,
    isCoolingDown: remaining > 0,
    normalizedPhone,
  };
}
