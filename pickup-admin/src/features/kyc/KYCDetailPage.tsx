'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle, XCircle, FileText, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { Modal } from '@/components/ui/Modal/Modal';
import { ConfirmDialog } from '@/components/ui/Modal/ConfirmDialog';
import { Loader } from '@/components/ui/Loader/Loader';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import * as kycService from '@/services/kycService';
import type { KYCRecord, KYCDocument } from '@/types/kyc';
import { useAuth } from '@/context/AuthContext';
import m from '@/components/ui/shared/module.module.css';
import styles from './KYCDetailPage.module.css';

interface Props { kycId: string }

export default function KYCDetailPage({ kycId }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const [record, setRecord] = useState<KYCRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewDoc, setPreviewDoc] = useState<KYCDocument | null>(null);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | 'correction' | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const data = await kycService.getKYCById(kycId);
    setRecord(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [kycId]);

  const handleApprove = async () => {
    if (!record) return;
    setActionLoading(true);
    await kycService.approveKYC(record.id, user?.name ?? 'Admin');
    toast.success('KYC approved successfully');
    setActionLoading(false);
    setConfirmAction(null);
    load();
  };

  const handleReject = async () => {
    if (!record || !rejectReason.trim()) return;
    setActionLoading(true);
    await kycService.rejectKYC(record.id, rejectReason.trim(), user?.name ?? 'Admin');
    toast.error('KYC rejected');
    setActionLoading(false);
    setConfirmAction(null);
    setRejectReason('');
    load();
  };

  const handleCorrection = async () => {
    if (!record || !rejectReason.trim()) return;
    setActionLoading(true);
    await kycService.requestKYCCorrection(record.id, rejectReason.trim());
    toast.success('Correction request sent');
    setActionLoading(false);
    setConfirmAction(null);
    setRejectReason('');
    load();
  };

  const docStatusBadge = (status: KYCDocument['status']) => {
    if (status === 'verified') return <Badge variant="success">Verified</Badge>;
    if (status === 'pending') return <Badge variant="warning">Pending</Badge>;
    return <Badge variant="danger">Rejected</Badge>;
  };

  const docTypeIcon = () => <FileText size={20} />;

  if (loading) return <AdminLayout pageTitle="KYC Review"><Loader fullPage /></AdminLayout>;
  if (!record) return (
    <AdminLayout pageTitle="KYC Review">
      <EmptyState title="KYC record not found" action={<Button onClick={() => router.push('/kyc')}>Back to KYC</Button>} description="" />
    </AdminLayout>
  );

  const isActionable = record.status === 'pending';

  return (
    <AdminLayout pageTitle={`KYC — ${record.driverName}`}>
      <div className={m.detailPage}>
        {/* Header */}
        <div className={m.detailHeader}>
          <button className={m.backBtn} onClick={() => router.push('/kyc')}><ArrowLeft size={16} /> KYC Verification</button>
          <h2 className={m.detailTitle}>{record.driverName}</h2>
          <div className={m.detailHeaderRight}>
            {isActionable && <>
              <Button variant="primary" size="sm" onClick={() => setConfirmAction('approve')} leftIcon={<CheckCircle size={14} />}>Approve KYC</Button>
              <Button variant="secondary" size="sm" onClick={() => { setRejectReason(''); setConfirmAction('correction'); }}>Request Correction</Button>
              <Button variant="danger" size="sm" onClick={() => { setRejectReason(''); setConfirmAction('reject'); }} leftIcon={<XCircle size={14} />}>Reject KYC</Button>
            </>}
            {!isActionable && (
              <Badge variant={record.status === 'approved' ? 'success' : 'danger'} dot>
                {record.status === 'approved' ? 'KYC Approved' : 'KYC Rejected'}
              </Badge>
            )}
          </div>
        </div>

        <div className={m.detailGrid}>
          {/* Left — Driver info + Docs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {/* Driver Info */}
            <Card>
              <CardHeader title="Driver Information" />
              <div className={m.infoGrid}>
                <div className={m.infoItem}><span className={m.infoLabel}>Driver ID</span><span className={m.infoValue}><span className={m.cellId}>{record.driverId}</span></span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Name</span><span className={m.infoValue}>{record.driverName}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Phone</span><span className={m.infoValue}>{record.driverPhone}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Vehicle Number</span><span className={m.infoValue} style={{ fontFamily: 'monospace', fontWeight: 700 }}>{record.vehicleNumber}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Vehicle Category</span><span className={m.infoValue}><Badge variant="neutral">{record.vehicleCategory}</Badge></span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Submitted</span><span className={m.infoValue}>{record.submittedAt}</span></div>
              </div>
            </Card>

            {/* Documents */}
            <Card>
              <CardHeader title="Documents" description="Click Preview to view document details" />
              <div className={styles.docList}>
                {record.documents.map((doc) => (
                  <div key={doc.id} className={styles.docItem}>
                    <div className={styles.docIcon}><FileText size={18} /></div>
                    <div className={styles.docInfo}>
                      <span className={styles.docName}>{doc.label}</span>
                      {doc.documentNumber && <span className={styles.docNumber}>{doc.documentNumber}</span>}
                      {doc.rejectionReason && <span className={styles.docRejectNote}>{doc.rejectionReason}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginLeft: 'auto' }}>
                      {docStatusBadge(doc.status)}
                      <Button size="sm" variant="outline" onClick={() => setPreviewDoc(doc)} leftIcon={<Eye size={12} />}>Preview</Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Right — Status + Review info */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <Card>
              <CardHeader title="KYC Status" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div className={m.infoItem}><span className={m.infoLabel}>Overall Status</span><span className={m.infoValue}><Badge variant={{ pending: 'warning', approved: 'success', rejected: 'danger' }[record.status] as 'warning' | 'success' | 'danger'} dot>{record.status.charAt(0).toUpperCase() + record.status.slice(1)}</Badge></span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Submitted</span><span className={m.infoValue}>{record.submittedAt}</span></div>
                {record.reviewedAt && <div className={m.infoItem}><span className={m.infoLabel}>Reviewed</span><span className={m.infoValue}>{record.reviewedAt}</span></div>}
                {record.reviewedBy && <div className={m.infoItem}><span className={m.infoLabel}>Reviewed By</span><span className={m.infoValue}>{record.reviewedBy}</span></div>}
                {record.rejectionReason && (
                  <div className={styles.rejectBanner}>
                    <XCircle size={14} />
                    <span>{record.rejectionReason}</span>
                  </div>
                )}
                {record.correctionRequested && (
                  <div className={styles.correctionBanner}>
                    <span>Correction Requested</span>
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Document Summary" />
              <div className={styles.docSummary}>
                {['verified', 'pending', 'rejected'].map((s) => {
                  const count = record.documents.filter((d) => d.status === s).length;
                  const colors = { verified: 'var(--color-success-600)', pending: 'var(--color-warning-600)', rejected: 'var(--color-danger-600)' };
                  return (
                    <div key={s} className={styles.summaryItem}>
                      <span className={styles.summaryCount} style={{ color: colors[s as keyof typeof colors] }}>{count}</span>
                      <span className={styles.summaryLabel}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Document Preview Modal */}
      <Modal isOpen={!!previewDoc} onClose={() => setPreviewDoc(null)} title={previewDoc?.label ?? 'Document Preview'} size="md">
        {previewDoc && (
          <div className={styles.previewBody}>
            <div className={styles.previewPlaceholder}>
              <FileText size={48} />
              <p className={styles.previewLabel}>{previewDoc.label}</p>
              <p className={styles.previewSub}>
                {previewDoc.documentNumber ? `Document No: ${previewDoc.documentNumber}` : 'Document image placeholder'}
              </p>
              <p className={styles.previewNote}>In production, the actual document image from secure storage would appear here.</p>
            </div>
            <div className={styles.previewMeta}>
              <div className={m.infoItem}><span className={m.infoLabel}>Status</span><span className={m.infoValue}>{docStatusBadge(previewDoc.status)}</span></div>
              <div className={m.infoItem}><span className={m.infoLabel}>Submitted</span><span className={m.infoValue}>{previewDoc.submittedAt}</span></div>
              {previewDoc.verifiedAt && <div className={m.infoItem}><span className={m.infoLabel}>Verified</span><span className={m.infoValue}>{previewDoc.verifiedAt}</span></div>}
              {previewDoc.rejectionReason && <div className={m.infoItem}><span className={m.infoLabel}>Rejection Reason</span><span className={m.infoValue} style={{ color: 'var(--color-danger-600)' }}>{previewDoc.rejectionReason}</span></div>}
            </div>
          </div>
        )}
      </Modal>

      {/* Approve Confirm */}
      <ConfirmDialog
        isOpen={confirmAction === 'approve'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleApprove}
        isLoading={actionLoading}
        variant="info"
        title="Approve KYC?"
        description={`Approve KYC for ${record.driverName}? All documents will be marked as verified.`}
        confirmLabel="Approve KYC"
      />

      {/* Reject Modal */}
      <Modal isOpen={confirmAction === 'reject'} onClose={() => setConfirmAction(null)} title="Reject KYC" size="sm">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Provide a reason for rejection. This will be shown to the driver.</p>
          <textarea
            className={styles.reasonInput}
            placeholder="Enter rejection reason…"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <Button variant="secondary" size="sm" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleReject} isLoading={actionLoading} disabled={!rejectReason.trim()}>Submit Rejection</Button>
          </div>
        </div>
      </Modal>

      {/* Correction Modal */}
      <Modal isOpen={confirmAction === 'correction'} onClose={() => setConfirmAction(null)} title="Request Correction" size="sm">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Specify what needs to be corrected or re-uploaded.</p>
          <textarea
            className={styles.reasonInput}
            placeholder="Enter correction instructions…"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <Button variant="secondary" size="sm" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleCorrection} isLoading={actionLoading} disabled={!rejectReason.trim()}>Send Request</Button>
          </div>
        </div>
      </Modal>
    </AdminLayout>
  );
}
