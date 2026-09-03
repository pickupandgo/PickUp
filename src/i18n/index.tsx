import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Lightweight app-wide i18n.
 *
 * - `locale` is persisted in AsyncStorage so the choice survives restarts.
 * - `t(key, vars)` looks up the current locale, falls back to English, then to
 *   the key itself. `{name}`-style placeholders are interpolated.
 *
 * To translate more screens, add keys to both dictionaries below and call
 * `t('your.key')` in the screen.
 */

export type Locale = 'en' | 'hi';

const STORAGE_KEY = 'driver.locale';

type Dict = Record<string, string>;

const en: Dict = {
  // Tabs
  'tab.home': 'Home',
  'tab.trips': 'Trips',
  'tab.earnings': 'Earnings',
  'tab.wallet': 'Wallet',
  'tab.account': 'Account',

  // Common
  'common.completed': 'Completed',
  'common.cancelled': 'Cancelled',
  'common.expired': 'Expired',
  'common.cancel': 'Cancel',
  'common.retry': 'Retry',

  // Language screen
  'language.title': 'Language',
  'language.subtitle': 'Select your preferred language for the Pick Up Driver app.',
  'language.english': 'English',
  'language.hindi': 'Hindi',
  'language.confirm': 'Confirm',

  // Home / Driver Hub
  'home.driverHub': 'Driver Hub',
  'home.online': 'ONLINE',
  'home.live': 'LIVE',
  'home.offline': 'OFFLINE',
  'home.offlineTitle': "You're Offline",
  'home.offlineSubtitle': 'Go Live to start receiving trip requests.',
  'home.availableNearby': 'Available for nearby trips',
  'home.findingTitle': 'Finding your next trip',
  'home.findingSubtitle': 'Stay in high-demand areas for faster matches',
  'home.currentVehicle': 'CURRENT VEHICLE',
  'home.approved': 'APPROVED',
  'home.today': 'TODAY',
  'home.walletLabel': 'WALLET',
  'home.tripsCount': '{count} trips',
  'home.minWallet': 'Min {amount}',
  'home.deliveryProtocol': 'Delivery Protocol',
  'home.deliveryProtocolDesc':
    'Delivery photo required at each drop location. Ensure clear visibility of package.',
  'home.openTrip': 'OPEN TRIP',
  'home.activeTrip': 'ACTIVE TRIP',
  'home.estEarning': 'EST. EARNING',
  'home.details': 'DETAILS',
  'home.recharge': 'RECHARGE',

  // Trip History
  'tripHistory.title': 'Trip History',
  'tripHistory.all': 'All Trips',
  'tripHistory.completed': 'Completed',
  'tripHistory.cancelled': 'Cancelled',
  'tripHistory.stops': '{count} Stops',
  'tripHistory.paidToWallet': 'Paid to Wallet',
  'tripHistory.cancelledByUser': 'Cancelled by user',
  'tripHistory.emptyTitle': 'No trips found.',
  'tripHistory.emptySubtitle': 'Your completed journeys will appear here.',

  // Earnings
  'earnings.title': 'Earnings',
  'earnings.today': 'Today',
  'earnings.weekly': 'Weekly',
  'earnings.monthly': 'Monthly',
  'earnings.total': 'Total Earnings',
  'earnings.trips': 'Trips',
  'earnings.online': 'Online',
  'earnings.hrs': '{value} hrs',
  'earnings.breakdown': 'Breakdown',
  'earnings.cash': 'Cash Earnings',
  'earnings.onlineEarnings': 'Online Earnings',
  'earnings.commission': 'Commission',
  'earnings.net': 'Net Earnings',
  'earnings.history': 'History',
  'earnings.emptyTitle': 'No earnings yet today.',
  'earnings.emptySubtitle': 'Complete your first trip to start earning.',

  // Profile
  'profile.completion': 'PROFILE COMPLETION',
  'profile.completionHint': 'Complete remaining steps to unlock inter-city assignments.',
  'profile.proPlan': 'Pro Plan',
  'profile.activeUntil': 'Active until Dec 2024',
  'profile.manage': 'MANAGE',
  'profile.documents': 'DOCUMENTS',
  'profile.account': 'ACCOUNT',
  'profile.language': 'Language',
  'profile.notifications': 'Notifications',
  'profile.settings': 'Settings',
  'profile.logout': 'LOGOUT',
  'profile.verified': 'VERIFIED',
  'profile.pending': 'PENDING',
  'profile.logoutTitle': 'Log out',
  'profile.logoutMsg': 'Are you sure you want to log out?',
  'doc.aadhaar': 'Aadhaar Card',
  'doc.dl': 'Driving Licence',
  'doc.rc': 'Vehicle RC',

  // Wallet
  'wallet.title': 'Wallet',
  'wallet.availableBalance': 'Available Balance',
  'wallet.minRequired': 'Minimum {amount} required',
  'wallet.rechargeWallet': 'RECHARGE WALLET',
  'wallet.todaysEarnings': "Today's Earnings",
  'wallet.gross': 'Gross',
  'wallet.net': 'Net',
  'wallet.tripsCount': '{count} trips',
  'wallet.recent': 'Recent Transactions',
  'wallet.viewAll': 'VIEW ALL TRANSACTIONS',
  'wallet.noTxns': 'No transactions yet',
};

