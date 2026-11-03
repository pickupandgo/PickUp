import type { BadgeVariant } from '../../components/atoms/StatusBadge';
import type { EarningDto } from '../payments/earningsDto';
import type { TripHistoryRecord } from '../../types/tripHistory';
import { formatRupees, paiseToRupees } from '../payments/money';

export const historyMoney = (paise: number) => formatRupees(paiseToRupees(paise));
export function historyTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  try {
    return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return `${new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ')} IST`;
  }
}
export const historyDate = (trip: TripHistoryRecord) => historyTime(trip.completedAt ?? trip.cancelledAt ?? trip.createdAt);
export function historyTimeline(trip: TripHistoryRecord, now = Date.now()) {
  const points = [...trip.timeline];
  if (trip.earning?.status === 'PAID' && trip.earning.paidAt) points.push({ label: 'Settlement paid', at: trip.earning.paidAt });
  return points.filter(point => Date.parse(point.at) <= now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
export const settlementMethod = (earning: EarningDto) => ({ ONLINE: 'Online', CASH: 'Cash', MIXED: 'Cash + online' }[earning.settlement]);
export function historyStatus(status: string): { label: string; variant: BadgeVariant } {
  if (status === 'COMPLETED') return { label: 'Completed', variant: 'approved' };
  if (status === 'CANCELLED') return { label: 'Cancelled', variant: 'rejected' };
  const labels: Record<string, string> = { DRIVER_ASSIGNED: 'Assigned', DRIVER_ARRIVED: 'At pickup', PICKUP_VERIFIED: 'Pickup verified',
    IN_TRANSIT: 'In transit', DROP_PROGRESS: 'Delivering', DELIVERED: 'Deliveries finished' };
  return { label: labels[status] ?? status.replace(/_/g, ' '), variant: labels[status] ? 'active' : 'expired' };
}
export function historyVehicle(category: string | null) {
  const labels: Record<string, string> = { TWO_WHEELER: 'Bike', THREE_WHEELER: 'Cargo three-wheeler', FOUR_WHEELER: 'Four-wheeler',
    MINI_TRUCK: 'Mini truck', PICKUP_TRUCK: 'Pickup truck' };
  return { label: category ? labels[category] ?? category.replace(/_/g, ' ') : 'Vehicle category unavailable',
    icon: category === 'TWO_WHEELER' ? 'two_wheeler' : category === 'FOUR_WHEELER' ? 'directions_car' : 'local_shipping' };
}
export function historyEarningLabel(earning: EarningDto): string {
  const labels = { AWAITING_SETTLEMENT: 'Awaiting settlement', PAYABLE: 'Payable', ON_HOLD: 'On hold', IN_PAYOUT: 'In payout',
    PAID: 'Paid', SETTLED_IN_CASH: 'Settled in cash' };
  const label = labels[earning.status];
  return earning.settlement === 'MIXED' ? `Cash + online · ${label}` : label;
}
