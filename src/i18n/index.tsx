import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
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
  'language.subtitle':
    'Select your preferred language for the Pick Up Driver app.',
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
  'profile.completionHint':
    'Complete remaining steps to unlock inter-city assignments.',
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
  'wallet.sampleData':
    'Sample data: no payments backend is configured in this build.',

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
  'collect.cashFeeNote':
    'For cash, the {fee} platform fee is debited from your wallet.',
  'collect.cash': 'CASH RECEIVED',
  'collect.qr': 'SHOW QR TO CUSTOMER',
  'collect.confirmCashTitle': 'Confirm cash received',
  'collect.confirmCashMsg': 'You received {amount} in cash from the customer.',
  'collect.confirmCashFee':
    'The {fee} platform fee will be debited from your wallet.',
  'collect.confirm': 'Confirm',
  'collect.scanToPay': 'Ask the customer to scan and pay {amount}',
  'collect.waiting': 'Waiting for the payment…',
  'collect.expiresAt': 'QR valid until {time}',
  'collect.shareLink': 'SHARE PAYMENT LINK',
  'collect.shareMessage': 'Pay {amount} for your PickUp booking {ref}: {url}',
  'collect.switchToCash': 'CUSTOMER PAID CASH INSTEAD',
  'collect.qrExpired':
    'The QR expired or was cancelled. Show a new one or collect cash.',
  'collect.paidTitle': 'Payment received',
  'collect.paidCash': 'Received in cash.',
  'collect.paidCashFee':
    'Received in cash. The {fee} platform fee was debited from your wallet.',
  'collect.paidOnline': 'Paid online by the customer.',
  'collect.done': 'DONE',
  'collect.alreadyPaid': 'This trip is already paid.',
  'collect.prepaid': 'The customer paid in the app. Nothing to collect.',
  'collect.notYetPickup': 'You can collect once you reach the pickup.',
  'collect.notYetDelivery': 'You can collect after the last drop is delivered.',
  'collect.refresh': 'REFRESH',
  'collect.lowBalance':
    "Your wallet needs at least {fee} for this trip's platform fee.",
  'collect.recharge': 'RECHARGE WALLET',
  'collect.unavailable':
    'Payment collection is not available in this version of the app.',
  'collect.pleaseWait': 'Please wait',
  'collect.pleaseWaitMsg':
    'We are recording the payment. This takes a few seconds.',
  'collect.qrA11y': 'Payment QR code for {amount}',
  'collect.dropFare': 'To collect for drop {n}',
  'collect.lastFailure':
    'The last QR was not paid ({reason}). Show a new one or collect cash.',
  'collect.cashFeeDue':
    'For cash, the {fee} platform fee is debited from your wallet (balance {balance}).',
  'collect.walletShort':
    'Your wallet balance {balance} does not cover the {fee} cash fee. Recharge your wallet, or show the QR instead.',
  'collect.useQrInstead': 'SHOW QR INSTEAD',
  'collect.awaitingCustomer':
    'The customer has not paid in the app yet. There is nothing for you to collect.',
  'collect.nothingDue': 'Nothing to collect right now.',
  'collect.notYetDrop': 'You can collect when you reach this drop.',
  'collect.errStopRequired':
    'This booking is paid drop by drop. Refresh and collect for the drop you are at.',
  'collect.errStopNotFound':
    'This drop is not part of the booking. Refresh and try again.',

  // Trip steps: one engine step per action, handovers behind the payment gate
  'trip.loading': 'Loading the trip…',
  'trip.toPickup': 'ON THE WAY TO PICKUP',
  'trip.atPickup': 'ARRIVED AT PICKUP',
  'trip.arrived': 'I HAVE ARRIVED',
  'trip.senderLoading': 'Sender loading goods...',
  'trip.enterSenderOtp': 'ENTER SENDER OTP',
  'trip.pickupVerified':
    'Pickup verified. Start the trip once the goods are loaded.',
  'trip.startTrip': 'START TRIP',
  'trip.pickupDone': 'The pickup is complete.',
  'trip.continue': 'CONTINUE',
  'trip.cancelled': 'This trip was cancelled.',
  'trip.backHome': 'BACK TO HOME',
  'trip.refresh': 'REFRESH',
  'trip.back': 'BACK',
  'trip.gateChecking': 'Checking the payment status…',
  'trip.gateSyncing': 'Waiting for the payment system to confirm this trip…',
  'trip.gateUnavailable':
    'The payment status cannot be checked in this version of the app, so the handover stays locked.',
  'trip.gateRetrying': 'Could not check the payment status. Trying again…',
  'trip.gateNotYet': 'Confirming your arrival with the payment system…',
  'trip.paymentRequired': 'Payment required: {amount}',
  'trip.dropPaymentRequired': 'Collect {amount} for drop {n}',
  'trip.lastFailure': 'Last attempt failed: {reason}',
  'trip.paymentProcessing': 'Waiting for the QR payment of {amount}…',
  'trip.paidCash': 'Paid: cash',
  'trip.paidOnline': 'Paid: online',
  'trip.paid': 'Paid',
  'trip.dropPaid': 'Drop {n} paid',
  'trip.payAtDelivery':
    'Payment at delivery: nothing to collect at the pickup.',
  'trip.nothingDue': 'Nothing to collect at this drop.',
  'trip.handoverLocked':
    'The handover is locked until the payment is confirmed.',
  'trip.collectPayment': 'COLLECT PAYMENT',
  'trip.openQr': 'OPEN QR',
  'trip.otpLocked': 'The OTP can be entered once the payment is confirmed.',
  'trip.toDrop': 'On the way to drop {n}',
  'trip.arrivedAtDrop': 'ARRIVED AT DROP {n}',
  'trip.atDrop': 'AT DROP {n}',
  'trip.notCurrentStop': 'This is not the current stop. Finish {stop} first.',
  'trip.startFirst': 'Start the trip at the pickup first.',
  'trip.backToTrip': 'BACK TO TRIP',
  'trip.otpVerified': 'OTP verified. Take the delivery photo.',
  'trip.takePhoto': 'TAKE DELIVERY PHOTO',
  'trip.deliveryFailed': 'DELIVERY FAILED',
  'trip.failReasonLabel': 'Why could the goods not be delivered?',
  'trip.failReasonHint': 'Reason (3 to 200 characters)',
  'trip.reportFailure': 'REPORT FAILED DELIVERY',
  'trip.failedTitle': 'Delivery failed: {reason}',
  'trip.failedWaiting':
    'Try the delivery again, or wait for the operations team to resolve it. Refresh to see their decision.',
  'trip.retryDelivery': 'RETRY DELIVERY',
  'trip.dropDone': 'Drop {n} is done.',
  'trip.dropUndelivered': 'Drop {n} was closed as not delivered.',
  'trip.nextDrop': 'NEXT DROP',
  'trip.allDropsDone': 'All drops are done. Complete the trip.',
  'trip.completeTrip': 'COMPLETE TRIP',
  'trip.completionPending':
    'Waiting for the payment system to confirm the completion. Refresh in a moment.',
  'trip.viewSummary': 'VIEW TRIP SUMMARY',
  'trip.delivered': 'Drop delivered',
  'trip.deliveryNotConfirmed':
    'The delivery was not confirmed. The drop stays open.',
  'trip.tryAgain': 'TRY AGAIN',
  'trip.backToDrop': 'BACK TO DROP',
  'trip.cameraFailed':
    'The camera could not be opened. A delivery photo is required.',
  'trip.errPaymentRequired':
    'Payment is required before this handover. Nothing was changed.',
  'trip.errCancelled':
    'This booking was cancelled. Nothing can be handed over.',
  'trip.errBackendUnavailable':
    'The payment system has not confirmed this yet. Nothing was changed. Try again shortly.',
  'trip.errDeliveryBeingConfirmed':
    'The delivery is still being confirmed. Wait a moment, then refresh.',
  'trip.errUnknownOutcome':
    'No answer from the server. The trip is being checked before you try again.',
  'trip.errSignIn': 'Please sign in again to continue.',
  'trip.errNotYourTrip': 'This trip is not assigned to you.',
  'trip.errNotFound': 'This trip was not found.',
  'trip.errNotConfigured':
    'Trips are not available in this version of the app.',
  'trip.errTryAgain': 'Something went wrong. Please try again.',
  'trip.errReason': 'Enter a reason of 3 to 200 characters.',
  'trip.errInvalidInput': 'This request is not valid. Refresh and try again.',

  // Earnings (payments backend)
  'earnings.payable': 'Payable',
  'earnings.payableHint': 'Settled; goes out in the next weekly payout',
  'earnings.payableNext': 'Paid to your bank in the next weekly payout',
  'earnings.awaitingSettlement': 'Awaiting settlement',
  'earnings.awaitingSettlementHint':
    'Paid online; waiting for Razorpay to settle it',
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
  'earnings.bankPending':
    'Bank account ••••{last4} is being verified. Payouts start after approval.',
  'earnings.bankInactive':
    'Bank account ••••{last4} cannot receive payouts. Contact support.',
  'earnings.bankMissing':
    'No bank account linked yet. Payouts need a verified bank account.',
  'earnings.emptyList': 'No earnings here yet.',
  'earnings.unavailable':
    'Earnings are not available in this version of the app.',
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
  'profile.completionHint':
    'इंटर-सिटी असाइनमेंट पाने के लिए बचे हुए चरण पूरे करें।',
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
  'collect.cashFeeNote':
    'नकद लेने पर {fee} प्लेटफ़ॉर्म शुल्क आपके वॉलेट से कटेगा।',
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
  'collect.shareMessage':
    'अपनी PickUp बुकिंग {ref} के लिए {amount} का भुगतान करें: {url}',
  'collect.switchToCash': 'ग्राहक ने नकद दिया',
  'collect.qrExpired':
    'QR की समय-सीमा खत्म हो गई या वह रद्द हो गया। नया QR दिखाएँ या नकद लें।',
  'collect.paidTitle': 'भुगतान मिल गया',
  'collect.paidCash': 'नकद में मिला।',
  'collect.paidCashFee':
    'नकद में मिला। {fee} प्लेटफ़ॉर्म शुल्क आपके वॉलेट से कटा।',
  'collect.paidOnline': 'ग्राहक ने ऑनलाइन भुगतान किया।',
  'collect.done': 'ठीक है',
  'collect.alreadyPaid': 'इस ट्रिप का भुगतान हो चुका है।',
  'collect.prepaid': 'ग्राहक ने ऐप में भुगतान कर दिया है। कुछ नहीं लेना है।',
  'collect.notYetPickup': 'पिकअप पर पहुँचने के बाद भुगतान ले सकते हैं।',
  'collect.notYetDelivery': 'आखिरी ड्रॉप की डिलीवरी के बाद भुगतान ले सकते हैं।',
  'collect.refresh': 'रिफ्रेश करें',
  'collect.lowBalance':
    'इस ट्रिप के प्लेटफ़ॉर्म शुल्क के लिए वॉलेट में कम से कम {fee} चाहिए।',
  'collect.recharge': 'वॉलेट रिचार्ज करें',
  'collect.unavailable': 'ऐप के इस वर्ज़न में भुगतान लेना उपलब्ध नहीं है।',
  'collect.pleaseWait': 'कृपया प्रतीक्षा करें',
  'collect.pleaseWaitMsg':
    'हम भुगतान दर्ज कर रहे हैं। इसमें कुछ सेकंड लगते हैं।',
  'collect.qrA11y': '{amount} के भुगतान का QR कोड',
  'collect.dropFare': 'ड्रॉप {n} के लिए लेना है',
  'collect.lastFailure':
    'पिछले QR का भुगतान नहीं हुआ ({reason})। नया QR दिखाएँ या नकद लें।',
  'collect.cashFeeDue':
    'नकद लेने पर {fee} प्लेटफ़ॉर्म शुल्क आपके वॉलेट से कटेगा (बैलेंस {balance})।',
  'collect.walletShort':
    'आपके वॉलेट का बैलेंस {balance}, {fee} नकद शुल्क के लिए काफ़ी नहीं है। वॉलेट रिचार्ज करें, या QR दिखाएँ।',
  'collect.useQrInstead': 'इसके बजाय QR दिखाएँ',
  'collect.awaitingCustomer':
    'ग्राहक ने अभी तक ऐप में भुगतान नहीं किया है। आपको कुछ नहीं लेना है।',
  'collect.nothingDue': 'अभी कुछ नहीं लेना है।',
  'collect.notYetDrop': 'इस ड्रॉप पर पहुँचने के बाद भुगतान ले सकते हैं।',
  'collect.errStopRequired':
    'इस बुकिंग का भुगतान हर ड्रॉप पर होता है। रिफ्रेश करें और जिस ड्रॉप पर हैं उसका भुगतान लें।',
  'collect.errStopNotFound':
    'यह ड्रॉप इस बुकिंग में नहीं है। रिफ्रेश करके फिर कोशिश करें।',

  // ट्रिप के चरण
  'trip.loading': 'ट्रिप लोड हो रही है…',
  'trip.toPickup': 'पिकअप की ओर',
  'trip.atPickup': 'पिकअप पर पहुँचे',
  'trip.arrived': 'मैं पहुँच गया',
  'trip.senderLoading': 'भेजने वाला सामान लोड कर रहा है...',
  'trip.enterSenderOtp': 'भेजने वाले का OTP डालें',
  'trip.pickupVerified':
    'पिकअप सत्यापित हो गया। सामान लोड होने के बाद ट्रिप शुरू करें।',
  'trip.startTrip': 'ट्रिप शुरू करें',
  'trip.pickupDone': 'पिकअप पूरा हो गया है।',
  'trip.continue': 'आगे बढ़ें',
  'trip.cancelled': 'यह ट्रिप रद्द हो गई।',
  'trip.backHome': 'होम पर वापस',
  'trip.refresh': 'रिफ्रेश करें',
  'trip.back': 'वापस',
  'trip.gateChecking': 'भुगतान की स्थिति जाँची जा रही है…',
  'trip.gateSyncing': 'भुगतान सिस्टम से इस ट्रिप की पुष्टि का इंतज़ार है…',
  'trip.gateUnavailable':
    'ऐप के इस वर्ज़न में भुगतान की स्थिति नहीं जाँची जा सकती, इसलिए सामान सौंपना बंद है।',
  'trip.gateRetrying': 'भुगतान की स्थिति नहीं जाँच सके। फिर कोशिश हो रही है…',
  'trip.gateNotYet': 'भुगतान सिस्टम से आपके पहुँचने की पुष्टि हो रही है…',
  'trip.paymentRequired': 'भुगतान ज़रूरी है: {amount}',
  'trip.dropPaymentRequired': 'ड्रॉप {n} के लिए {amount} लें',
  'trip.lastFailure': 'पिछली कोशिश विफल रही: {reason}',
  'trip.paymentProcessing': '{amount} के QR भुगतान का इंतज़ार है…',
  'trip.paidCash': 'भुगतान हुआ: नकद',
  'trip.paidOnline': 'भुगतान हुआ: ऑनलाइन',
  'trip.paid': 'भुगतान हो गया',
  'trip.dropPaid': 'ड्रॉप {n} का भुगतान हो गया',
  'trip.payAtDelivery': 'डिलीवरी पर भुगतान: पिकअप पर कुछ नहीं लेना है।',
  'trip.nothingDue': 'इस ड्रॉप पर कुछ नहीं लेना है।',
  'trip.handoverLocked': 'भुगतान की पुष्टि होने तक सामान सौंपना बंद है।',
  'trip.collectPayment': 'भुगतान लें',
  'trip.openQr': 'QR खोलें',
  'trip.otpLocked': 'भुगतान की पुष्टि के बाद ही OTP डाला जा सकता है।',
  'trip.toDrop': 'ड्रॉप {n} की ओर',
  'trip.arrivedAtDrop': 'ड्रॉप {n} पर पहुँच गया',
  'trip.atDrop': 'ड्रॉप {n} पर',
  'trip.notCurrentStop': 'यह मौजूदा स्टॉप नहीं है। पहले {stop} पूरा करें।',
  'trip.startFirst': 'पहले पिकअप पर ट्रिप शुरू करें।',
  'trip.backToTrip': 'ट्रिप पर वापस',
  'trip.otpVerified': 'OTP सत्यापित हो गया। डिलीवरी की फ़ोटो लें।',
  'trip.takePhoto': 'डिलीवरी फ़ोटो लें',
  'trip.deliveryFailed': 'डिलीवरी नहीं हो सकी',
  'trip.failReasonLabel': 'सामान डिलीवर क्यों नहीं हो सका?',
  'trip.failReasonHint': 'कारण (3 से 200 अक्षर)',
  'trip.reportFailure': 'डिलीवरी विफल दर्ज करें',
  'trip.failedTitle': 'डिलीवरी विफल: {reason}',
  'trip.failedWaiting':
    'डिलीवरी फिर से कोशिश करें, या ऑपरेशंस टीम के फ़ैसले का इंतज़ार करें। उनका फ़ैसला देखने के लिए रिफ्रेश करें।',
  'trip.retryDelivery': 'डिलीवरी फिर से कोशिश करें',
  'trip.dropDone': 'ड्रॉप {n} पूरा हो गया।',
  'trip.dropUndelivered': 'ड्रॉप {n} को डिलीवर नहीं हुआ मानकर बंद किया गया।',
  'trip.nextDrop': 'अगला ड्रॉप',
  'trip.allDropsDone': 'सभी ड्रॉप पूरे हो गए। ट्रिप पूरी करें।',
  'trip.completeTrip': 'ट्रिप पूरी करें',
  'trip.completionPending':
    'भुगतान सिस्टम से ट्रिप पूरी होने की पुष्टि का इंतज़ार है। थोड़ी देर में रिफ्रेश करें।',
  'trip.viewSummary': 'ट्रिप का सारांश देखें',
  'trip.delivered': 'ड्रॉप डिलीवर हो गया',
  'trip.deliveryNotConfirmed': 'डिलीवरी की पुष्टि नहीं हुई। ड्रॉप अभी खुला है।',
  'trip.tryAgain': 'फिर कोशिश करें',
  'trip.backToDrop': 'ड्रॉप पर वापस',
  'trip.cameraFailed': 'कैमरा नहीं खुल सका। डिलीवरी की फ़ोटो ज़रूरी है।',
  'trip.errPaymentRequired':
    'सामान सौंपने से पहले भुगतान ज़रूरी है। कुछ नहीं बदला गया।',
  'trip.errCancelled': 'यह बुकिंग रद्द हो गई है। कुछ नहीं सौंपा जा सकता।',
  'trip.errBackendUnavailable':
    'भुगतान सिस्टम ने अभी पुष्टि नहीं की है। कुछ नहीं बदला गया। थोड़ी देर में फिर कोशिश करें।',
  'trip.errDeliveryBeingConfirmed':
    'डिलीवरी की पुष्टि अभी चल रही है। थोड़ा रुकें, फिर रिफ्रेश करें।',
  'trip.errUnknownOutcome':
    'सर्वर से जवाब नहीं मिला। फिर कोशिश करने से पहले ट्रिप की स्थिति जाँची जा रही है।',
  'trip.errSignIn': 'जारी रखने के लिए फिर से साइन इन करें।',
  'trip.errNotYourTrip': 'यह ट्रिप आपको नहीं दी गई है।',
  'trip.errNotFound': 'यह ट्रिप नहीं मिली।',
  'trip.errNotConfigured': 'ऐप के इस वर्ज़न में ट्रिप उपलब्ध नहीं हैं।',
  'trip.errTryAgain': 'कुछ गलत हो गया। कृपया फिर कोशिश करें।',
  'trip.errReason': '3 से 200 अक्षरों का कारण लिखें।',
  'trip.errInvalidInput': 'यह अनुरोध सही नहीं है। रिफ्रेश करके फिर कोशिश करें।',

  // Earnings (payments backend)
  'earnings.payable': 'देय',
  'earnings.payableHint': 'सेटल हो गया; अगले साप्ताहिक भुगतान में जाएगा',
  'earnings.payableNext': 'अगले साप्ताहिक भुगतान में आपके बैंक में जाएगा',
  'earnings.awaitingSettlement': 'सेटलमेंट बाकी',
  'earnings.awaitingSettlementHint':
    'ऑनलाइन भुगतान हुआ; Razorpay के सेटलमेंट का इंतज़ार',
  'earnings.inPayout': 'भुगतान जारी',
  'earnings.inPayoutHint': 'बैंक ट्रांसफ़र चल रहा है',
  'earnings.paid': 'भुगतान हो गया',
  'earnings.paidHint': 'आपके बैंक में भेजा गया',
  'earnings.onHold': 'रोका गया',
  'earnings.onHoldHint': 'जाँच चल रही है। जानकारी के लिए सपोर्ट से संपर्क करें',
  'earnings.cashKept': 'नकद में लिया',
  'earnings.cashKeptHint': 'किराया आपके पास; शुल्क वॉलेट से कटा',
  'earnings.filterAll': 'सभी',
  'earnings.summaryLine':
    '{count} ट्रिप · किराया {gross} · प्लेटफ़ॉर्म शुल्क {fee}',
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
  'earnings.bankPending':
    'बैंक खाता ••••{last4} की जाँच चल रही है। मंज़ूरी के बाद भुगतान शुरू होंगे।',
  'earnings.bankInactive':
    'बैंक खाता ••••{last4} में भुगतान नहीं जा सकता। सपोर्ट से संपर्क करें।',
  'earnings.bankMissing':
    'अभी कोई बैंक खाता नहीं जुड़ा है। भुगतान के लिए सत्यापित बैंक खाता ज़रूरी है।',
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
  t: key => key,
});

const interpolate = (
  template: string,
  vars?: Record<string, string | number>,
): string => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    vars[name] != null ? String(vars[name]) : `{${name}}`,
  );
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(stored => {
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

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => useContext(I18nContext);
