'use client';

import React, { useState, useEffect } from 'react';
import { Search, History, Eye, X } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Button } from '@/components/ui/Button/Button';
import { Badge } from '@/components/ui/Badge/Badge';
import { Loader } from '@/components/ui/Loader/Loader';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { PageSkeleton } from '@/components/ui/PageSkeleton/PageSkeleton';
import { Modal } from '@/components/ui/Modal/Modal';
import { Pagination } from '@/components/ui/Pagination/Pagination';
import * as auditService from '@/services/auditLogService';
import type { AuditLog, AuditAction, AuditEntityType } from '@/types/auditLog';
import m from '@/components/ui/shared/module.module.css';

const PAGE_SIZE = 15;

const ACTION_OPTIONS: { value: AuditAction | 'all', label: string }[] = [
  { value: 'all', label: 'All Actions' },
  { value: 'Driver Approved', label: 'Driver Approved' },
  { value: 'Driver Blocked', label: 'Driver Blocked' },
  { value: 'Customer Unblocked', label: 'Customer Unblocked' },
  { value: 'Vehicle Approved', label: 'Vehicle Approved' },
  { value: 'Wallet Adjusted', label: 'Wallet Adjusted' },
  { value: 'Fare Changed', label: 'Fare Changed' },
  { value: 'Booking Cancelled', label: 'Booking Cancelled' },
  { value: 'Driver Reassigned', label: 'Driver Reassigned' },
];

const ENTITY_OPTIONS: { value: AuditEntityType | 'all', label: string }[] = [
  { value: 'all', label: 'All Entities' },
  { value: 'Booking', label: 'Booking' },
  { value: 'Driver', label: 'Driver' },
  { value: 'Customer', label: 'Customer' },
  { value: 'Vehicle', label: 'Vehicle' },
  { value: 'Wallet', label: 'Wallet' },
  { value: 'Pricing', label: 'Pricing' },
];

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<AuditAction | 'all'>('all');
  const [entityFilter, setEntityFilter] = useState<AuditEntityType | 'all'>('all');
  
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await auditService.getAuditLogs({
        search,
        action: actionFilter,
        entityType: entityFilter
      });
      setLogs(data);
      setPage(1);
      setLoading(false);
    };
    
    // Add small debounce for search
    const timer = setTimeout(() => load(), 300);
    return () => clearTimeout(timer);
  }, [search, actionFilter, entityFilter]);

  const paginatedLogs = logs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <AdminLayout pageTitle="Audit Logs">
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Audit Logs</h2>
            <p className={m.pageSubtitle}>Historical read-only record of critical system actions</p>
          </div>
          <div className={m.pageActions}>
            <Badge variant="warning">Read-Only History</Badge>
          </div>
        </div>

        <div className={m.toolbar} style={{ background: 'var(--color-surface)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
          <div className={m.toolbarLeft}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
              <input 
                className={m.filterSelect} 
                style={{ paddingLeft: 36, width: 250 }} 
                placeholder="Search entity ID, admin, summary..." 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
              />
              {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}><X size={14} /></button>}
            </div>
            
            <select className={m.filterSelect} value={actionFilter} onChange={e => setActionFilter(e.target.value as any)}>
              {ACTION_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>

            <select className={m.filterSelect} value={entityFilter} onChange={e => setEntityFilter(e.target.value as any)}>
              {ENTITY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
        </div>

        <div className={m.tableCard}>
          {loading ? (
            <PageSkeleton rows={8} showToolbar={false} />
          ) : logs.length === 0 ? (
            <EmptyState title="No audit records found" description="Adjust your filters to see historical actions." />
          ) : (
            <>
              <div className={`${m.tableWrap} admin-table-wrap`}>
                <table>
                  <thead>
                    <tr>
                      <th>Date / Time</th>
                      <th>Admin</th>
                      <th>Action</th>
                      <th>Entity</th>
                      <th>Summary</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedLogs.map((log) => (
                      <tr key={log.id}>
                        <td style={{ fontSize: 'var(--font-size-sm)' }}>
                          {new Date(log.timestamp).toLocaleDateString()}
                          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{new Date(log.timestamp).toLocaleTimeString()}</div>
                        </td>
                        <td style={{ fontSize: 'var(--font-size-sm)', fontFamily: 'monospace' }}>{log.adminEmail}</td>
                        <td><Badge variant="neutral">{log.action}</Badge></td>
                        <td>
                          <div className={m.cellPrimary}>{log.entityType}</div>
                          <div className={m.cellSecondary} style={{ fontFamily: 'monospace', color: 'var(--color-brand-600)' }}>{log.entityId}</div>
                        </td>
                        <td style={{ fontSize: 'var(--font-size-sm)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.summary}
                        </td>
                        <td>
                          <Button size="sm" variant="ghost" onClick={() => setSelectedLog(log)} leftIcon={<Eye size={14} />}>View</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={logs.length} onPageChange={setPage} />
            </>
          )}
        </div>
      </div>

      <Modal isOpen={!!selectedLog} onClose={() => setSelectedLog(null)} title="Audit Log Details" size="md">
        {selectedLog && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', background: 'var(--color-gray-50)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Log ID</div>
                <div style={{ fontFamily: 'monospace', fontSize: 13 }}>{selectedLog.id}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Timestamp</div>
                <div style={{ fontSize: 13 }}>{new Date(selectedLog.timestamp).toLocaleString()}</div>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Admin User</div>
                <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--color-brand-600)' }}>{selectedLog.adminEmail}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Action</div>
                <Badge variant="neutral">{selectedLog.action}</Badge>
              </div>
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Entity affected</div>
                <div style={{ fontSize: 13 }}>{selectedLog.entityType} <span style={{ fontFamily: 'monospace', color: 'var(--color-text-tertiary)' }}>({selectedLog.entityId})</span></div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-4)' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Action Summary</div>
              <div style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>{selectedLog.summary}</div>
            </div>

            {(selectedLog.previousValue || selectedLog.newValue) && (
              <div style={{ display: 'flex', gap: 'var(--space-4)', background: 'var(--color-warning-50)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-warning-200)' }}>
                {selectedLog.previousValue && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--color-warning-700)', marginBottom: 4 }}>Previous Value</div>
                    <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{selectedLog.previousValue}</div>
                  </div>
                )}
                {selectedLog.newValue && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--color-success-700)', marginBottom: 4 }}>New Value</div>
                    <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{selectedLog.newValue}</div>
                  </div>
                )}
              </div>
            )}

            {selectedLog.reason && (
              <div>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Provided Reason</div>
                <div style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--color-text-secondary)', padding: '8px 12px', background: 'var(--color-surface)', borderLeft: '3px solid var(--color-border)' }}>
                  "{selectedLog.reason}"
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
              <Button variant="secondary" onClick={() => setSelectedLog(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}
