'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Eye } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { PageSkeleton } from '@/components/ui/PageSkeleton/PageSkeleton';
import { Pagination } from '@/components/ui/Pagination/Pagination';
import * as bookingService from '@/services/bookingService';
import type { Booking, BookingStatus } from '@/types/booking';
import m from '@/components/ui/shared/module.module.css';

const PAGE_SIZE = 10;
const STATUS_OPTIONS: BookingStatus[] = [
  'Pending', 'Searching Driver', 'Driver Assigned', 'Driver Arrived', 
  'Pickup Completed', 'In Transit', 'Partially Delivered', 'Completed', 'Cancelled'
];

export default function BookingsListPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>('all');
  const [paymentFilter, setPaymentFilter] = useState<string | 'all'>('all');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await bookingService.getBookings({ search, status: statusFilter, paymentStatus: paymentFilter });
    setBookings(data);
    setPage(1);
    setLoading(false);
  }, [search, statusFilter, paymentFilter]);

  useEffect(() => { load(); }, [load]);

  const paginated = bookings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const getStatusColor = (status: BookingStatus) => {
    switch (status) {
      case 'Completed': return 'success';
      case 'Cancelled': return 'danger';
      case 'Pending': 
      case 'Searching Driver': return 'warning';
      default: return 'info';
    }
  };

  const getPaymentColor = (status: string) => {
    switch (status) {
      case 'Completed': return 'success';
      case 'Failed': return 'danger';
      case 'Refunded': return 'neutral';
      default: return 'warning';
    }
  };

  return (
    <AdminLayout pageTitle="Bookings">
      {loading ? (
        <PageSkeleton rows={8} showToolbar />
      ) : (
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Bookings</h2>
            <p className={m.pageSubtitle}>Manage and monitor logistics trips</p>
          </div>
        </div>

        <div className={m.toolbar}>
          <div className={m.toolbarLeft}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
              <input 
                className={m.filterSelect} 
                style={{ paddingLeft: 36, width: '250px' }} 
                placeholder="Search ID, Customer, Driver..." 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
              />
              {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--color-text-tertiary)' }}><X size={14} /></button>}
            </div>
          </div>
          <div className={m.toolbarRight}>
            <select className={m.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="all">All Statuses</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className={m.filterSelect} value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}>
              <option value="all">All Payments</option>
              <option value="Completed">Completed</option>
              <option value="Pending">Pending</option>
              <option value="Refunded">Refunded</option>
            </select>
          </div>
        </div>

        <div className={m.tableCard}>
          {bookings.length === 0 ? (
            <EmptyState title="No bookings found" description="Try adjusting your search or filters." />
          ) : (
            <>
              <div className={`${m.tableWrap} admin-table-wrap`}>
                <table>
                  <thead>
                    <tr>
                      <th>Booking ID</th>
                      <th>Date / Time</th>
                      <th>Customer</th>
                      <th>Driver / Vehicle</th>
                      <th>Pickup / Drops</th>
                      <th>Fare</th>
                      <th>Payment</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((b) => (
                      <tr key={b.id}>
                        <td><span className={m.cellId}>{b.id}</span></td>
                        <td style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' }}>
                          {new Date(b.bookingDate).toLocaleString()}
                        </td>
                        <td>
                          <div className={m.cellPrimary}>{b.customerName}</div>
                          <div className={m.cellSecondary}>{b.customerPhone}</div>
                        </td>
                        <td>
                          {b.driverId ? (
                            <>
                              <div className={m.cellPrimary}>{b.driverName}</div>
                              <div className={m.cellSecondary}>{b.vehicleRegistrationNumber} ({b.vehicleCategoryName.split(' / ')[0]})</div>
                            </>
                          ) : (
                            <span style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic', fontSize: 'var(--font-size-xs)' }}>Not assigned</span>
                          )}
                        </td>
                        <td>
                          <div className={m.cellPrimary} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.pickup.landmark || b.pickup.address.split(',')[0]}</div>
                          <div className={m.cellSecondary}>{b.drops.length} drop(s)</div>
                        </td>
                        <td style={{ fontWeight: 600 }}>₹{b.fare.totalFare}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>{b.payment.method}</span>
                            <Badge variant={getPaymentColor(b.payment.status)}>{b.payment.status}</Badge>
                          </div>
                        </td>
                        <td>
                          <Badge variant={getStatusColor(b.status)}>{b.status}</Badge>
                        </td>
                        <td>
                          <div className={m.actionCell}>
                            <Button size="sm" variant="ghost" onClick={() => router.push(`/bookings/${b.id}`)} leftIcon={<Eye size={14} />}>View</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={m.resultCount}><span>{bookings.length} booking{bookings.length !== 1 ? 's' : ''} found</span></div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={bookings.length} onPageChange={setPage} />
            </>
          )}
        </div>
      </div>
      )}
    </AdminLayout>
  );
}
