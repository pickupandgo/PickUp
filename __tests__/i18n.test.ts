import { en, hi } from '../src/i18n';

describe('Driver App Localization (English & Hindi)', () => {
  it('Requirement 1: Language selection screen matches exact strings for English', () => {
    expect(en['language.title']).toBe('Language');
    expect(en['language.subtitle']).toBe('Select your preferred language for the Multiple Ride Partner app.');
    expect(en['language.english']).toBe('English');
    expect(en['language.hindi']).toBe('Hindi');
    expect(en['language.confirm']).toBe('Confirm');
  });

  it('Requirement 1: Language selection screen matches exact strings for Hindi (Devanagari)', () => {
    expect(hi['language.title']).toBe('भाषा');
    expect(hi['language.subtitle']).toBe('Multiple Ride Partner ऐप के लिए अपनी पसंदीदा भाषा चुनें।');
    expect(hi['language.english']).toBe('English');
    expect(hi['language.hindi']).toBe('हिन्दी');
    expect(hi['language.confirm']).toBe('पुष्टि करें');
  });

  it('Requirement 3: Key driver operational terms match natural Devanagari Hindi', () => {
    expect(hi['language.title']).toBe('भाषा');
    expect(hi['common.confirm']).toBe('पुष्टि करें');
    expect(hi['common.cancel']).toBe('रद्द करें');
    expect(hi['common.saveAndContinue']).toBe('सहेजें और आगे बढ़ें');
    expect(hi['auth.loginTab']).toBe('लॉग इन करें');
    expect(hi['auth.signupTab']).toBe('पंजीकरण करें');
    expect(hi['auth.mobileNumber']).toBe('मोबाइल नंबर');
    expect(hi['auth.enterMobileNumber']).toBe('मोबाइल नंबर दर्ज करें');
    expect(hi['otp.resendOtp']).toBe('OTP दोबारा भेजें');
    expect(hi['auth.fullName']).toBe('पूरा नाम');
    expect(hi['auth.emailAddress']).toBe('ईमेल पता');
    expect(hi['home.online']).toBe('ऑनलाइन');
    expect(hi['home.offline']).toBe('ऑफ़लाइन');
    expect(hi['trip.pickup']).toBe('पिकअप स्थान');
    expect(hi['trip.destination']).toBe('गंतव्य स्थान');
    expect(hi['trip.earnings']).toBe('कमाई');
    expect(hi['tripHistory.title']).toBe('यात्रा का इतिहास');
    expect(hi['profile.title']).toBe('प्रोफ़ाइल');
    expect(hi['settings.title']).toBe('सेटिंग्स');
    expect(hi['common.retry']).toBe('पुनः प्रयास करें');
    expect(hi['common.loading']).toBe('लोड हो रहा है...');
    expect(hi['profile.logout']).toBe('लॉग आउट करें');
    expect(hi['common.areYouSure']).toBe('क्या आप आश्वस्त हैं?');
    expect(hi['common.networkError']).toBe('नेटवर्क संबंधी त्रुटि');
    expect(hi['common.somethingWentWrong']).toBe('कुछ गलत हो गया है');
  });

  it('Both English and Hindi dictionaries have parity for critical namespaces', () => {
    const criticalKeys = [
      'tab.home', 'tab.trips', 'tab.earnings', 'tab.wallet', 'tab.account',
      'common.completed', 'common.cancelled', 'common.confirm', 'common.cancel',
      'auth.mobileNumber', 'otp.title', 'home.driverHub', 'trip.offer',
      'cancellation.title', 'deliveryProof.title', 'wallet.title',
      'tripHistory.title', 'earnings.title', 'profile.title', 'settings.title',
      'kyc.title', 'subscription.title', 'accountRestricted.title',
    ];

    criticalKeys.forEach((key) => {
      expect(en[key]).toBeDefined();
      expect(hi[key]).toBeDefined();
      expect(typeof en[key]).toBe('string');
      expect(typeof hi[key]).toBe('string');
      expect(hi[key].length).toBeGreaterThan(0);
    });
  });
});
