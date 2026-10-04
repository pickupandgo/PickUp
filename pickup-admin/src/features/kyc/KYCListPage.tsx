'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Eye, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { ConfirmDialog } from '@/components/ui/Modal/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { PageSkeleton } from '@/components/ui/PageSkeleton/PageSkeleton';
import { Pagination } from '@/components/ui/Pagination/Pagination';
import * as kycService from '@/services/kycService';
import type { KYCRecord, KYCFilters } from '@/types/kyc';
import type { KYCStatus } from '@/types/driver';
import m from '@/components/ui/shared/module.module.css';
import styles from './KYCListPage.module.css';

const PAGE_SIZE = 10;

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
}

const STATUS_TABS: { label: string; value: KYCStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
];

export default function KYCListPage() {
  const router = useRouter();
  const [records, setRecords] = useState<KYCRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<KYCStatus | 'all'>('all');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await kycService.getKYCRecords({ search, status: tab });
    setRecords(data);
    setPage(1);
    setLoading(false);
  }, [search, tab]);

  useEffect(() => { load(); }, [load]);

  const paginated = records.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const KYC_BADGE: Record<KYCStatus, React.ReactNode> = {
    pending: <Badge variant="warning" dot>Pending</Badge>,
    approved: <Badge variant="success" dot>Approved</Badge>,
    rejected: <Badge variant="danger" dot>Rejected</Badge>,
  };

  const counts: Record<KYCStatus | 'all', number> = { all: 0, pending: 0, approved: 0, rejected: 0 };
  // We need counts from all records regardless of current filter — use unfiltered data in prod
  // For mock, show filtered tab counts by recomputing mentally
  records.forEach((r) => { counts[r.status]++; counts.all++; });

  return (
    <AdminLayout pageTitle="KYC Verification">
      {loading ? (
        <PageSkeleton rows={6} showToolbar />
      ) : (
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>KYC Verification</h2>
            <p className={m.pageSubtitle}>Review and verify driver identity and vehicle documents</p>
          </div>
        </div>

        {/* Status Tabs */}
        <div className={styles.tabs}>
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              className={`${styles.tab} ${tab === t.value ? styles['tab--active'] : ''}`}
              onClick={() => { setTab(t.value); setPage(1); }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className={m.toolbar}>
          <div className={m.toolbarLeft} style={{ maxWidth: 340 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
              <input className={m.filterSelect} style={{ paddingLeft: 36, width: '100%' }} placeholder="Search driver, ID, vehicle…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search KYC" />
              {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--color-text-tertiary)' }} aria-label="Clear search"><X size={14} /></button>}
            </div>
          </div>
        </div>

        <div className={m.tableCard}>
          {records.length === 0 ? (
            <EmptyState title="No KYC records found" description="Try adjusting your search or status filter." />
          ) : (
            <>
              <div className={`${m.tableWrap} admin-table-wrap`}>
                <table>
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th>Driver ID</th>
                      <th>Vehicle</th>
                      <th>Category</th>
                      <th>Submitted</th>
                      <th>Documents</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((r) => {
                      const verified = r.documents.filter((d) => d.status === 'verified').length;
                      const total = r.documents.length;
                      return (
                        <tr key={r.id}>
                          <td>
                            <div className={m.cellAvatar}>
                              <div className={m.avatarCircle} style={{ background: 'var(--color-warning-50)', color: 'var(--color-warning-700)' }}>{initials(r.driverName)}</div>
                              <div>
                                <div className={m.cellPrimary}>{r.driverName}</div>
                                <div className={m.cellSecondary}>{r.driverPhone}</div>
                              </div>
                            </div>
                          </td>
                          <td><span className={m.cellId}>{r.driverId}</span></td>
                          <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{r.vehicleNumber}</td>
                          <td><Badge variant="neutral">{r.vehicleCategory}</Badge></td>
                          <td style={{ color: 'var(--color-text-secondary)' }}>{r.submittedAt}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: verified === total ? 'var(--color-success-600)' : 'var(--color-text-secondary)' }}>{verified}/{total}</span>
                              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>verified</span>
                            </div>
                          </td>
                          <td>{KYC_BADGE[r.status]}</td>
                          <td>
                            <div className={m.actionCell}>
                              <Button size="sm" variant="ghost" onClick={() => router.push(`/kyc/${r.id}`)} leftIcon={<Eye size={14} />}>Review</Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className={m.resultCount}><span>{records.length} record{records.length !== 1 ? 's' : ''} found</span></div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={records.length} onPageChange={setPage} />
            </>
          )}
        </div>
      </div>
      )}
    </AdminLayout>
  );
}
