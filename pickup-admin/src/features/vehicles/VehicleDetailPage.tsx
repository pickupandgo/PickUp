'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, FileText, Image } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { ConfirmDialog } from '@/components/ui/Modal/ConfirmDialog';
import { Loader } from '@/components/ui/Loader/Loader';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import * as vehicleService from '@/services/vehicleService';
import type { Vehicle } from '@/types/vehicle';
import { useAuth } from '@/context/AuthContext';
import m from '@/components/ui/shared/module.module.css';
import styles from './VehicleDetailPage.module.css';

interface Props { vehicleId: string }
type ActionType = 'approve' | 'reject' | 'enable' | 'disable';

const ACTION_CONFIG: Record<ActionType, { variant: 'info' | 'warning' | 'danger'; title: string; desc: string; msg: string }> = {
  approve: { variant: 'info', title: 'Approve Vehicle?', desc: 'Vehicle will be verified and enabled for operations.', msg: 'Vehicle approved' },
  reject: { variant: 'danger', title: 'Reject Vehicle?', desc: 'Vehicle verification will be rejected and disabled.', msg: 'Vehicle rejected' },
  enable: { variant: 'info', title: 'Enable Vehicle?', desc: 'Vehicle will be enabled for active operations.', msg: 'Vehicle enabled' },
  disable: { variant: 'warning', title: 'Disable Vehicle?', desc: 'Vehicle will be removed from active operations.', msg: 'Vehicle disabled' },
};

const DOC_STATUS_BADGE: Record<string, React.ReactNode> = {
  valid: <Badge variant="success">Valid</Badge>,
  expired: <Badge variant="danger">Expired</Badge>,
  pending: <Badge variant="warning">Pending</Badge>,
  missing: <Badge variant="danger">Missing</Badge>,
};

