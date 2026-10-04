'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { ConfirmDialog } from '@/components/ui/Modal/ConfirmDialog';
import { Loader } from '@/components/ui/Loader/Loader';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import * as driverService from '@/services/driverService';
import type { Driver } from '@/types/driver';
import m from '@/components/ui/shared/module.module.css';

interface Props { driverId: string }

type ActionType = 'approve' | 'reject' | 'suspend' | 'block' | 'unblock';

const ACTION_MAP: Record<ActionType, { fn: (id: string) => Promise<void>; msg: string; variant: 'info' | 'warning' | 'danger'; title: string; desc: string }> = {
  approve: { fn: driverService.approveDriver, msg: 'Driver approved', variant: 'info', title: 'Approve Driver?', desc: 'Driver will be allowed to accept bookings.' },
  reject: { fn: driverService.rejectDriver, msg: 'Driver rejected', variant: 'warning', title: 'Reject Driver?', desc: 'Driver will be moved back to pending status.' },
  suspend: { fn: driverService.suspendDriver, msg: 'Driver suspended', variant: 'warning', title: 'Suspend Driver?', desc: 'Driver will be temporarily suspended.' },
  block: { fn: driverService.blockDriver, msg: 'Driver blocked', variant: 'danger', title: 'Block Driver?', desc: 'Driver will be permanently blocked from the platform.' },
  unblock: { fn: driverService.unblockDriver, msg: 'Driver unblocked', variant: 'info', title: 'Unblock Driver?', desc: 'Driver access will be restored.' },
};

