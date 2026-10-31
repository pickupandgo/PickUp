import type {
  OnboardingDocument,
  OnboardingVehicle,
  VehicleCategory,
} from './DriverOnboardingService';

export const CATEGORY_LABELS: Record<VehicleCategory, string> = {
  TWO_WHEELER: 'Bike / 2-Wheeler',
  THREE_WHEELER: '3-Wheeler / E-Loader',
  FOUR_WHEELER: '4-Wheeler',
  MINI_TRUCK: 'Mini Truck / Tata Ace',
  PICKUP_TRUCK: 'Pickup / Bolero',
};
export const label = (value: string) =>
  value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
export const latestDocument = (
  documents: readonly OnboardingDocument[],
  type: string,
) =>
  documents
    .filter(doc => doc.documentType === type)
    .reduce<OnboardingDocument | undefined>(
      (latest, doc) => (!latest || doc.version > latest.version ? doc : latest),
      undefined,
    );
export function documentState(document?: OnboardingDocument) {
  if (!document) return 'NOT_UPLOADED';
  if (document.status === 'QUARANTINED')
    return document.scannedAt ? 'PENDING_REVIEW' : 'SCANNING';
  return document.status;
}
export function documentsReady(
  documents: readonly OnboardingDocument[],
  required: readonly string[],
) {
  return (
    required.length > 0 &&
    required.every(type => {
      const state = documentState(latestDocument(documents, type));
      return state === 'VERIFIED' || state === 'PENDING_REVIEW';
    })
  );
}
export function editableVehicle(vehicles: readonly OnboardingVehicle[]) {
  return (
    vehicles.find(vehicle => ['DRAFT', 'REJECTED'].includes(vehicle.status)) ??
    vehicles.find(
      vehicle => vehicle.status !== 'INACTIVE' && !vehicle.active,
    ) ??
    vehicles.find(vehicle => vehicle.active) ??
    null
  );
}