export default function VehicleDetailPage({ vehicleId }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<ActionType | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await vehicleService.getVehicleById(vehicleId);
    setVehicle(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [vehicleId]);

  const handleAction = async () => {
    if (!confirm || !vehicle) return;
    setActionLoading(true);
    if (confirm === 'approve') await vehicleService.approveVehicle(vehicle.id, user?.name ?? 'Admin');
    else if (confirm === 'reject') await vehicleService.rejectVehicle(vehicle.id);
    else if (confirm === 'enable') await vehicleService.enableVehicle(vehicle.id);
    else if (confirm === 'disable') await vehicleService.disableVehicle(vehicle.id);
    toast.success(ACTION_CONFIG[confirm].msg);
    setActionLoading(false);
    setConfirm(null);
    load();
  };

  if (loading) return <AdminLayout pageTitle="Vehicle Detail"><Loader fullPage /></AdminLayout>;
  if (!vehicle) return (
    <AdminLayout pageTitle="Vehicle Detail">
      <EmptyState title="Vehicle not found" action={<Button onClick={() => router.push('/vehicles')}>Back to Vehicles</Button>} description="" />
    </AdminLayout>
  );

  const isDisabled = vehicle.operationalStatus === 'disabled';

  return (
    <AdminLayout pageTitle={`Vehicle — ${vehicle.registrationNumber}`}>
      <div className={m.detailPage} style={{ opacity: isDisabled ? 0.92 : 1 }}>
        {/* Header */}
        <div className={m.detailHeader}>
          <button className={m.backBtn} onClick={() => router.push('/vehicles')}><ArrowLeft size={16} /> Vehicles</button>
          <div>
            <h2 className={m.detailTitle} style={{ fontFamily: 'monospace', letterSpacing: '0.03em' }}>{vehicle.registrationNumber}</h2>
            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>{vehicle.make} {vehicle.model} · {vehicle.year} · {vehicle.color}</p>
          </div>
          <div className={m.detailHeaderRight}>
            {vehicle.verificationStatus === 'pending' && <>
              <Button variant="primary" size="sm" onClick={() => setConfirm('approve')}>Approve</Button>
              <Button variant="danger" size="sm" onClick={() => setConfirm('reject')}>Reject</Button>
            </>}
            {vehicle.verificationStatus === 'approved' && vehicle.operationalStatus === 'enabled' && (
              <Button variant="secondary" size="sm" onClick={() => setConfirm('disable')}>Disable Vehicle</Button>
            )}
            {vehicle.verificationStatus === 'approved' && vehicle.operationalStatus === 'disabled' && (
              <Button variant="primary" size="sm" onClick={() => setConfirm('enable')}>Enable Vehicle</Button>
            )}
          </div>
        </div>

        {/* Status Banner if disabled */}
        {isDisabled && (
          <div className={styles.disabledBanner}>
            <span>⚠️ This vehicle is currently <strong>Disabled</strong> and not available for operations.</span>
          </div>
        )}

        <div className={m.detailGrid}>
          {/* Left */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {/* Vehicle Info */}
            <Card>
              <CardHeader title="Vehicle Information" />
              <div className={m.infoGrid}>
                <div className={m.infoItem}><span className={m.infoLabel}>Vehicle ID</span><span className={m.infoValue}><span className={m.cellId}>{vehicle.id}</span></span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Registration No.</span><span className={m.infoValue} style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 'var(--font-size-md)' }}>{vehicle.registrationNumber}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Category</span><span className={m.infoValue}><Badge variant="neutral">{vehicle.category}</Badge></span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Make & Model</span><span className={m.infoValue}>{vehicle.make} {vehicle.model}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Year</span><span className={m.infoValue}>{vehicle.year}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Color</span><span className={m.infoValue}>{vehicle.color}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Capacity</span><span className={m.infoValue}>{vehicle.capacity}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Registered</span><span className={m.infoValue}>{vehicle.registeredAt}</span></div>
              </div>
            </Card>

            {/* Driver info */}
            <Card>
              <CardHeader title="Assigned Driver" action={
                <Button size="sm" variant="outline" onClick={() => router.push(`/drivers/${vehicle.driverId}`)} rightIcon={<ExternalLink size={12} />}>View Driver</Button>
              } />
              <div className={m.infoGrid}>
                <div className={m.infoItem}><span className={m.infoLabel}>Driver ID</span><span className={m.infoValue}><span className={m.cellId}>{vehicle.driverId}</span></span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Name</span><span className={m.infoValue}>{vehicle.driverName}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Phone</span><span className={m.infoValue}>{vehicle.driverPhone}</span></div>
              </div>
            </Card>

            {/* Documents */}
            <Card>
              <CardHeader title="Vehicle Documents" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {vehicle.documents.map((doc) => (
                  <div key={doc.id} className={styles.docRow}>
                    <div className={styles.docRowIcon}><FileText size={16} /></div>
                    <div className={styles.docRowInfo}>
                      <span className={styles.docRowName}>{doc.label}</span>
                      {doc.documentNumber && <span className={styles.docRowNum}>{doc.documentNumber}</span>}
                      {doc.expiryDate && <span className={styles.docRowExp}>Expiry: {doc.expiryDate}</span>}
                    </div>
                    <div style={{ marginLeft: 'auto' }}>{DOC_STATUS_BADGE[doc.status] ?? <Badge variant="neutral">{doc.status}</Badge>}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Images Placeholder */}
            <Card>
              <CardHeader title="Vehicle Images" description="Photos of the vehicle" />
              <div className={styles.imagesGrid}>
                {['Front View', 'Rear View', 'Left Side', 'Right Side'].map((label) => (
                  <div key={label} className={styles.imagePlaceholder}>
                    <Image size={20} />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-3)' }}>Vehicle photos will display from secure storage in production.</p>
            </Card>
          </div>

          {/* Right */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <Card>
              <CardHeader title="Verification Status" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div className={m.infoItem}><span className={m.infoLabel}>Verification</span><span className={m.infoValue}><Badge variant={{ approved: 'success', pending: 'warning', rejected: 'danger' }[vehicle.verificationStatus] as 'success' | 'warning' | 'danger'}>{vehicle.verificationStatus.charAt(0).toUpperCase() + vehicle.verificationStatus.slice(1)}</Badge></span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Operational</span><span className={m.infoValue}><Badge variant={vehicle.operationalStatus === 'enabled' ? 'success' : 'neutral'} dot>{vehicle.operationalStatus === 'enabled' ? 'Enabled' : 'Disabled'}</Badge></span></div>
                {vehicle.verifiedAt && <div className={m.infoItem}><span className={m.infoLabel}>Verified On</span><span className={m.infoValue}>{vehicle.verifiedAt}</span></div>}
                {vehicle.verifiedBy && <div className={m.infoItem}><span className={m.infoLabel}>Verified By</span><span className={m.infoValue}>{vehicle.verifiedBy}</span></div>}
              </div>
            </Card>

            <Card>
              <CardHeader title="Document Health" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {['valid', 'expired', 'pending', 'missing'].map((s) => {
                  const count = vehicle.documents.filter((d) => d.status === s).length;
                  if (count === 0) return null;
                  const colors = { valid: 'var(--color-success-600)', expired: 'var(--color-danger-600)', pending: 'var(--color-warning-600)', missing: 'var(--color-danger-600)' };
                  return (
                    <div key={s} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', textTransform: 'capitalize' }}>{s}</span>
                      <span style={{ fontWeight: 700, color: colors[s as keyof typeof colors] }}>{count}</span>
                    </div>
                  );
                })}
              </div>
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
          variant={ACTION_CONFIG[confirm].variant}
          title={ACTION_CONFIG[confirm].title}
          description={ACTION_CONFIG[confirm].desc}
          confirmLabel={confirm.charAt(0).toUpperCase() + confirm.slice(1)}
        />
      )}
    </AdminLayout>
  );
}
