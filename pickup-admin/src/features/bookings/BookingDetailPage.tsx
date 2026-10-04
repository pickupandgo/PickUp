'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, User, Car, MapPin, Package, Shield, IndianRupee, Ban, RefreshCw, Activity, MessageSquare } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { Modal } from '@/components/ui/Modal/Modal';
import { Loader } from '@/components/ui/Loader/Loader';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import * as bookingService from '@/services/bookingService';
import type { Booking, BookingStatus } from '@/types/booking';
import m from '@/components/ui/shared/module.module.css';
import styles from './BookingDetailPage.module.css';

interface Props { bookingId: string }

const ALL_STATUSES: BookingStatus[] = [
  'Pending', 'Searching Driver', 'Driver Assigned', 'Driver Arrived', 
  'Pickup Completed', 'In Transit', 'Partially Delivered', 'Completed', 'Cancelled'
];

export default function BookingDetailPage({ bookingId }: Props) {
  const router = useRouter();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showReassign, setShowReassign] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showNote, setShowNote] = useState(false);

  // Form states
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelNote, setCancelNote] = useState('');
  const [newStatus, setNewStatus] = useState<BookingStatus>('Pending');
  const [internalNote, setInternalNote] = useState('');

  const load = async () => {
    setLoading(true);
    const data = await bookingService.getBookingById(bookingId);
    setBooking(data);
    if (data) setNewStatus(data.status);
    setLoading(false);
  };

  useEffect(() => { load(); }, [bookingId]);

  const handleReassign = async () => {
    if (!selectedDriver) return;
    setActionLoading(true);
    await bookingService.reassignDriver(bookingId, selectedDriver);
    toast.success('Driver reassigned successfully');
    setActionLoading(false);
    setShowReassign(false);
    load();
  };

  const handleCancel = async () => {
    if (!cancelReason) return toast.error('Reason required');
    setActionLoading(true);
    await bookingService.cancelBooking(bookingId, cancelReason, cancelNote);
    toast.success('Booking cancelled');
    setActionLoading(false);
    setShowCancel(false);
    load();
  };

  const handleUpdateStatus = async () => {
    setActionLoading(true);
    await bookingService.updateBookingStatus(bookingId, newStatus);
    toast.success('Status updated');
    setActionLoading(false);
    setShowStatus(false);
    load();
  };

  const handleAddNote = async () => {
    if (!internalNote) return;
    setActionLoading(true);
    await bookingService.addInternalNote(bookingId, internalNote, 'Admin User');
    toast.success('Note added');
    setInternalNote('');
    setActionLoading(false);
    setShowNote(false);
    load();
  };

  if (loading) return <AdminLayout pageTitle="Booking Detail"><Loader fullPage /></AdminLayout>;
  if (!booking) return (
    <AdminLayout pageTitle="Booking Detail">
      <EmptyState title="Booking not found" action={<Button onClick={() => router.push('/bookings')}>Back to Bookings</Button>} description="" />
    </AdminLayout>
  );

  const isCancelled = booking.status === 'Cancelled';
  const isCompleted = booking.status === 'Completed';

  return (
    <AdminLayout pageTitle={`Booking — ${booking.id}`}>
      <div className={m.detailPage}>
        {/* Header */}
        <div className={m.detailHeader}>
          <button className={m.backBtn} onClick={() => router.push('/bookings')}><ArrowLeft size={16} /> Bookings</button>
          <div>
            <h2 className={m.detailTitle} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              {booking.id}
              <Badge variant={isCompleted ? 'success' : isCancelled ? 'danger' : 'warning'}>{booking.status}</Badge>
            </h2>
            <p className={m.pageSubtitle}>Created: {new Date(booking.bookingDate).toLocaleString()}</p>
          </div>
          <div className={m.detailHeaderRight}>
            {!isCancelled && !isCompleted && (
              <>
                <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => setShowReassign(true)}>Reassign</Button>
                <Button variant="outline" size="sm" leftIcon={<Activity size={14} />} onClick={() => setShowStatus(true)}>Update Status</Button>
                <Button variant="danger" size="sm" leftIcon={<Ban size={14} />} onClick={() => setShowCancel(true)}>Cancel Trip</Button>
              </>
            )}
            <Button variant="secondary" size="sm" leftIcon={<MessageSquare size={14} />} onClick={() => setShowNote(true)}>Add Note</Button>
          </div>
        </div>

        <div className={m.detailGrid} style={{ gridTemplateColumns: '2fr 1fr' }}>
          
          {/* LEFT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            
            {/* Route / Stops */}
            <Card>
              <CardHeader title="Route & Stops" icon={<MapPin size={18} />} />
              <div style={{ padding: '0 var(--space-4)' }}>
                {/* Pickup */}
                <div className={styles.dropCard} style={{ borderLeft: '4px solid var(--color-text-primary)' }}>
                  <div className={styles.dropOrder}>P</div>
                  <div className={styles.dropContent}>
                    <div style={{ fontWeight: 700 }}>Pickup Location</div>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                      {booking.pickup.address}
                      {booking.pickup.landmark && <div>Landmark: {booking.pickup.landmark}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--font-size-sm)' }}>
                      <span><strong>Contact:</strong> {booking.pickup.contactName || booking.customerName}</span>
                      <span><strong>Phone:</strong> {booking.pickup.contactPhone || booking.customerPhone}</span>
                    </div>
                  </div>
                </div>

                {/* Drops */}
                {booking.drops.map((drop, idx) => (
                  <div key={drop.id} className={styles.dropCard} style={{ borderLeft: drop.status === 'Completed' ? '4px solid var(--color-success-500)' : '4px solid var(--color-warning-500)' }}>
                    <div className={styles.dropOrder}>{idx + 1}</div>
                    <div className={styles.dropContent}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div style={{ fontWeight: 700 }}>Drop {idx + 1}</div>
                        <Badge variant={drop.status === 'Completed' ? 'success' : 'warning'}>{drop.status}</Badge>
                      </div>
                      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                        {drop.location.address}
                        {drop.location.landmark && <div>Landmark: {drop.location.landmark}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--font-size-sm)', background: 'white', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                        <span><strong>Receiver:</strong> {drop.receiver.name}</span>
                        <span><strong>Phone:</strong> {drop.receiver.phone}</span>
                      </div>
                      {drop.completedAt && (
                        <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Completed: {new Date(drop.completedAt).toLocaleString()}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Load & Goods */}
            <Card>
              <CardHeader title="Load & Goods Information" icon={<Package size={18} />} />
              <div className={m.infoGrid}>
                <div className={m.infoItem}><span className={m.infoLabel}>Load Type</span><span className={m.infoValue}>{booking.load.type}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Weight (Approx)</span><span className={m.infoValue}>{booking.load.approxWeightKg ? `${booking.load.approxWeightKg} kg` : 'N/A'}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Declared Value</span><span className={m.infoValue}>{booking.load.declaredValue ? `₹${booking.load.declaredValue.toLocaleString()}` : 'Not Declared'}</span></div>
                <div className={m.infoItem} style={{ gridColumn: '1 / -1' }}><span className={m.infoLabel}>Description</span><span className={m.infoValue}>{booking.load.description}</span></div>
                {booking.load.specialInstructions && (
                  <div className={m.infoItem} style={{ gridColumn: '1 / -1' }}><span className={m.infoLabel}>Instructions</span><span className={m.infoValue} style={{ color: 'var(--color-warning-700)' }}>{booking.load.specialInstructions}</span></div>
                )}
              </div>
            </Card>

            {/* Fare Breakdown */}
            <Card>
              <CardHeader title="Fare & Payment" icon={<IndianRupee size={18} />} />
              <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 250 }}>
                  <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: 'var(--space-3)', color: 'var(--color-text-secondary)' }}>Fare Breakdown</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)' }}><span>Base Fare</span><span>₹{booking.fare.baseFare}</span></div>
                    {!!booking.fare.distanceCharge && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)' }}><span>Distance Charge</span><span>₹{booking.fare.distanceCharge}</span></div>}
                    {!!booking.fare.hourlyCharge && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)' }}><span>Hourly Charge</span><span>₹{booking.fare.hourlyCharge}</span></div>}
                    {!!booking.fare.multiDropFee && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)' }}><span>Multi-Drop Fee</span><span>₹{booking.fare.multiDropFee}</span></div>}
                    {!!booking.fare.trafficSurcharge && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)' }}><span>Traffic Surcharge</span><span>₹{booking.fare.trafficSurcharge}</span></div>}
                    {!!booking.fare.insurancePremium && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)' }}><span>Insurance Premium</span><span>₹{booking.fare.insurancePremium}</span></div>}
                    <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 'var(--font-size-md)' }}><span>Total Fare</span><span>₹{booking.fare.totalFare}</span></div>
                  </div>
                </div>
                
                <div style={{ flex: 1, minWidth: 250 }}>
                  <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, marginBottom: 'var(--space-3)', color: 'var(--color-text-secondary)' }}>Payment Information</h4>
                  <div className={m.infoGrid} style={{ gridTemplateColumns: '1fr' }}>
                    <div className={m.infoItem}><span className={m.infoLabel}>Method</span><span className={m.infoValue}>{booking.payment.method}</span></div>
                    <div className={m.infoItem}><span className={m.infoLabel}>Status</span><span className={m.infoValue}><Badge variant={booking.payment.status === 'Completed' ? 'success' : booking.payment.status === 'Refunded' ? 'neutral' : 'warning'}>{booking.payment.status}</Badge></span></div>
                    {booking.payment.referenceId && <div className={m.infoItem}><span className={m.infoLabel}>Reference ID</span><span className={m.infoValue} style={{ fontFamily: 'monospace' }}>{booking.payment.referenceId}</span></div>}
                  </div>
                </div>
              </div>
            </Card>
            
            {/* Cancellation info if applicable */}
            {booking.cancellation && (
              <Card>
                <CardHeader title="Cancellation Details" icon={<Ban size={18} />} />
                <div className={m.infoGrid}>
                  <div className={m.infoItem}><span className={m.infoLabel}>Cancelled By</span><span className={m.infoValue}>{booking.cancellation.cancelledBy}</span></div>
                  <div className={m.infoItem}><span className={m.infoLabel}>Reason</span><span className={m.infoValue}>{booking.cancellation.reason}</span></div>
                  <div className={m.infoItem}><span className={m.infoLabel}>Charge / Penalty</span><span className={m.infoValue}>₹{booking.cancellation.charge}</span></div>
                  <div className={m.infoItem}><span className={m.infoLabel}>Timestamp</span><span className={m.infoValue}>{new Date(booking.cancellation.timestamp).toLocaleString()}</span></div>
                  {booking.cancellation.adminNote && (
                    <div className={m.infoItem} style={{ gridColumn: '1 / -1' }}><span className={m.infoLabel}>Admin Note</span><span className={m.infoValue}>{booking.cancellation.adminNote}</span></div>
                  )}
                </div>
              </Card>
            )}

            {/* Delivery Proof */}
            {booking.deliveryProof && (
              <Card>
                <CardHeader title="Delivery Proof" />
                <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
                  <div style={{ width: 80, height: 80, background: 'var(--color-gray-200)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Photo Placeholder</div>
                  <div className={m.infoGrid} style={{ flex: 1 }}>
                    <div className={m.infoItem}><span className={m.infoLabel}>Timestamp</span><span className={m.infoValue}>{new Date(booking.deliveryProof.timestamp!).toLocaleString()}</span></div>
                    <div className={m.infoItem}><span className={m.infoLabel}>Location</span><span className={m.infoValue}>{booking.deliveryProof.location}</span></div>
                  </div>
                </div>
              </Card>
            )}
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            
            {/* People */}
            <Card>
              <CardHeader title="Customer & Driver" icon={<User size={18} />} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div>
                  <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.04em', marginBottom: 4 }}>Customer</h4>
                  <div style={{ fontWeight: 600 }}>{booking.customerName}</div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{booking.customerPhone}</div>
                  <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--color-text-tertiary)', marginTop: 2 }}>{booking.customerId}</div>
                </div>
                <div style={{ height: 1, background: 'var(--color-border)' }} />
                <div>
                  <h4 style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.04em', marginBottom: 4 }}>Assigned Driver</h4>
                  {booking.driverId ? (
                    <>
                      <div style={{ fontWeight: 600 }}>{booking.driverName}</div>
                      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{booking.driverPhone}</div>
                      <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--color-text-tertiary)', marginTop: 2 }}>{booking.driverId}</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>Not assigned yet</div>
                  )}
                </div>
              </div>
            </Card>

            {/* Vehicle Details */}
            <Card>
              <CardHeader title="Vehicle Info" icon={<Car size={18} />} />
              {booking.vehicleId ? (
                <div className={m.infoGrid} style={{ gridTemplateColumns: '1fr' }}>
                  <div className={m.infoItem}><span className={m.infoLabel}>Registration</span><span className={m.infoValue} style={{ fontWeight: 700, fontFamily: 'monospace' }}>{booking.vehicleRegistrationNumber}</span></div>
                  <div className={m.infoItem}><span className={m.infoLabel}>Category</span><span className={m.infoValue}><Badge variant="neutral">{booking.vehicleCategoryName}</Badge></span></div>
                </div>
              ) : (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>No vehicle assigned</div>
              )}
            </Card>

            {/* Insurance */}
            <Card>
              <CardHeader title="Insurance" icon={<Shield size={18} />} />
              {booking.insurance.selected ? (
                <div className={m.infoGrid} style={{ gridTemplateColumns: '1fr' }}>
                  <div className={m.infoItem}><span className={m.infoLabel}>Status</span><span className={m.infoValue}><Badge variant="success">Secured</Badge></span></div>
                  <div className={m.infoItem}><span className={m.infoLabel}>Provider</span><span className={m.infoValue}>{booking.insurance.provider}</span></div>
                  {booking.insurance.referenceId && <div className={m.infoItem}><span className={m.infoLabel}>Ref ID</span><span className={m.infoValue} style={{ fontFamily: 'monospace' }}>{booking.insurance.referenceId}</span></div>}
                </div>
              ) : (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}>No insurance selected for this trip.</div>
              )}
            </Card>

            {/* Internal Notes */}
            <Card>
              <CardHeader title="Internal Notes" />
              {booking.notes.length === 0 ? (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>No internal notes.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {booking.notes.map(n => (
                    <div key={n.id} className={styles.noteItem}>
                      <div className={styles.noteText}>{n.text}</div>
                      <div className={styles.noteMeta}>{n.addedBy} · {new Date(n.timestamp).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Timeline */}
            <Card>
              <CardHeader title="Trip Timeline" />
              <div className={styles.timeline}>
                {booking.timeline.map((evt, idx) => (
                  <div key={evt.id} className={styles.timelineItem}>
                    <div className={`${styles.timelineDot} ${evt.status === 'Cancelled' ? styles.cancelled : idx === booking.timeline.length - 1 && !isCompleted ? styles.pending : ''}`} />
                    <div className={styles.timelineContent}>
                      <span className={styles.timelineStatus}>{evt.status}</span>
                      <span className={styles.timelineTime}>{new Date(evt.timestamp).toLocaleString()}</span>
                      {evt.description && <span className={styles.timelineDesc}>{evt.description}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

          </div>
        </div>
      </div>

      {/* Modals */}
      <Modal isOpen={showReassign} onClose={() => setShowReassign(false)} title="Reassign Driver" size="sm">
        <div className={styles.formGroup}>
          <label className={styles.label}>Select Eligible Driver</label>
          <select className={styles.select} value={selectedDriver} onChange={e => setSelectedDriver(e.target.value)}>
            <option value="">-- Choose Driver --</option>
            <option value="DRV-002">Amit Patel (RJ19BB5555 - Tata Ace)</option>
            <option value="DRV-004">Sunil Verma (RJ19DD7777 - Tata Ace)</option>
          </select>
          <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Only shows available drivers matching category.</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          <Button variant="secondary" onClick={() => setShowReassign(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleReassign} isLoading={actionLoading}>Confirm Reassignment</Button>
        </div>
      </Modal>

      <Modal isOpen={showStatus} onClose={() => setShowStatus(false)} title="Update Status Manually" size="sm">
        <div className={styles.formGroup}>
          <label className={styles.label}>New Status</label>
          <select className={styles.select} value={newStatus} onChange={e => setNewStatus(e.target.value as BookingStatus)}>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span style={{ fontSize: '11px', color: 'var(--color-warning-600)' }}>Warning: Manual status overrides can break driver app flow.</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          <Button variant="secondary" onClick={() => setShowStatus(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleUpdateStatus} isLoading={actionLoading}>Update Status</Button>
        </div>
      </Modal>

      <Modal isOpen={showCancel} onClose={() => setShowCancel(false)} title="Exceptional Cancellation" size="sm">
        <div className={styles.formGroup}>
          <label className={styles.label}>Cancellation Reason</label>
          <select className={styles.select} value={cancelReason} onChange={e => setCancelReason(e.target.value)}>
            <option value="">-- Select Reason --</option>
            <option value="Vehicle broke down">Vehicle broke down</option>
            <option value="Customer requested via support">Customer requested via support</option>
            <option value="Driver unresponsive">Driver unresponsive</option>
            <option value="Prohibited goods">Prohibited goods</option>
          </select>
        </div>
        <div className={styles.formGroup}>
          <label className={styles.label}>Internal Note (Optional)</label>
          <textarea className={styles.textarea} rows={3} value={cancelNote} onChange={e => setCancelNote(e.target.value)} placeholder="Provide context..." />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          <Button variant="secondary" onClick={() => setShowCancel(false)}>Back</Button>
          <Button variant="danger" onClick={handleCancel} isLoading={actionLoading}>Cancel Trip</Button>
        </div>
      </Modal>

      <Modal isOpen={showNote} onClose={() => setShowNote(false)} title="Add Internal Note" size="sm">
        <div className={styles.formGroup}>
          <label className={styles.label}>Note Content</label>
          <textarea className={styles.textarea} rows={4} value={internalNote} onChange={e => setInternalNote(e.target.value)} placeholder="Visible only to admins..." />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          <Button variant="secondary" onClick={() => setShowNote(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleAddNote} isLoading={actionLoading}>Save Note</Button>
        </div>
      </Modal>
    </AdminLayout>
  );
}
