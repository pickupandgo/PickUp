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
  'wallet.blocked': 'Your wallet is blocked. Please contact support.',
  'wallet.retry': 'RETRY',
  'wallet.sampleData': 'Sample data: no payments backend is configured in this build.',

  // Trip payment collection
  'collect.title': 'Collect payment',
  'collect.stagePickup': 'Pay at pickup',
  'collect.stageDelivery': 'Pay at delivery',
  'collect.banner': 'Collect {amount}',
  'collect.bannerSub': '{stage} · Booking {ref}',
  'collect.bannerHint': 'Opens cash and QR payment for this trip',
  'collect.fare': 'Fare to collect',
  'collect.booking': 'Booking {ref}',
  'collect.platformFee': 'Platform fee',
  'collect.yourShare': 'Your share',
  'collect.cashFeeNote': 'For cash, the {fee} platform fee is debited from your wallet.',
  'collect.cash': 'CASH RECEIVED',
  'collect.qr': 'SHOW QR TO CUSTOMER',
  'collect.confirmCashTitle': 'Confirm cash received',
  'collect.confirmCashMsg': 'You received {amount} in cash from the customer.',
  'collect.confirmCashFee': 'The {fee} platform fee will be debited from your wallet.',
  'collect.confirm': 'Confirm',
  'collect.scanToPay': 'Ask the customer to scan and pay {amount}',
  'collect.waiting': 'Waiting for the payment…',
  'collect.expiresAt': 'QR valid until {time}',
  'collect.shareLink': 'SHARE PAYMENT LINK',
  'collect.shareMessage': 'Pay {amount} for your PickUp booking {ref}: {url}',
  'collect.switchToCash': 'CUSTOMER PAID CASH INSTEAD',
  'collect.qrExpired': 'The QR expired or was cancelled. Show a new one or collect cash.',
  'collect.paidTitle': 'Payment received',
  'collect.paidCash': 'Received in cash.',
  'collect.paidCashFee': 'Received in cash. The {fee} platform fee was debited from your wallet.',
  'collect.paidOnline': 'Paid online by the customer.',
  'collect.done': 'DONE',
  'collect.alreadyPaid': 'This trip is already paid.',
  'collect.prepaid': 'The customer paid in the app. Nothing to collect.',
  'collect.notYetPickup': 'You can collect once you reach the pickup.',
  'collect.notYetDelivery': 'You can collect after the last drop is delivered.',
  'collect.refresh': 'REFRESH',
  'collect.lowBalance': "Your wallet needs at least {fee} for this trip's platform fee.",
  'collect.recharge': 'RECHARGE WALLET',
  'collect.unavailable': 'Payment collection is not available in this version of the app.',
  'collect.pleaseWait': 'Please wait',
  'collect.pleaseWaitMsg': 'We are recording the payment. This takes a few seconds.',
  'collect.qrA11y': 'Payment QR code for {amount}',

  // Earnings (payments backend)
  'earnings.payable': 'Payable',
  'earnings.payableHint': 'Settled; goes out in the next weekly payout',
  'earnings.payableNext': 'Paid to your bank in the next weekly payout',
  'earnings.awaitingSettlement': 'Awaiting settlement',
  'earnings.awaitingSettlementHint': 'Paid online; waiting for Razorpay to settle it',
  'earnings.inPayout': 'In payout',
  'earnings.inPayoutHint': 'Bank transfer in progress',
  'earnings.paid': 'Paid',
  'earnings.paidHint': 'Sent to your bank',
  'earnings.onHold': 'On hold',
  'earnings.onHoldHint': 'Under review. Contact support for details',
  'earnings.cashKept': 'Collected in cash',
  'earnings.cashKeptHint': 'You kept the fare; the fee came from your wallet',
  'earnings.filterAll': 'All',
  'earnings.summaryLine': '{count} trips · Fares {gross} · Platform fees {fee}',
  'earnings.fare': 'Fare',
  'earnings.platformFee': 'Platform fee',
  'earnings.otherDeductions': 'Other deductions',
  'earnings.tds': 'TDS',
  'earnings.yourEarning': 'Your earning',
  'earnings.payableSince': 'Payable since {date}',
  'earnings.paidOn': 'Paid on {date}',
  'earnings.trip': 'Trip on {date}',
  'earnings.payouts': 'Weekly payouts',
  'earnings.noPayouts': 'No payouts yet',
  'earnings.payoutTo': 'to ••••{last4}',
  'earnings.utr': 'UTR {utr}',
  'earnings.payoutProcessed': 'Sent',
  'earnings.payoutPending': 'Processing',
  'earnings.payoutFailed': 'Failed',
  'earnings.payoutReversed': 'Returned by bank',
  'earnings.bankVerified': 'Payouts go to {ifsc} ••••{last4}',
  'earnings.bankPending': 'Bank account ••••{last4} is being verified. Payouts start after approval.',
  'earnings.bankInactive': 'Bank account ••••{last4} cannot receive payouts. Contact support.',
  'earnings.bankMissing': 'No bank account linked yet. Payouts need a verified bank account.',
  'earnings.emptyList': 'No earnings here yet.',
  'earnings.unavailable': 'Earnings are not available in this version of the app.',
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
  'wallet.blocked': 'आपका वॉलेट ब्लॉक है। कृपया सपोर्ट से संपर्क करें।',
  'wallet.retry': 'फिर से कोशिश करें',

  // Trip payment collection
  'collect.title': 'भुगतान लें',
  'collect.stagePickup': 'पिकअप पर भुगतान',
  'collect.stageDelivery': 'डिलीवरी पर भुगतान',
  'collect.banner': '{amount} लें',
  'collect.bannerSub': '{stage} · बुकिंग {ref}',
  'collect.bannerHint': 'इस ट्रिप का नकद या QR भुगतान खोलता है',
  'collect.fare': 'लेने वाला किराया',
  'collect.booking': 'बुकिंग {ref}',
  'collect.platformFee': 'प्लेटफ़ॉर्म शुल्क',
  'collect.yourShare': 'आपका हिस्सा',
  'collect.cashFeeNote': 'नकद लेने पर {fee} प्लेटफ़ॉर्म शुल्क आपके वॉलेट से कटेगा।',
  'collect.cash': 'नकद मिला',
  'collect.qr': 'ग्राहक को QR दिखाएँ',
  'collect.confirmCashTitle': 'नकद मिलने की पुष्टि करें',
  'collect.confirmCashMsg': 'आपको ग्राहक से {amount} नकद मिले।',
  'collect.confirmCashFee': '{fee} प्लेटफ़ॉर्म शुल्क आपके वॉलेट से कटेगा।',
  'collect.confirm': 'पुष्टि करें',
  'collect.scanToPay': 'ग्राहक से स्कैन करके {amount} भुगतान करने को कहें',
  'collect.waiting': 'भुगतान का इंतज़ार है…',
  'collect.expiresAt': 'QR {time} तक मान्य है',
  'collect.shareLink': 'भुगतान लिंक भेजें',
  'collect.shareMessage': 'अपनी PickUp बुकिंग {ref} के लिए {amount} का भुगतान करें: {url}',
  'collect.switchToCash': 'ग्राहक ने नकद दिया',
  'collect.qrExpired': 'QR की समय-सीमा खत्म हो गई या वह रद्द हो गया। नया QR दिखाएँ या नकद लें।',
  'collect.paidTitle': 'भुगतान मिल गया',
  'collect.paidCash': 'नकद में मिला।',
  'collect.paidCashFee': 'नकद में मिला। {fee} प्लेटफ़ॉर्म शुल्क आपके वॉलेट से कटा।',
  'collect.paidOnline': 'ग्राहक ने ऑनलाइन भुगतान किया।',
  'collect.done': 'ठीक है',
  'collect.alreadyPaid': 'इस ट्रिप का भुगतान हो चुका है।',
  'collect.prepaid': 'ग्राहक ने ऐप में भुगतान कर दिया है। कुछ नहीं लेना है।',
  'collect.notYetPickup': 'पिकअप पर पहुँचने के बाद भुगतान ले सकते हैं।',
  'collect.notYetDelivery': 'आखिरी ड्रॉप की डिलीवरी के बाद भुगतान ले सकते हैं।',
  'collect.refresh': 'रिफ्रेश करें',
  'collect.lowBalance': 'इस ट्रिप के प्लेटफ़ॉर्म शुल्क के लिए वॉलेट में कम से कम {fee} चाहिए।',
  'collect.recharge': 'वॉलेट रिचार्ज करें',
  'collect.unavailable': 'ऐप के इस वर्ज़न में भुगतान लेना उपलब्ध नहीं है।',
  'collect.pleaseWait': 'कृपया प्रतीक्षा करें',
  'collect.pleaseWaitMsg': 'हम भुगतान दर्ज कर रहे हैं। इसमें कुछ सेकंड लगते हैं।',
  'collect.qrA11y': '{amount} के भुगतान का QR कोड',

  // Earnings (payments backend)
  'earnings.payable': 'देय',
  'earnings.payableHint': 'सेटल हो गया; अगले साप्ताहिक भुगतान में जाएगा',
  'earnings.payableNext': 'अगले साप्ताहिक भुगतान में आपके बैंक में जाएगा',
  'earnings.awaitingSettlement': 'सेटलमेंट बाकी',
  'earnings.awaitingSettlementHint': 'ऑनलाइन भुगतान हुआ; Razorpay के सेटलमेंट का इंतज़ार',
  'earnings.inPayout': 'भुगतान जारी',
  'earnings.inPayoutHint': 'बैंक ट्रांसफ़र चल रहा है',
  'earnings.paid': 'भुगतान हो गया',
  'earnings.paidHint': 'आपके बैंक में भेजा गया',
  'earnings.onHold': 'रोका गया',
  'earnings.onHoldHint': 'जाँच चल रही है। जानकारी के लिए सपोर्ट से संपर्क करें',
  'earnings.cashKept': 'नकद में लिया',
  'earnings.cashKeptHint': 'किराया आपके पास; शुल्क वॉलेट से कटा',
  'earnings.filterAll': 'सभी',
  'earnings.summaryLine': '{count} ट्रिप · किराया {gross} · प्लेटफ़ॉर्म शुल्क {fee}',
  'earnings.fare': 'किराया',
  'earnings.platformFee': 'प्लेटफ़ॉर्म शुल्क',
  'earnings.otherDeductions': 'अन्य कटौती',
  'earnings.tds': 'TDS',
  'earnings.yourEarning': 'आपकी कमाई',
  'earnings.payableSince': '{date} से देय',
  'earnings.paidOn': '{date} को भुगतान हुआ',
  'earnings.trip': '{date} की ट्रिप',
  'earnings.payouts': 'साप्ताहिक भुगतान',
  'earnings.noPayouts': 'अभी तक कोई भुगतान नहीं',
  'earnings.payoutTo': '••••{last4} में',
  'earnings.utr': 'UTR {utr}',
  'earnings.payoutProcessed': 'भेजा गया',
  'earnings.payoutPending': 'प्रक्रिया में',
  'earnings.payoutFailed': 'विफल',
  'earnings.payoutReversed': 'बैंक ने लौटाया',
  'earnings.bankVerified': 'भुगतान {ifsc} ••••{last4} में जाता है',
  'earnings.bankPending': 'बैंक खाता ••••{last4} की जाँच चल रही है। मंज़ूरी के बाद भुगतान शुरू होंगे।',
  'earnings.bankInactive': 'बैंक खाता ••••{last4} में भुगतान नहीं जा सकता। सपोर्ट से संपर्क करें।',
  'earnings.bankMissing': 'अभी कोई बैंक खाता नहीं जुड़ा है। भुगतान के लिए सत्यापित बैंक खाता ज़रूरी है।',
  'earnings.emptyList': 'यहाँ अभी कोई कमाई नहीं है।',
  'earnings.unavailable': 'ऐप के इस वर्ज़न में कमाई उपलब्ध नहीं है।',
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
