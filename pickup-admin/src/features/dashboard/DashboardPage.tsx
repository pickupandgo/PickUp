'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  TrendingUp, TrendingDown, Package, Users, Truck, 
  MapPin, AlertOctagon, IndianRupee, PieChart, Activity
} from 'lucide-react';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Badge } from '@/components/ui/Badge/Badge';
import { Loader } from '@/components/ui/Loader/Loader';
import { Button } from '@/components/ui/Button/Button';
import * as dashboardService from '@/services/dashboardService';
import { mockRealtimeService } from '@/services/mockRealtimeService';
import type { DashboardSummary } from '@/types/dashboard';
import type { LiveOperationsData } from '@/types/live';
import m from '@/components/ui/shared/module.module.css';
import styles from './DashboardPage.module.css';

export default function DashboardPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [liveData, setLiveData] = useState<LiveOperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFilter, setDateFilter] = useState('Today');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await dashboardService.getDashboardSummary(dateFilter);
      setSummary(data);
      setLoading(false);
    };
    load();
  }, [dateFilter]);

  useEffect(() => {
    // Start live ops simulation if not running
    mockRealtimeService.startSimulation();
    const unsub = mockRealtimeService.subscribe((data) => {
      setLiveData(data);
    });
    return () => {
      unsub();
      // Keep it running globally if needed, or stop on unmount.
      // mockRealtimeService.stopSimulation(); 
    };
  }, []);

  if (loading || !summary) {
    return <AdminLayout pageTitle="Dashboard"><Loader fullPage /></AdminLayout>;
  }

  const mData = summary.metrics;

  return (
    <AdminLayout pageTitle="Dashboard">
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Logistics Operations Center</h2>
            <p className={m.pageSubtitle}>Monitor key performance indicators and live trips</p>
          </div>
          <div className={m.pageActions}>
            <select className={m.filterSelect} value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
              <option value="Today">Today</option>
              <option value="Yesterday">Yesterday</option>
              <option value="This Week">This Week</option>
              <option value="This Month">This Month</option>
            </select>
          </div>
        </div>

        {/* KPIs */}
        <div className={styles.kpiGrid}>
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span className={styles.kpiLabel}>Total Bookings</span>
              <div className={styles.kpiIcon}><Package size={18} /></div>
            </div>
            <div className={styles.kpiValue}>{mData.totalBookings}</div>
            <div className={`${styles.kpiTrend} ${styles.up}`}>
              <TrendingUp size={14} /> +{mData.trends?.totalBookings}% from last period
            </div>
          </div>
          
          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span className={styles.kpiLabel}>Active Trips</span>
              <div className={styles.kpiIcon} style={{ color: 'var(--color-warning-600)', background: 'var(--color-warning-50)' }}><Activity size={18} /></div>
            </div>
            <div className={styles.kpiValue}>{mData.activeTrips}</div>
            <div className={styles.kpiTrend} style={{ color: 'var(--color-text-tertiary)' }}>Live currently</div>
          </div>

          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span className={styles.kpiLabel}>Online Drivers</span>
              <div className={styles.kpiIcon} style={{ color: 'var(--color-success-600)', background: 'var(--color-success-50)' }}><Truck size={18} /></div>
            </div>
            <div className={styles.kpiValue}>{mData.onlineDrivers}</div>
            <div className={styles.kpiTrend} style={{ color: 'var(--color-text-tertiary)' }}>{mData.activeDrivers} currently on trip</div>
          </div>

          <div className={styles.kpiCard}>
            <div className={styles.kpiHeader}>
              <span className={styles.kpiLabel}>Total Revenue</span>
              <div className={styles.kpiIcon}><IndianRupee size={18} /></div>
            </div>
            <div className={styles.kpiValue}>₹{mData.revenue.toLocaleString()}</div>
            <div className={`${styles.kpiTrend} ${styles.up}`}>
              <TrendingUp size={14} /> +{mData.trends?.revenue}% from last period
            </div>
          </div>
        </div>

        {/* Live Ops & Commision Row */}
        <div className={styles.opsGrid}>
          {/* Live Operations Summary */}
          <Card>
            <CardHeader 
              title="Live Trips Overview" 
              icon={<MapPin size={18} color="var(--color-brand-500)" />} 
              action={<Button size="sm" variant="outline" onClick={() => router.push('/live-trips')}>Open Live Map</Button>}
            />
            {liveData?.activeTrips.length === 0 ? (
              <div style={{ padding: 'var(--space-4) 0', color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>No active trips right now.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {liveData?.activeTrips.slice(0, 5).map(trip => (
                  <div key={trip.bookingId} className={styles.listRow}>
                    <div className={styles.listColMain}>
                      <span className={styles.listTitle}>{trip.bookingId} <Badge variant="warning">{trip.status}</Badge></span>
                      <span className={styles.listSubtitle}>{trip.pickup.address?.split(',')[0]} → {trip.drops[0]?.location.address?.split(',')[0]}</span>
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <span className={styles.listTitle}>{trip.driverName}</span>
                      <span className={styles.listSubtitle} style={{ fontFamily: 'monospace' }}>{trip.vehicleRegistrationNumber}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <Card>
              <CardHeader title="Platform Commission" icon={<PieChart size={18} />} />
              <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--color-brand-600)', margin: 'var(--space-2) 0' }}>
                ₹{mData.platformCommission.toLocaleString()}
              </div>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Generated from completed bookings {dateFilter.toLowerCase()}.</p>
            </Card>

            <div className={styles.kpiCard}>
              <div className={styles.kpiHeader}>
                <span className={styles.kpiLabel}>Cancellations</span>
                <div className={styles.kpiIcon} style={{ color: 'var(--color-danger-600)', background: 'var(--color-danger-50)' }}><AlertOctagon size={18} /></div>
              </div>
              <div className={styles.kpiValue}>{mData.cancelledTrips}</div>
            </div>
          </div>
        </div>

        {/* Recent Data Row */}
        <div className={styles.opsGrid}>
          <Card>
            <CardHeader title="Recent Bookings" action={<Button size="sm" variant="ghost" onClick={() => router.push('/bookings')}>View All</Button>} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {summary.recentBookings.map(b => (
                <div key={b.id} className={styles.listRow}>
                  <div className={styles.listColMain}>
                    <span className={styles.listTitle} onClick={() => router.push(`/bookings/${b.id}`)} style={{ cursor: 'pointer', color: 'var(--color-brand-600)' }}>{b.id}</span>
                    <span className={styles.listSubtitle}>{b.customerName} • {b.vehicleCategoryName}</span>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span className={styles.listTitle}>₹{b.totalFare}</span>
                    <Badge variant={b.status === 'Completed' ? 'success' : 'info'}>{b.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent Cancellations" />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {summary.recentCancellations.length === 0 ? (
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)', padding: 'var(--space-4) 0' }}>No recent cancellations.</div>
              ) : summary.recentCancellations.map(c => (
                <div key={c.id} className={styles.listRow}>
                  <div className={styles.listColMain}>
                    <span className={styles.listTitle} onClick={() => router.push(`/bookings/${c.id}`)} style={{ cursor: 'pointer', color: 'var(--color-brand-600)' }}>{c.id}</span>
                    <span className={styles.listSubtitle} style={{ color: 'var(--color-danger-600)' }}>{c.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

      </div>
    </AdminLayout>
  );
}
