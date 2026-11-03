/** Lock-screen safe copy: never interpolate names, addresses, reasons, OTPs or chat text. */
const events = {
  RIDE_OFFER: [
    'New Ride Offer',
    'A new delivery offer is available. Open the app to review.',
    'नई डिलीवरी',
    'नई डिलीवरी का प्रस्ताव उपलब्ध है। ऐप में देखें।',
  ],
  DRIVER_ASSIGNED: [
    'Driver Assigned',
    'Your driver has accepted your booking.',
    'चालक नियुक्त',
    'आपके चालक ने आपकी बुकिंग स्वीकार कर ली है।',
  ],
  DRIVER_ARRIVED: [
    'Driver Arrived',
    'Your driver has reached the pickup location.',
    'चालक पहुँचे',
    'आपके चालक पिकअप स्थान पर पहुँच गए हैं।',
  ],
  TRIP_STARTED: [
    'Delivery In Progress',
    'Your delivery is now in progress.',
    'डिलीवरी जारी',
    'आपकी डिलीवरी अब जारी है।',
  ],
  ARRIVED_AT_STOP: [
    'Driver At Delivery Stop',
    'Your driver has reached a delivery location.',
    'चालक डिलीवरी स्थान पर',
    'आपके चालक डिलीवरी स्थान पर पहुँच गए हैं।',
  ],
  STOP_DELIVERED: [
    'Drop Completed',
    'A delivery stop has been completed.',
    'ड्रॉप पूरा',
    'एक डिलीवरी ड्रॉप पूरा हो गया है।',
  ],
  TRIP_COMPLETED: [
    'Delivery Completed',
    'Your delivery has been completed.',
    'डिलीवरी पूरी',
    'आपकी डिलीवरी पूरी हो गई है।',
  ],
  BOOKING_CANCELLED: [
    'Booking Cancelled',
    'Your booking has been cancelled.',
    'बुकिंग रद्द',
    'आपकी बुकिंग रद्द कर दी गई है।',
  ],
  NEW_CHAT_MESSAGE: ['New Message', '', 'नया संदेश', ''],
} as const;

export type NotificationEvent = keyof typeof events;

export function notificationCopy(
  type: NotificationEvent,
  role: 'CUSTOMER' | 'DRIVER',
  language = 'en',
) {
  const event = events[type];
  if (!event) return undefined;
  const hindi = language === 'hi';
  const sender = role === 'DRIVER' ? 'customer' : 'driver';
  return {
    title: `MultipleRide • ${event[hindi ? 2 : 0]}`,
    body:
      type === 'NEW_CHAT_MESSAGE'
        ? hindi
          ? role === 'DRIVER'
            ? 'आपके ग्राहक का नया संदेश आया है।'
            : 'आपके चालक का नया संदेश आया है।'
          : `You have a new message from your ${sender}.`
        : event[hindi ? 3 : 1],
    channelId: type === 'NEW_CHAT_MESSAGE' ? 'chat_messages' : 'ride_updates',
  };
}
