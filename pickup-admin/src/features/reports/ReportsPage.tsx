'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { FileText, Download, Calendar, Filter } from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Button } from '@/components/ui/Button/Button';
import { Badge } from '@/components/ui/Badge/Badge';
import { Loader } from '@/components/ui/Loader/Loader';
import { PageSkeleton } from '@/components/ui/PageSkeleton/PageSkeleton';
import { Pagination } from '@/components/ui/Pagination/Pagination';
import * as reportService from '@/services/reportService';
import type { ReportType, BaseReportData } from '@/types/report';
import m from '@/components/ui/shared/module.module.css';

const REPORT_TYPES: { value: ReportType, label: string }[] = [
  { value: 'bookings', label: 'Bookings Report' },
  { value: 'cancellations', label: 'Cancellations Report' },
  { value: 'revenue', label: 'Revenue Report' },
  { value: 'commission', label: 'Commission Report' },
  { value: 'payments', label: 'Payments Report' },
  { value: 'drivers', label: 'Drivers Report' },
  { value: 'vehicles', label: 'Vehicles Report' },
  { value: 'wallet', label: 'Wallet Report' },
];

const PAGE_SIZE = 15;

export default function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>('bookings');
  const [dateRange, setDateRange] = useState('30 Days');
  const [data, setData] = useState<BaseReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const res = await reportService.generateReport(reportType, dateRange);
      setData(res);
      setPage(1);
      setLoading(false);
    };
    load();
  }, [reportType, dateRange]);

  const paginatedRows = useMemo(() => {
    if (!data) return [];
    return data.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }, [data, page]);

  return (
    <AdminLayout pageTitle="Reports">
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Operational Reports</h2>
            <p className={m.pageSubtitle}>View and analyze platform metrics</p>
          </div>
          <div className={m.pageActions}>
            <Button variant="outline" leftIcon={<Download size={14} />} onClick={() => alert('Mock: Export to CSV')}>Export</Button>
          </div>
        </div>

        <div className={m.toolbar} style={{ background: 'var(--color-surface)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
          <div className={m.toolbarLeft}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <FileText size={16} color="var(--color-text-tertiary)" />
              <select className={m.filterSelect} value={reportType} onChange={e => setReportType(e.target.value as ReportType)} style={{ width: 220 }}>
                {REPORT_TYPES.map(rt => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
              </select>
            </div>
            
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginLeft: 16 }}>
              <Calendar size={16} color="var(--color-text-tertiary)" />
              <select className={m.filterSelect} value={dateRange} onChange={e => setDateRange(e.target.value)}>
                <option value="Today">Today</option>
                <option value="7 Days">Last 7 Days</option>
                <option value="30 Days">Last 30 Days</option>
                <option value="Custom">Custom Range</option>
              </select>
            </div>
          </div>
          <div className={m.toolbarRight}>
            <Button variant="ghost" size="sm" leftIcon={<Filter size={14} />}>More Filters</Button>
          </div>
        </div>

        {loading ? (
          <PageSkeleton rows={8} showToolbar={false} showCards />
        ) : !data ? (
          <div>No report data available.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            
            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
              {data.summary.map((sum, i) => (
                <div key={i} style={{ background: 'var(--color-surface)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 4 }}>{sum.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-primary)' }}>{sum.value}</div>
                </div>
              ))}
            </div>

            {/* Table */}
            <div className={m.tableCard}>
              <div className={`${m.tableWrap} admin-table-wrap`}>
                <table>
                  <thead>
                    <tr>
                      {data.headers.map((h, i) => <th key={i}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.length === 0 ? (
                      <tr><td colSpan={data.headers.length} style={{ textAlign: 'center', padding: 'var(--space-6)' }}>No records found for this period.</td></tr>
                    ) : paginatedRows.map((row, rIdx) => (
                      <tr key={rIdx}>
                        {row.map((cell, cIdx) => (
                          <td key={cIdx}>
                            {cIdx === 0 && cell.toString().includes('-') ? (
                              <span style={{ fontWeight: 600, color: 'var(--color-brand-600)' }}>{cell}</span>
                            ) : ['Completed', 'Active'].includes(cell as string) ? (
                              <Badge variant="success">{cell}</Badge>
                            ) : ['Cancelled', 'Failed', 'Inactive'].includes(cell as string) ? (
                              <Badge variant="danger">{cell}</Badge>
                            ) : cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={data.rows.length} onPageChange={setPage} />
            </div>

          </div>
        )}
      </div>
    </AdminLayout>
  );
}
