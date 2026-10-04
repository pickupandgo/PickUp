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
import { PageSkeleton } from '@/components/ui/PageSkeleton/PageSkeleton';
import { Pagination } from '@/components/ui/Pagination/Pagination';
import * as vehicleService from '@/services/vehicleService';
import type { Vehicle, VehicleVerificationStatus, VehicleOperationalStatus } from '@/types/vehicle';
import type { VehicleCategory } from '@/types/driver';
import m from '@/components/ui/shared/module.module.css';

const PAGE_SIZE = 10;
const VEHICLE_CATEGORIES: VehicleCategory[] = ['2-Wheeler', '3-Wheeler', 'Mini Truck', 'Pickup', 'JCB', 'Crane'];

const VERIFY_BADGE: Record<VehicleVerificationStatus, React.ReactNode> = {
  approved: <Badge variant="success">Approved</Badge>,
  pending: <Badge variant="warning">Pending</Badge>,
  rejected: <Badge variant="danger">Rejected</Badge>,
};
const OPS_BADGE: Record<VehicleOperationalStatus, React.ReactNode> = {
  enabled: <Badge variant="success" dot>Enabled</Badge>,
  disabled: <Badge variant="neutral" dot>Disabled</Badge>,
};

export default function VehiclesListPage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<VehicleCategory | 'all'>('all');
  const [verifyFilter, setVerifyFilter] = useState<VehicleVerificationStatus | 'all'>('all');
  const [opsFilter, setOpsFilter] = useState<VehicleOperationalStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<{ id: string; action: 'approve' | 'reject' | 'enable' | 'disable' } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await vehicleService.getVehicles({ search, category: categoryFilter, verificationStatus: verifyFilter, operationalStatus: opsFilter });
    setVehicles(data);
    setPage(1);
    setLoading(false);
  }, [search, categoryFilter, verifyFilter, opsFilter]);

  useEffect(() => { load(); }, [load]);

  const paginated = vehicles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const ACTION_MAP = {
    approve: { fn: (id: string) => vehicleService.approveVehicle(id, 'Rajesh Kumar'), msg: 'Vehicle approved successfully', variant: 'info' as const, title: 'Approve Vehicle?', desc: 'Vehicle will be verified and enabled for operations.' },
    reject: { fn: vehicleService.rejectVehicle, msg: 'Vehicle rejected', variant: 'danger' as const, title: 'Reject Vehicle?', desc: 'Vehicle verification will be rejected and disabled.' },
    enable: { fn: vehicleService.enableVehicle, msg: 'Vehicle enabled', variant: 'info' as const, title: 'Enable Vehicle?', desc: 'Vehicle will be enabled for active operations.' },
    disable: { fn: vehicleService.disableVehicle, msg: 'Vehicle disabled', variant: 'warning' as const, title: 'Disable Vehicle?', desc: 'Vehicle will be disabled and removed from active operations.' },
  };

  const handleAction = async () => {
    if (!confirm) return;
    setActionLoading(true);
    await ACTION_MAP[confirm.action].fn(confirm.id);
    toast.success(ACTION_MAP[confirm.action].msg);
    setActionLoading(false);
    setConfirm(null);
    load();
  };

  return (
    <AdminLayout pageTitle="Vehicles">
      {loading ? (
        <PageSkeleton rows={8} showToolbar />
      ) : (
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Vehicles</h2>
            <p className={m.pageSubtitle}>Manage fleet vehicles, verification, and operational status</p>
          </div>
        </div>

        <div className={m.toolbar}>
          <div className={m.toolbarLeft}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
              <input className={m.filterSelect} style={{ paddingLeft: 36, width: '100%' }} placeholder="Search vehicle, driver…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search vehicles" />
              {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--color-text-tertiary)' }} aria-label="Clear search"><X size={14} /></button>}
            </div>
          </div>
          <div className={m.toolbarRight}>
            <select className={m.filterSelect} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as VehicleCategory | 'all')} aria-label="Filter category">
              <option value="all">All Categories</option>
              {VEHICLE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className={m.filterSelect} value={verifyFilter} onChange={(e) => setVerifyFilter(e.target.value as VehicleVerificationStatus | 'all')} aria-label="Filter verification">
              <option value="all">All Verification</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
            </select>
            <select className={m.filterSelect} value={opsFilter} onChange={(e) => setOpsFilter(e.target.value as VehicleOperationalStatus | 'all')} aria-label="Filter operational">
              <option value="all">All Operational</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        </div>

        <div className={m.tableCard}>
          {vehicles.length === 0 ? (
            <EmptyState title="No vehicles found" description="Try adjusting your search or filters." />
          ) : (
            <>
              <div className={`${m.tableWrap} admin-table-wrap`}>
                <table>
                  <thead>
                    <tr>
                      <th>Vehicle</th>
                      <th>Category</th>
                      <th>Driver</th>
                      <th>Capacity</th>
                      <th>Year</th>
                      <th>Verification</th>
                      <th>Operational</th>
                      <th>Registered</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((v) => (
                      <tr key={v.id} style={{ opacity: v.operationalStatus === 'disabled' ? 0.7 : 1 }}>
                        <td>
                          <div className={m.cellAvatar}>
                            <div className={m.avatarCircle} style={{ background: 'var(--color-warning-50)', color: 'var(--color-warning-700)', fontSize: 'var(--font-size-xs)', letterSpacing: '-0.04em' }}>
                              {v.registrationNumber.slice(-4)}
                            </div>
                            <div>
                              <div className={m.cellPrimary} style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.02em' }}>{v.registrationNumber}</div>
                              <div className={m.cellSecondary}>{v.make} {v.model}</div>
                            </div>
                          </div>
                        </td>
                        <td><Badge variant="neutral">{v.category}</Badge></td>
                        <td>
                          <div className={m.cellPrimary}>{v.driverName}</div>
                          <div className={m.cellSecondary}>{v.driverPhone}</div>
                        </td>
                        <td>{v.capacity}</td>
                        <td style={{ color: 'var(--color-text-secondary)' }}>{v.year}</td>
                        <td>{VERIFY_BADGE[v.verificationStatus]}</td>
                        <td>{OPS_BADGE[v.operationalStatus]}</td>
                        <td style={{ color: 'var(--color-text-secondary)' }}>{v.registeredAt}</td>
                        <td>
                          <div className={m.actionCell}>
                            <Button size="sm" variant="ghost" onClick={() => router.push(`/vehicles/${v.id}`)} leftIcon={<Eye size={14} />}>View</Button>
                            {v.verificationStatus === 'pending' && <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: v.id, action: 'approve' })} style={{ color: 'var(--color-success-600)' }}>Approve</Button>}
                            {v.verificationStatus === 'pending' && <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: v.id, action: 'reject' })} style={{ color: 'var(--color-danger-600)' }}>Reject</Button>}
                            {v.verificationStatus === 'approved' && v.operationalStatus === 'enabled' && <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: v.id, action: 'disable' })} style={{ color: 'var(--color-warning-600)' }}>Disable</Button>}
                            {v.verificationStatus === 'approved' && v.operationalStatus === 'disabled' && <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: v.id, action: 'enable' })} style={{ color: 'var(--color-success-600)' }}>Enable</Button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={m.resultCount}><span>{vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} found</span></div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={vehicles.length} onPageChange={setPage} />
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
          variant={ACTION_MAP[confirm.action].variant}
          title={ACTION_MAP[confirm.action].title}
          description={ACTION_MAP[confirm.action].desc}
          confirmLabel={confirm.action.charAt(0).toUpperCase() + confirm.action.slice(1)}
        />
      )}
    </AdminLayout>
  );
}
