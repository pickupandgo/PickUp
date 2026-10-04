'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Ban, CheckCircle, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { ConfirmDialog } from '@/components/ui/Modal/ConfirmDialog';
import { Loader } from '@/components/ui/Loader/Loader';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import * as customerService from '@/services/customerService';
import type { Customer } from '@/types/customer';
import { useAuth } from '@/context/AuthContext';
import m from '@/components/ui/shared/module.module.css';
import styles from './CustomerDetailPage.module.css';

interface Props { customerId: string }

export default function CustomerDetailPage({ customerId }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await customerService.getCustomerById(customerId);
    setCustomer(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [customerId]);

  const handleBlockToggle = async () => {
    if (!customer) return;
    setActionLoading(true);
    if (customer.status === 'active') {
      await customerService.blockCustomer(customer.id);
      toast.success('Customer blocked successfully');
    } else {
      await customerService.unblockCustomer(customer.id);
      toast.success('Customer unblocked successfully');
    }
    setActionLoading(false);
    setConfirmBlock(false);
    load();
  };

  const handleAddNote = async () => {
    if (!customer || !noteText.trim()) return;
    setAddingNote(true);
    await customerService.addCustomerNote(customer.id, noteText.trim(), user?.name ?? 'Admin');
    toast.success('Note added');
    setNoteText('');
    setAddingNote(false);
    load();
  };

  if (loading) return <AdminLayout pageTitle="Customer Detail"><Loader fullPage /></AdminLayout>;
  if (!customer) return (
    <AdminLayout pageTitle="Customer Detail">
      <EmptyState title="Customer not found" description="This customer ID does not exist." action={<Button onClick={() => router.push('/customers')}>Back to Customers</Button>} />
    </AdminLayout>
  );

  const bookingStatusBadge = (s: string) => {
    if (s === 'completed') return <Badge variant="success">Completed</Badge>;
    if (s === 'cancelled') return <Badge variant="danger">Cancelled</Badge>;
    return <Badge variant="info">In Progress</Badge>;
  };

  return (
    <AdminLayout pageTitle={`Customer — ${customer.name}`}>
      <div className={m.detailPage}>
        {/* Header */}
        <div className={m.detailHeader}>
          <button className={m.backBtn} onClick={() => router.push('/customers')}><ArrowLeft size={16} /> Customers</button>
          <h2 className={m.detailTitle}>{customer.name}</h2>
          <div className={m.detailHeaderRight}>
            {customer.status === 'active'
              ? <Button variant="danger" size="sm" onClick={() => setConfirmBlock(true)} leftIcon={<Ban size={14} />}>Block Customer</Button>
              : <Button variant="secondary" size="sm" onClick={() => setConfirmBlock(true)} leftIcon={<CheckCircle size={14} />}>Unblock Customer</Button>
            }
          </div>
        </div>

        {/* Stats */}
        <div className={m.statBoxes}>
          {[
            { label: 'Total Bookings', value: customer.totalBookings },
            { label: 'Completed', value: customer.completedTrips },
            { label: 'Cancelled', value: customer.cancelledTrips },
            { label: 'Total Spent', value: `₹${customer.totalSpent.toLocaleString('en-IN')}` },
          ].map((s) => (
            <div key={s.label} className={m.statBox}>
              <div className={m.statBoxValue}>{s.value}</div>
              <div className={m.statBoxLabel}>{s.label}</div>
            </div>
          ))}
        </div>

        <div className={m.detailGrid}>
          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {/* Profile */}
            <Card>
              <CardHeader title="Customer Profile" />
              <div className={m.infoGrid}>
                <div className={m.infoItem}><span className={m.infoLabel}>Customer ID</span><span className={m.infoValue}><span className={m.cellId}>{customer.id}</span></span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Name</span><span className={m.infoValue}>{customer.name}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Phone</span><span className={m.infoValue}>{customer.phone}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Email</span><span className={m.infoValue}>{customer.email ?? '—'}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>City</span><span className={m.infoValue}>{customer.city}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Registered</span><span className={m.infoValue}>{customer.registeredAt}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Account Status</span><span className={m.infoValue}>{customer.status === 'active' ? <Badge variant="success" dot>Active</Badge> : <Badge variant="danger" dot>Blocked</Badge>}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Payment Status</span><span className={m.infoValue}>{customer.paymentStatus === 'clear' ? <Badge variant="success">Clear</Badge> : customer.paymentStatus === 'outstanding' ? <Badge variant="warning">Outstanding</Badge> : <Badge variant="danger">Suspended</Badge>}</span></div>
              </div>
            </Card>

            {/* Booking History */}
            <Card padding="none">
              <div style={{ padding: 'var(--space-5) var(--space-5) 0' }}>
                <CardHeader title="Booking History" description="Recent bookings by this customer" />
              </div>
              {customer.bookingHistory.length === 0 ? (
                <EmptyState title="No bookings yet" description="This customer has no booking history." />
              ) : (
                <div className={`${m.tableWrap} admin-table-wrap`}>
                  <table>
                    <thead>
                      <tr>
                        <th>Booking ID</th>
                        <th>Date</th>
                        <th>Pickup</th>
                        <th>Drop</th>
                        <th>Vehicle</th>
                        <th>Amount</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customer.bookingHistory.map((b) => (
                        <tr key={b.bookingId}>
                          <td><span className={m.cellId}>{b.bookingId}</span></td>
                          <td style={{ color: 'var(--color-text-secondary)' }}>{b.date}</td>
                          <td>{b.pickupAddress}</td>
                          <td>{b.dropSummary}</td>
                          <td><Badge variant="neutral">{b.vehicleCategory}</Badge></td>
                          <td style={{ fontWeight: 600 }}>₹{b.amount.toLocaleString('en-IN')}</td>
                          <td>{bookingStatusBadge(b.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {/* Internal Notes */}
            <Card>
              <CardHeader title="Internal Notes" description="Admin-only notes" />
              {customer.notes.length === 0 && <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-4)' }}>No notes yet.</p>}
              <div className={styles.notesList}>
                {customer.notes.map((n) => (
                  <div key={n.id} className={styles.noteItem}>
                    <p className={styles.noteText}>{n.text}</p>
                    <p className={styles.noteMeta}>{n.addedBy} · {n.addedAt}</p>
                  </div>
                ))}
              </div>
              <div className={styles.noteAdd}>
                <textarea
                  className={styles.noteInput}
                  placeholder="Add an internal note…"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={3}
                  aria-label="Add note"
                />
                <Button size="sm" variant="primary" onClick={handleAddNote} isLoading={addingNote} disabled={!noteText.trim()} leftIcon={<Plus size={13} />}>Add Note</Button>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        onConfirm={handleBlockToggle}
        isLoading={actionLoading}
        variant={customer.status === 'active' ? 'danger' : 'warning'}
        title={customer.status === 'active' ? 'Block Customer?' : 'Unblock Customer?'}
        description={customer.status === 'active'
          ? `Block ${customer.name}? They will not be able to place new bookings.`
          : `Restore access for ${customer.name}?`
        }
        confirmLabel={customer.status === 'active' ? 'Block Customer' : 'Unblock Customer'}
      />
    </AdminLayout>
  );
}
