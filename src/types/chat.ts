export interface ChatMessage {
  id: string;
  bookingId?: string;
  clientMessageId?: string;
  text?: string;
  imageUrl?: string;
  sender: 'driver' | 'customer' | 'rider' | 'system';
  timestamp: string;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'error';
}
