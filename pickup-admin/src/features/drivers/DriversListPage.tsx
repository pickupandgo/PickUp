'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { ConfirmDialog } from '@/components/ui/Modal/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Loader } from '@/components/ui/Loader/Loader';
import { PageSkeleton } from '@/components/ui/PageSkeleton/PageSkeleton';
import { Pagination } from '@/components/ui/Pagination/Pagination';
import * as driverService from '@/services/driverService';
import type { Driver, DriverStatus, KYCStatus, EligibilityStatus, OnlineStatus, VehicleCategory } from '@/types/driver';
import m from '@/components/ui/shared/module.module.css';

const PAGE_SIZE = 10;

const STATUS_COLORS: Record<DriverStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  approved: 'success', pending: 'warning', suspended: 'warning', blocked: 'danger',
};
const KYC_COLORS: Record<KYCStatus, 'success' | 'warning' | 'danger'> = {
  approved: 'success', pending: 'warning', rejected: 'danger',
};

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

const VEHICLE_CATEGORIES: VehicleCategory[] = ['2-Wheeler', '3-Wheeler', 'Mini Truck', 'Pickup', 'JCB', 'Crane'];

export default function DriversListPage() {
  const router = useRouter();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DriverStatus | 'all'>('all');
  const [kycFilter, setKycFilter] = useState<KYCStatus | 'all'>('all');
  const [eligFilter, setEligFilter] = useState<EligibilityStatus | 'all'>('all');
  const [onlineFilter, setOnlineFilter] = useState<OnlineStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ id: string; action: 'approve' | 'reject' | 'suspend' | 'block' | 'unblock' } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await driverService.getDrivers({ search, status: statusFilter, kycStatus: kycFilter, eligibility: eligFilter, onlineStatus: onlineFilter });
    setDrivers(data);
    setPage(1);
    setLoading(false);
  }, [search, statusFilter, kycFilter, eligFilter, onlineFilter]);

  useEffect(() => { load(); }, [load]);

  const paginated = drivers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const ACTION_MAP = {
    approve: { fn: driverService.approveDriver, msg: 'Driver approved successfully' },
    reject: { fn: driverService.rejectDriver, msg: 'Driver rejected' },
    suspend: { fn: driverService.suspendDriver, msg: 'Driver suspended' },
    block: { fn: driverService.blockDriver, msg: 'Driver blocked successfully' },
    unblock: { fn: driverService.unblockDriver, msg: 'Driver unblocked successfully' },
  };

  const handleAction = async () => {
    if (!confirm) return;
    setActionLoading(true);
    const { fn, msg } = ACTION_MAP[confirm.action];
    await fn(confirm.id);
    toast.success(msg);
    setActionLoading(false);
    setConfirm(null);
    load();
  };

  const CONFIRM_CONFIG = {
    approve: { variant: 'info' as const, title: 'Approve Driver?', desc: 'This will approve the driver and allow them to accept bookings.' },
    reject: { variant: 'warning' as const, title: 'Reject Driver?', desc: 'This driver will be moved back to pending status.' },
    suspend: { variant: 'warning' as const, title: 'Suspend Driver?', desc: 'This driver will be temporarily suspended and cannot accept bookings.' },
    block: { variant: 'danger' as const, title: 'Block Driver?', desc: 'This will permanently block the driver from the platform.' },
    unblock: { variant: 'warning' as const, title: 'Unblock Driver?', desc: 'This will restore access for the driver.' },
  };

  return (
    <AdminLayout pageTitle="Drivers">
      {loading ? (
        <PageSkeleton rows={8} showToolbar />
      ) : (
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Drivers</h2>
            <p className={m.pageSubtitle}>Manage driver accounts, KYC status, eligibility, and operations</p>
          </div>
        </div>

        <div className={m.toolbar}>
          <div className={m.toolbarLeft}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
              <input className={m.filterSelect} style={{ paddingLeft: 36, width: '100%' }} placeholder="Search name, phone, ID, vehicle…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search drivers" />
              {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--color-text-tertiary)' }} aria-label="Clear search"><X size={14} /></button>}
            </div>
          </div>
          <div className={m.toolbarRight}>
            <select className={m.filterSelect} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as DriverStatus | 'all')} aria-label="Filter status">
              <option value="all">All Status</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="suspended">Suspended</option>
              <option value="blocked">Blocked</option>
            </select>
            <select className={m.filterSelect} value={kycFilter} onChange={(e) => setKycFilter(e.target.value as KYCStatus | 'all')} aria-label="Filter KYC">
              <option value="all">All KYC</option>
              <option value="approved">KYC Approved</option>
              <option value="pending">KYC Pending</option>
              <option value="rejected">KYC Rejected</option>
            </select>
            <select className={m.filterSelect} value={eligFilter} onChange={(e) => setEligFilter(e.target.value as EligibilityStatus | 'all')} aria-label="Filter eligibility">
              <option value="all">All Eligibility</option>
              <option value="eligible">Eligible</option>
              <option value="ineligible">Ineligible</option>
            </select>
            <select className={m.filterSelect} value={onlineFilter} onChange={(e) => setOnlineFilter(e.target.value as OnlineStatus | 'all')} aria-label="Filter online status">
              <option value="all">All Online</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
            </select>
          </div>
        </div>

        <div className={m.tableCard}>
          {drivers.length === 0 ? (
            <EmptyState title="No drivers found" description="Try adjusting your search or filters." />
          ) : (
            <>
              <div className={`${m.tableWrap} admin-table-wrap`}>
                <table>
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th>Driver ID</th>
                      <th>Phone</th>
                      <th>Vehicle</th>
                      <th>KYC</th>
                      <th>Online</th>
                      <th>Eligibility</th>
                      <th>Wallet</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <div className={m.cellAvatar}>
                            <div className={m.avatarCircle} style={{ background: 'var(--color-success-50)', color: 'var(--color-success-700)' }}>{initials(d.name)}</div>
                            <div>
                              <div className={m.cellPrimary}>{d.name}</div>
                              <div className={m.cellSecondary}>{d.vehicleCategory}</div>
                            </div>
                          </div>
                        </td>
                        <td><span className={m.cellId}>{d.id}</span></td>
                        <td>{d.phone}</td>
                        <td>
                          <div className={m.cellPrimary}>{d.vehicleNumber}</div>
                          <div className={m.cellSecondary}>{d.vehicleCategory}</div>
                        </td>
                        <td><Badge variant={KYC_COLORS[d.kycStatus]}>{d.kycStatus.charAt(0).toUpperCase() + d.kycStatus.slice(1)}</Badge></td>
                        <td><Badge variant={d.onlineStatus === 'online' ? 'success' : 'neutral'} dot>{d.onlineStatus === 'online' ? 'Online' : 'Offline'}</Badge></td>
                        <td><Badge variant={d.eligibility === 'eligible' ? 'success' : 'danger'}>{d.eligibility === 'eligible' ? 'Eligible' : 'Ineligible'}</Badge></td>
                        <td style={{ fontWeight: 600 }}>₹{d.walletBalance.toLocaleString('en-IN')}</td>
                        <td><Badge variant={STATUS_COLORS[d.status]}>{d.status.charAt(0).toUpperCase() + d.status.slice(1)}</Badge></td>
                        <td>
                          <div className={m.actionCell}>
                            <Button size="sm" variant="ghost" onClick={() => router.push(`/drivers/${d.id}`)} leftIcon={<Eye size={14} />}>View</Button>
                            {d.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: d.id, action: 'approve' })} style={{ color: 'var(--color-success-600)' }}>Approve</Button>}
                            {d.status === 'approved' && <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: d.id, action: 'suspend' })} style={{ color: 'var(--color-warning-600)' }}>Suspend</Button>}
                            {(d.status === 'approved' || d.status === 'suspended') && <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: d.id, action: 'block' })} style={{ color: 'var(--color-danger-600)' }}>Block</Button>}
                            {d.status === 'blocked' && <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: d.id, action: 'unblock' })} style={{ color: 'var(--color-success-600)' }}>Unblock</Button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={m.resultCount}><span>{drivers.length} driver{drivers.length !== 1 ? 's' : ''} found</span></div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={drivers.length} onPageChange={setPage} />
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
          variant={CONFIRM_CONFIG[confirm.action].variant}
          title={CONFIRM_CONFIG[confirm.action].title}
          description={CONFIRM_CONFIG[confirm.action].desc}
          confirmLabel={confirm.action.charAt(0).toUpperCase() + confirm.action.slice(1)}
        />
      )}
    </AdminLayout>
  );
}
