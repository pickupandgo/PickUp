'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Eye, Ban, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { ConfirmDialog } from '@/components/ui/Modal/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { PageSkeleton } from '@/components/ui/PageSkeleton/PageSkeleton';
import { Pagination } from '@/components/ui/Pagination/Pagination';
import * as customerService from '@/services/customerService';
import type { Customer, CustomerStatus, PaymentStatus } from '@/types/customer';
import m from '@/components/ui/shared/module.module.css';

const PAGE_SIZE = 10;

function getStatusBadge(status: CustomerStatus) {
  return status === 'active'
    ? <Badge variant="success" dot>Active</Badge>
    : <Badge variant="danger" dot>Blocked</Badge>;
}

function getPaymentBadge(ps: PaymentStatus) {
  if (ps === 'clear') return <Badge variant="success">Clear</Badge>;
  if (ps === 'outstanding') return <Badge variant="warning">Outstanding</Badge>;
  return <Badge variant="danger">Suspended</Badge>;
}

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

export default function CustomersListPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | 'all'>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ id: string; action: 'block' | 'unblock' } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await customerService.getCustomers({ search, status: statusFilter, paymentStatus: paymentFilter });
    setCustomers(data);
    setPage(1);
    setLoading(false);
  }, [search, statusFilter, paymentFilter]);

  useEffect(() => { load(); }, [load]);

  const paginated = customers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleAction = async () => {
    if (!confirm) return;
    setActionLoading(true);
    if (confirm.action === 'block') {
      await customerService.blockCustomer(confirm.id);
      toast.success('Customer blocked successfully');
    } else {
      await customerService.unblockCustomer(confirm.id);
      toast.success('Customer unblocked successfully');
    }
    setActionLoading(false);
    setConfirm(null);
    load();
  };

  return (
    <AdminLayout pageTitle="Customers">
      {loading ? (
        <PageSkeleton rows={8} showToolbar />
      ) : (
      <div className={m.page}>
        {/* Header */}
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Customers</h2>
            <p className={m.pageSubtitle}>Manage customer accounts, booking history, and status</p>
          </div>
        </div>

        {/* Toolbar */}
        <div className={m.toolbar}>
          <div className={m.toolbarLeft}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
              <input
                className={m.filterSelect}
                style={{ paddingLeft: 36, width: '100%' }}
                placeholder="Search name, phone, ID…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search customers"
              />
              {search && (
                <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--color-text-tertiary)' }} aria-label="Clear search">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <div className={m.toolbarRight}>
            <select className={m.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CustomerStatus | 'all')} aria-label="Filter by status">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="blocked">Blocked</option>
            </select>
            <select className={m.filterSelect} value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value as PaymentStatus | 'all')} aria-label="Filter by payment">
              <option value="all">All Payments</option>
              <option value="clear">Clear</option>
              <option value="outstanding">Outstanding</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className={m.tableCard}>
          {customers.length === 0 ? (
            <EmptyState title="No customers found" description="Try adjusting your search or filters." />
          ) : (
            <>
              <div className={`${m.tableWrap} admin-table-wrap`}>
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Customer ID</th>
                      <th>Phone</th>
                      <th>Bookings</th>
                      <th>Completed</th>
                      <th>Cancelled</th>
                      <th>Payment</th>
                      <th>Status</th>
                      <th>Registered</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <div className={m.cellAvatar}>
                            <div className={m.avatarCircle}>{initials(c.name)}</div>
                            <div>
                              <div className={m.cellPrimary}>{c.name}</div>
                              {c.email && <div className={m.cellSecondary}>{c.email}</div>}
                            </div>
                          </div>
                        </td>
                        <td><span className={m.cellId}>{c.id}</span></td>
                        <td>{c.phone}</td>
                        <td style={{ textAlign: 'center' }}>{c.totalBookings}</td>
                        <td style={{ textAlign: 'center' }}>{c.completedTrips}</td>
                        <td style={{ textAlign: 'center' }}>{c.cancelledTrips}</td>
                        <td>{getPaymentBadge(c.paymentStatus)}</td>
                        <td>{getStatusBadge(c.status)}</td>
                        <td style={{ color: 'var(--color-text-secondary)' }}>{c.registeredAt}</td>
                        <td>
                          <div className={m.actionCell}>
                            <Button size="sm" variant="ghost" onClick={() => router.push(`/customers/${c.id}`)} leftIcon={<Eye size={14} />}>View</Button>
                            {c.status === 'active'
                              ? <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: c.id, action: 'block' })} leftIcon={<Ban size={14} />} style={{ color: 'var(--color-danger-600)' }}>Block</Button>
                              : <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: c.id, action: 'unblock' })} leftIcon={<CheckCircle size={14} />} style={{ color: 'var(--color-success-600)' }}>Unblock</Button>
                            }
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={m.resultCount}>
                <span>{customers.length} customer{customers.length !== 1 ? 's' : ''} found</span>
              </div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={customers.length} onPageChange={setPage} />
            </>
          )}
        </div>
      </div>
      )}

      {confirm && (
        <ConfirmDialog
          isOpen
          onClose={() => setConfirm(null)}
          onConfirm={handleAction}
          isLoading={actionLoading}
          variant={confirm.action === 'block' ? 'danger' : 'warning'}
          title={confirm.action === 'block' ? 'Block Customer?' : 'Unblock Customer?'}
          description={
            confirm.action === 'block'
              ? 'This will prevent the customer from using the platform. They will not be able to place new bookings.'
              : 'This will restore access for the customer. They will be able to use the platform again.'
          }
          confirmLabel={confirm.action === 'block' ? 'Block Customer' : 'Unblock Customer'}
        />
      )}
    </AdminLayout>
  );
}