const hi: Dict = {
  // Tabs
  'tab.home': 'होम',
  'tab.trips': 'ट्रिप्स',
  'tab.earnings': 'कमाई',
  'tab.wallet': 'वॉलेट',
  'tab.account': 'अकाउंट',

  // Common
  'common.completed': 'पूर्ण',
  'common.cancelled': 'रद्द',
  'common.expired': 'समाप्त',
  'common.cancel': 'रद्द करें',
  'common.retry': 'फिर कोशिश करें',

  // Language screen
  'language.title': 'भाषा',
  'language.subtitle': 'Pick Up ड्राइवर ऐप के लिए अपनी पसंदीदा भाषा चुनें।',
  'language.english': 'अंग्रेज़ी',
  'language.hindi': 'हिन्दी',
  'language.confirm': 'पुष्टि करें',

  // Home / Driver Hub
  'home.driverHub': 'ड्राइवर हब',
  'home.online': 'ऑनलाइन',
  'home.live': 'लाइव',
  'home.offline': 'ऑफ़लाइन',
  'home.offlineTitle': 'आप ऑफ़लाइन हैं',
  'home.offlineSubtitle': 'ट्रिप रिक्वेस्ट पाने के लिए लाइव जाएँ।',
  'home.availableNearby': 'आस-पास की ट्रिप के लिए उपलब्ध',
  'home.findingTitle': 'आपकी अगली ट्रिप ढूँढ रहे हैं',
  'home.findingSubtitle': 'तेज़ मैच के लिए ज़्यादा माँग वाले इलाकों में रहें',
  'home.currentVehicle': 'मौजूदा वाहन',
  'home.approved': 'स्वीकृत',
  'home.today': 'आज',
  'home.walletLabel': 'वॉलेट',
  'home.tripsCount': '{count} ट्रिप',
  'home.minWallet': 'न्यूनतम {amount}',
  'home.deliveryProtocol': 'डिलीवरी नियम',
  'home.deliveryProtocolDesc':
    'हर ड्रॉप पर डिलीवरी फ़ोटो ज़रूरी है। पैकेज साफ़ दिखना चाहिए।',
  'home.openTrip': 'ट्रिप खोलें',
  'home.activeTrip': 'चालू ट्रिप',
  'home.estEarning': 'अनुमानित कमाई',
  'home.details': 'विवरण',
  'home.recharge': 'रिचार्ज',

  // Trip History
  'tripHistory.title': 'ट्रिप इतिहास',
  'tripHistory.all': 'सभी ट्रिप',
  'tripHistory.completed': 'पूर्ण',
  'tripHistory.cancelled': 'रद्द',
  'tripHistory.stops': '{count} स्टॉप',
  'tripHistory.paidToWallet': 'वॉलेट में जमा',
  'tripHistory.cancelledByUser': 'उपयोगकर्ता द्वारा रद्द',
  'tripHistory.emptyTitle': 'कोई ट्रिप नहीं मिली।',
  'tripHistory.emptySubtitle': 'आपकी पूरी हुई यात्राएँ यहाँ दिखेंगी।',

  // Earnings
  'earnings.title': 'कमाई',
  'earnings.today': 'आज',
  'earnings.weekly': 'साप्ताहिक',
  'earnings.monthly': 'मासिक',
  'earnings.total': 'कुल कमाई',
  'earnings.trips': 'ट्रिप',
  'earnings.online': 'ऑनलाइन',
  'earnings.hrs': '{value} घंटे',
  'earnings.breakdown': 'विवरण',
  'earnings.cash': 'नकद कमाई',
  'earnings.onlineEarnings': 'ऑनलाइन कमाई',
  'earnings.commission': 'कमीशन',
  'earnings.net': 'शुद्ध कमाई',
  'earnings.history': 'इतिहास',
  'earnings.emptyTitle': 'आज अभी तक कोई कमाई नहीं।',
  'earnings.emptySubtitle': 'कमाई शुरू करने के लिए अपनी पहली ट्रिप पूरी करें।',

  // Profile
  'profile.completion': 'प्रोफ़ाइल पूर्णता',
  'profile.completionHint': 'इंटर-सिटी असाइनमेंट पाने के लिए बचे हुए चरण पूरे करें।',
  'profile.proPlan': 'प्रो प्लान',
  'profile.activeUntil': 'दिसंबर 2024 तक सक्रिय',
  'profile.manage': 'प्रबंधित करें',
  'profile.documents': 'दस्तावेज़',
  'profile.account': 'अकाउंट',
  'profile.language': 'भाषा',
  'profile.notifications': 'सूचनाएँ',
  'profile.settings': 'सेटिंग्स',
  'profile.logout': 'लॉग आउट',
  'profile.verified': 'सत्यापित',
  'profile.pending': 'लंबित',
  'profile.logoutTitle': 'लॉग आउट',
  'profile.logoutMsg': 'क्या आप वाकई लॉग आउट करना चाहते हैं?',
  'doc.aadhaar': 'आधार कार्ड',
  'doc.dl': 'ड्राइविंग लाइसेंस',
  'doc.rc': 'वाहन आरसी',

  // Wallet
  'wallet.title': 'वॉलेट',
  'wallet.availableBalance': 'उपलब्ध बैलेंस',
  'wallet.minRequired': 'न्यूनतम {amount} ज़रूरी',
  'wallet.rechargeWallet': 'वॉलेट रिचार्ज करें',
  'wallet.todaysEarnings': 'आज की कमाई',
  'wallet.gross': 'सकल',
  'wallet.net': 'शुद्ध',
  'wallet.tripsCount': '{count} ट्रिप',
  'wallet.recent': 'हाल के लेन-देन',
  'wallet.viewAll': 'सभी लेन-देन देखें',
  'wallet.noTxns': 'अभी तक कोई लेन-देन नहीं',
};

const DICTS: Record<Locale, Dict> = { en, hi };

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
});

const interpolate = (template: string, vars?: Record<string, string | number>): string => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    vars[name] != null ? String(vars[name]) : `{${name}}`,
  );
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'en' || stored === 'hi') setLocaleState(stored);
      })
      .catch(() => {});
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const value = DICTS[locale][key] ?? DICTS.en[key] ?? key;
      return interpolate(value, vars);
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => useContext(I18nContext);
