/**
 * User, driver profile, vehicle, KYC, and subscription type definitions.
 */

export type DocumentStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'expired';

export type SubscriptionStatus = 'active' | 'expired' | 'inactive' | 'processing';

export type KycDocumentType =
  | 'driving_license'
  | 'aadhaar_card'
  | 'pan_card'
  | 'vehicle_rc'
  | 'insurance_policy'
  | 'vehicle_photos';

export interface Vehicle {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly registration: string;
  readonly status: DocumentStatus;
  readonly iconName: string;
}

export interface KycDocument {
  readonly id: string;
  readonly type: KycDocumentType;
  readonly label: string;
  readonly status: DocumentStatus;
  readonly rejectionReason?: string;
  readonly expiryDate?: string;
  readonly uploadedAt?: string;
}

export interface Subscription {
  readonly id: string;
  readonly planName: string;
  readonly status: SubscriptionStatus;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly autoRenew: boolean;
  readonly amount: number;
  readonly currency: string;
  readonly billingCycle: 'monthly' | 'quarterly' | 'annual';
  readonly benefits: readonly SubscriptionBenefit[];
}

export interface SubscriptionBenefit {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly iconName: string;
}

export interface Notification {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly timestamp: string;
  readonly isRead: boolean;
  readonly category: 'trip' | 'wallet' | 'account' | 'system';
  readonly iconName: string;
}

export interface SettingsSection {
  readonly title: string;
  readonly items: readonly SettingsItem[];
}

export interface SettingsItem {
  readonly id: string;
  readonly label: string;
  readonly value?: string;
  readonly iconName: string;
  readonly hasChevron: boolean;
  readonly route?: string;
}

export interface ChatMessage {
  readonly id: string;
  readonly senderId: string;
  readonly text?: string;
  readonly imageUrl?: string;
  readonly timestamp: string;
  readonly status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  readonly isDriver: boolean;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  durationDays: number;
  features: string[];
}

export interface CurrentSubscription {
  planId: string;
  status: 'active' | 'expired' | 'cancelled';
  expiresAt: string;
}