export default function DriverDetailPage({ driverId }: Props) {
  const router = useRouter();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<ActionType | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await driverService.getDriverById(driverId);
    setDriver(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [driverId]);

  const handleAction = async () => {
    if (!confirm || !driver) return;
    setActionLoading(true);
    await ACTION_MAP[confirm].fn(driver.id);
    toast.success(ACTION_MAP[confirm].msg);
    setActionLoading(false);
    setConfirm(null);
    load();
  };

  if (loading) return <AdminLayout pageTitle="Driver Detail"><Loader fullPage /></AdminLayout>;
  if (!driver) return (
    <AdminLayout pageTitle="Driver Detail">
      <EmptyState title="Driver not found" action={<Button onClick={() => router.push('/drivers')}>Back to Drivers</Button>} description="" />
    </AdminLayout>
  );

  const statusBadge = () => {
    const map = { approved: 'success', pending: 'warning', suspended: 'warning', blocked: 'danger' } as const;
    return <Badge variant={map[driver.status]} dot>{driver.status.charAt(0).toUpperCase() + driver.status.slice(1)}</Badge>;
  };

  return (
    <AdminLayout pageTitle={`Driver — ${driver.name}`}>
      <div className={m.detailPage}>
        {/* Header */}
        <div className={m.detailHeader}>
          <button className={m.backBtn} onClick={() => router.push('/drivers')}><ArrowLeft size={16} /> Drivers</button>
          <h2 className={m.detailTitle}>{driver.name}</h2>
          <div className={m.detailHeaderRight}>
            {driver.status === 'pending' && <Button variant="primary" size="sm" onClick={() => setConfirm('approve')}>Approve</Button>}
            {driver.status === 'pending' && <Button variant="secondary" size="sm" onClick={() => setConfirm('reject')}>Reject</Button>}
            {driver.status === 'approved' && <Button variant="secondary" size="sm" onClick={() => setConfirm('suspend')}>Suspend</Button>}
            {(driver.status === 'approved' || driver.status === 'suspended') && <Button variant="danger" size="sm" onClick={() => setConfirm('block')}>Block</Button>}
            {driver.status === 'blocked' && <Button variant="secondary" size="sm" onClick={() => setConfirm('unblock')}>Unblock</Button>}
          </div>
        </div>

        {/* Stats */}
        <div className={m.statBoxes}>
          {[
            { label: 'Total Trips', value: driver.totalTrips },
            { label: 'Completed', value: driver.completedTrips },
            { label: 'Cancelled', value: driver.cancelledTrips },
            { label: 'Wallet', value: `₹${driver.walletBalance.toLocaleString('en-IN')}` },
          ].map((s) => (
            <div key={s.label} className={m.statBox}>
              <div className={m.statBoxValue}>{s.value}</div>
              <div className={m.statBoxLabel}>{s.label}</div>
            </div>
          ))}
        </div>

        <div className={m.detailGrid}>
          {/* Left */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {/* Profile */}
            <Card>
              <CardHeader title="Driver Profile" />
              <div className={m.infoGrid}>
                <div className={m.infoItem}><span className={m.infoLabel}>Driver ID</span><span className={m.infoValue}><span className={m.cellId}>{driver.id}</span></span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Name</span><span className={m.infoValue}>{driver.name}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Phone</span><span className={m.infoValue}>{driver.phone}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Email</span><span className={m.infoValue}>{driver.email ?? '—'}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Language</span><span className={m.infoValue}>{driver.language}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>City</span><span className={m.infoValue}>{driver.city}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Registered</span><span className={m.infoValue}>{driver.registeredAt}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Last Trip</span><span className={m.infoValue}>{driver.lastTripDate ?? '—'}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Account Status</span><span className={m.infoValue}>{statusBadge()}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Online Status</span><span className={m.infoValue}><Badge variant={driver.onlineStatus === 'online' ? 'success' : 'neutral'} dot>{driver.onlineStatus === 'online' ? 'Online' : 'Offline'}</Badge></span></div>
              </div>
            </Card>

            {/* Eligibility */}
            <Card>
              <CardHeader title="Eligibility" description="Whether this driver can accept bookings" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) 0' }}>
                <Badge variant={driver.eligibility === 'eligible' ? 'success' : 'danger'} dot>
                  {driver.eligibility === 'eligible' ? 'Eligible' : 'Ineligible'}
                </Badge>
                {driver.eligibilityReason && (
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{driver.eligibilityReason}</span>
                )}
              </div>
            </Card>
          </div>

          {/* Right */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {/* KYC Summary */}
            <Card>
              <CardHeader title="KYC Summary" action={
                <Button size="sm" variant="outline" onClick={() => router.push(`/kyc/${driver.kycId}`)} rightIcon={<ExternalLink size={12} />}>View KYC</Button>
              } />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className={m.infoItem}><span className={m.infoLabel}>KYC ID</span><span className={m.infoValue}><span className={m.cellId}>{driver.kycId}</span></span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>KYC Status</span><span className={m.infoValue}><Badge variant={{ approved: 'success', pending: 'warning', rejected: 'danger' }[driver.kycStatus] as 'success' | 'warning' | 'danger'}>{driver.kycStatus.charAt(0).toUpperCase() + driver.kycStatus.slice(1)}</Badge></span></div>
              </div>
            </Card>

            {/* Vehicle Summary */}
            <Card>
              <CardHeader title="Vehicle Summary" action={
                <Button size="sm" variant="outline" onClick={() => router.push(`/vehicles/${driver.vehicleId}`)} rightIcon={<ExternalLink size={12} />}>View Vehicle</Button>
              } />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className={m.infoItem}><span className={m.infoLabel}>Vehicle Number</span><span className={m.infoValue} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{driver.vehicleNumber}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Category</span><span className={m.infoValue}><Badge variant="neutral">{driver.vehicleCategory}</Badge></span></div>
              </div>
            </Card>

            {/* Wallet Summary */}
            <Card>
              <CardHeader title="Wallet Summary" description="Current balance information" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div className={m.infoItem}><span className={m.infoLabel}>Current Balance</span><span className={m.infoValue} style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 800, color: driver.walletBalance < driver.minimumBalance ? 'var(--color-danger-600)' : 'var(--color-success-600)' }}>₹{driver.walletBalance.toLocaleString('en-IN')}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Minimum Balance Required</span><span className={m.infoValue}>₹{driver.minimumBalance.toLocaleString('en-IN')}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Balance Status</span><span className={m.infoValue}>{driver.walletBalance >= driver.minimumBalance ? <Badge variant="success">Sufficient</Badge> : <Badge variant="danger">Below Minimum</Badge>}</span></div>
              </div>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>Full wallet management available in a future milestone.</p>
            </Card>
          </div>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          isOpen
          onClose={() => setConfirm(null)}
          onConfirm={handleAction}
          isLoading={actionLoading}
          variant={ACTION_MAP[confirm].variant}
          title={ACTION_MAP[confirm].title}
          description={ACTION_MAP[confirm].desc}
          confirmLabel={confirm.charAt(0).toUpperCase() + confirm.slice(1)}
        />
      )}
    </AdminLayout>
  );
}
