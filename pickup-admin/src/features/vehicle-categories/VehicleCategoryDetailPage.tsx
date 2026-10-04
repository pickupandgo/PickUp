'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { Loader } from '@/components/ui/Loader/Loader';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import * as vehicleCategoryService from '@/services/vehicleCategoryService';
import * as businessRulesService from '@/services/businessRulesService';
import type { VehicleCategoryConfig, CategoryPricing } from '@/types/vehicleCategory';
import type { SurchargeRule, CommissionRule, CancellationRule } from '@/types/businessRules';
import m from '@/components/ui/shared/module.module.css';

interface Props { categoryId: string }

export default function VehicleCategoryDetailPage({ categoryId }: Props) {
  const router = useRouter();
  const [category, setCategory] = useState<VehicleCategoryConfig | null>(null);
  const [pricing, setPricing] = useState<CategoryPricing | null>(null);
  const [surcharges, setSurcharges] = useState<SurchargeRule[]>([]);
  const [commission, setCommission] = useState<CommissionRule | null>(null);
  const [cancellation, setCancellation] = useState<CancellationRule | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [catData, priceData, surData, comData, cancData] = await Promise.all([
      vehicleCategoryService.getCategoryById(categoryId),
      vehicleCategoryService.getPricingByCategory(categoryId),
      businessRulesService.getSurcharges(),
      businessRulesService.getCommission(),
      businessRulesService.getCancellationRules()
    ]);
    setCategory(catData);
    setPricing(priceData);
    setSurcharges(surData);
    setCommission(comData);
    setCancellation(cancData);
    setLoading(false);
  };

  useEffect(() => { load(); }, [categoryId]);

  if (loading) return <AdminLayout pageTitle="Category Detail"><Loader fullPage /></AdminLayout>;
  if (!category) return (
    <AdminLayout pageTitle="Category Detail">
      <EmptyState title="Category not found" action={<Button onClick={() => router.push('/vehicle-categories')}>Back to Categories</Button>} description="" />
    </AdminLayout>
  );

  return (
    <AdminLayout pageTitle={`Category — ${category.displayName}`}>
      <div className={m.detailPage}>
        <div className={m.detailHeader}>
          <button className={m.backBtn} onClick={() => router.push('/vehicle-categories')}><ArrowLeft size={16} /> Vehicle Categories</button>
          <h2 className={m.detailTitle}>{category.displayName}</h2>
          <div className={m.detailHeaderRight}>
            <Button variant="secondary" size="sm" leftIcon={<Edit2 size={14} />} onClick={() => toast('Edit Category UI would open here')}>Edit Category</Button>
          </div>
        </div>

        <div className={m.detailGrid}>
          {/* Left Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <Card>
              <CardHeader title="Category Information" />
              <div className={m.infoGrid}>
                <div className={m.infoItem}><span className={m.infoLabel}>Category ID</span><span className={m.infoValue}><span className={m.cellId}>{category.id}</span></span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Display Name</span><span className={m.infoValue}>{category.displayName}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Code</span><span className={m.infoValue}>{category.categoryCode}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Capacity</span><span className={m.infoValue}>{category.capacityDisplay}</span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Pricing Type</span><span className={m.infoValue}><Badge variant="neutral">{category.pricingType}</Badge></span></div>
                <div className={m.infoItem}><span className={m.infoLabel}>Status</span><span className={m.infoValue}><Badge variant={category.status === 'active' ? 'success' : 'neutral'} dot>{category.status.charAt(0).toUpperCase() + category.status.slice(1)}</Badge></span></div>
              </div>
              <div style={{ marginTop: 'var(--space-4)' }}>
                <span className={m.infoLabel}>Description</span>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginTop: 4 }}>{category.description}</p>
              </div>
            </Card>

            <Card>
              <CardHeader 
                title="Pricing Summary" 
                action={<Button size="sm" variant="outline" onClick={() => router.push('/pricing')}>Manage Pricing</Button>}
              />
              {pricing?.pricingType === 'Hourly Based' ? (
                <div className={m.infoGrid}>
                  <div className={m.infoItem}><span className={m.infoLabel}>Hourly Rate</span><span className={m.infoValue} style={{ fontWeight: 600 }}>₹{pricing.hourlyPricing?.hourlyRate}</span></div>
                  <div className={m.infoItem}><span className={m.infoLabel}>Minimum Billable</span><span className={m.infoValue}>{pricing.hourlyPricing?.minimumBillableHours} Hour(s)</span></div>
                </div>
              ) : (
                <div className={m.infoGrid}>
                  <div className={m.infoItem}><span className={m.infoLabel}>Base Fare</span><span className={m.infoValue} style={{ fontWeight: 600 }}>₹{pricing?.distancePricing?.baseFare}</span></div>
                  <div className={m.infoItem}><span className={m.infoLabel}>Per KM Rate</span><span className={m.infoValue} style={{ fontWeight: 600 }}>₹{pricing?.distancePricing?.perKmRate}</span></div>
                  <div className={m.infoItem}><span className={m.infoLabel}>Minimum Fare</span><span className={m.infoValue} style={{ fontWeight: 600 }}>₹{pricing?.distancePricing?.minimumFare}</span></div>
                  <div className={m.infoItem}><span className={m.infoLabel}>Additional Drop Fee</span><span className={m.infoValue} style={{ fontWeight: 600 }}>₹{pricing?.distancePricing?.additionalDropFee}</span></div>
                </div>
              )}
            </Card>
          </div>

          {/* Right Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <Card>
              <CardHeader title="Surcharge Summary" action={<Button size="sm" variant="outline" onClick={() => router.push('/surcharges')}>Manage</Button>} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {surcharges.map(sur => (
                  <div key={sur.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>{sur.name}</span>
                      <Badge variant={sur.enabled ? 'success' : 'neutral'}>{sur.enabled ? 'Enabled' : 'Disabled'}</Badge>
                    </div>
                    {sur.enabled && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 12, borderLeft: '2px solid var(--color-border)' }}>
                        {sur.tiers.map(t => (
                          <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)' }}>
                            <span style={{ color: 'var(--color-text-secondary)' }}>{t.label}</span>
                            <span style={{ fontWeight: 600 }}>+{t.value}{t.type === 'percentage' ? '%' : '₹'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader title="Commission & Cancellation" action={<Button size="sm" variant="outline" onClick={() => router.push('/cancellation-rules')}>Manage</Button>} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Platform Commission</span>
                  <span style={{ fontWeight: 600 }}>{commission?.platformCommissionPercentage}%</span>
                </div>
                <div style={{ height: 1, background: 'var(--color-border)', margin: '4px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Cust. Cancellation</span>
                  <span style={{ fontWeight: 600 }}>{cancellation?.customerCancellationChargePercentage}% charge</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>Driver Tolerance</span>
                  <span style={{ fontWeight: 600 }}>{cancellation?.driverRepeatedThreshold} cancels</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
