import { en, hi } from '../src/i18n';

describe('i18n Localization Suite', () => {
  // Test 1: Full 1:1 key parity between en and hi
  describe('Key Parity & Integrity', () => {
    it('should have exactly the same number of keys in EN and HI', () => {
      const enKeys = Object.keys(en);
      const hiKeys = Object.keys(hi);
      expect(enKeys.length).toBe(hiKeys.length);
      expect(enKeys.length).toBeGreaterThan(600);
    });

    it('should have 100% 1:1 key parity between en and hi with 0 missing keys', () => {
      const enKeys = Object.keys(en);
      const hiKeys = new Set(Object.keys(hi));

      const missingInHi = enKeys.filter(k => !hiKeys.has(k));
      expect(missingInHi).toEqual([]);

      const enKeySet = new Set(enKeys);
      const missingInEn = Object.keys(hi).filter(k => !enKeySet.has(k));
      expect(missingInEn).toEqual([]);
    });

    it('should not contain empty string translations in en or hi', () => {
      for (const [key, val] of Object.entries(en)) {
        expect(typeof val).toBe('string');
        expect(val.trim().length).toBeGreaterThan(0);
      }
      for (const [key, val] of Object.entries(hi)) {
        expect(typeof val).toBe('string');
        expect(val.trim().length).toBeGreaterThan(0);
      }
    });
  });

  // Test 2: Requirement 2 exact string values verification
  describe('Requirement 2: Language Selection Exact Strings', () => {
    it('should match exact English specifications for Requirement 2', () => {
      expect(en['language.title']).toBe('Language');
      expect(en['language.subtitle']).toBe('Select your preferred language for the Customer app.');
      expect(en['language.english']).toBe('English');
      expect(en['language.hindi']).toBe('Hindi');
      expect(en['language.confirm']).toBe('Confirm');
    });

    it('should match exact Hindi specifications for Requirement 2', () => {
      expect(hi['language.title']).toBe('भाषा');
      expect(hi['language.subtitle']).toBe('कस्टमर ऐप के लिए अपनी पसंदीदा भाषा चुनें।');
      expect(hi['language.english']).toBe('English');
      expect(hi['language.hindi']).toBe('हिन्दी');
      expect(hi['language.confirm']).toBe('पुष्टि करें');
    });

    it('should display हिन्दी for Hindi option when selected', () => {
      // Dynamic display check
      const selectedLocale = 'hi';
      const hindiDisplay = selectedLocale === 'hi' ? hi['language.hindi'] : en['language.hindi'];
      expect(hindiDisplay).toBe('हिन्दी');
    });
  });

  // Test 3: Pure Devanagari Hindi verification
  describe('Pure Devanagari Hindi Verification', () => {
    it('should have Devanagari script characters in non-English brand/acronym keys', () => {
      // Must contain Devanagari unicode range \u0900-\u097F
      const devanagariRegex = /[\u0900-\u097F]/;
      
      // Check high-level common messages
      expect(devanagariRegex.test(hi['common.confirm'])).toBe(true);
      expect(devanagariRegex.test(hi['language.title'])).toBe(true);
      expect(devanagariRegex.test(hi['home.startBooking'])).toBe(true);
      expect(devanagariRegex.test(hi['booking.pickupLocation'])).toBe(true);
      expect(devanagariRegex.test(hi['tracking.trackingYourTrip'])).toBe(true);
      expect(devanagariRegex.test(hi['payment.successfulTitle'])).toBe(true);
      expect(devanagariRegex.test(hi['cancellation.successTitle'])).toBe(true);
    });

    it('should not contain unlocalized English sentences or Hinglish phrasing in Hindi strings', () => {
      // List of English words that must never appear as bare English in Hindi dictionary
      const prohibitedEnglishWords = [
        'Select your preferred language',
        'Where do you want to send',
        'Confirm Cancellation',
        'Cancel Trip',
        'Payment successful',
        'Driver arriving soon',
        'No drivers available',
        'Connection Lost',
        'Search temporarily unavailable',
        'Route unavailable',
        'Trip Completed',
      ];

      for (const [key, hiVal] of Object.entries(hi)) {
        for (const prohibited of prohibitedEnglishWords) {
          expect(hiVal.includes(prohibited)).toBe(false);
        }
      }
    });
  });

  // Test 4: Dynamic parameter interpolation test
  describe('Parameter Interpolation', () => {
    function interpolate(template: string, params?: Record<string, string | number>): string {
      let text = template;
      if (params) {
        Object.keys(params).forEach((paramKey) => {
          text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(params[paramKey]));
        });
      }
      return text;
    }

    it('should correctly interpolate English template parameters', () => {
      const template = en['logistics.stopPickup']; // "Pickup: {address}"
      const interpolated = interpolate(template, { address: 'Connaught Place, Delhi' });
      expect(interpolated).toBe('Pickup: Connaught Place, Delhi');
    });

    it('should correctly interpolate Hindi template parameters', () => {
      const template = hi['logistics.stopPickup']; // "पिकअप: {address}"
      const interpolated = interpolate(template, { address: 'कनॉट प्लेस, दिल्ली' });
      expect(interpolated).toBe('पिकअप: कनॉट प्लेस, दिल्ली');
    });

    it('should correctly interpolate multi-parameter strings in Hindi', () => {
      const template = hi['chat.enRouteDrop']; // "ड्रॉप {total} में से {dropNumber} के रास्ते में"
      const interpolated = interpolate(template, { dropNumber: 1, total: 3 });
      expect(interpolated).toBe('ड्रॉप 3 में से 1 के रास्ते में');
    });

    it('should safely return unchanged template when no params are provided', () => {
      const template = hi['common.confirm'];
      const interpolated = interpolate(template);
      expect(interpolated).toBe('पुष्टि करें');
    });
  });
});
