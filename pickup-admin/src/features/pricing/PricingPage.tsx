'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Edit2, Calculator } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { Modal } from '@/components/ui/Modal/Modal';
import { Loader } from '@/components/ui/Loader/Loader';
import * as vehicleCategoryService from '@/services/vehicleCategoryService';
import * as businessRulesService from '@/services/businessRulesService';
import type { VehicleCategoryConfig, CategoryPricing } from '@/types/vehicleCategory';
import type { WeightPricingRule } from '@/types/businessRules';
import m from '@/components/ui/shared/module.module.css';
import styles from './PricingPage.module.css';

export default function PricingPage() {
  const [categories, setCategories] = useState<VehicleCategoryConfig[]>([]);
  const [pricingMap, setPricingMap] = useState<CategoryPricing[]>([]);
  const [weightRule, setWeightRule] = useState<WeightPricingRule | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit Modal State
  const [editPrice, setEditPrice] = useState<CategoryPricing | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [cats, prices, weight] = await Promise.all([
      vehicleCategoryService.getCategories(),
      vehicleCategoryService.getPricing(),
      businessRulesService.getWeightPricing()
    ]);
    setCategories(cats);
    setPricingMap(prices);
    setWeightRule(weight);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSavePrice = async () => {
    if (!editPrice) return;
    setSaving(true);
    await vehicleCategoryService.updatePricing(editPrice.categoryId, editPrice);
    toast.success('Pricing updated successfully');
    setSaving(false);
    setEditPrice(null);
    load();
  };

  const getPrice = (catId: string) => pricingMap.find(p => p.categoryId === catId);

  if (loading) return <AdminLayout pageTitle="Fare & Pricing"><Loader fullPage /></AdminLayout>;

  return (
    <AdminLayout pageTitle="Fare & Pricing">
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Fare & Pricing</h2>
            <p className={m.pageSubtitle}>Configure base fares, per-km rates, and hourly pricing models</p>
          </div>
          <div className={m.pageActions}>
            <Button variant="outline" leftIcon={<Calculator size={16} />} onClick={() => toast('Pricing Preview Demo opened')}>Fare Preview Demo</Button>
          </div>
        </div>

        {/* Categories Pricing List */}
        <div className={m.detailGrid} style={{ gridTemplateColumns: '1fr' }}>
          {categories.map(cat => {
            const p = getPrice(cat.id);
            if (!p) return null;
            const isHourly = p.pricingType === 'Hourly Based';
            return (
              <Card key={cat.id}>
                <div className={styles.priceRow}>
                  <div className={styles.priceInfo}>
                    <div className={styles.priceTitleRow}>
                      <h3 className={styles.priceTitle}>{cat.displayName}</h3>
                      <Badge variant="neutral">{p.pricingType}</Badge>
                      {cat.status === 'inactive' && <Badge variant="warning">Inactive Category</Badge>}
                    </div>
                    <p className={styles.priceDesc}>{cat.capacityDisplay}</p>
                  </div>
                  
                  <div className={styles.priceMetrics}>
                    {isHourly ? (
                      <>
                        <div className={styles.metric}>
                          <span className={styles.metricLabel}>Hourly Rate</span>
                          <span className={styles.metricValue}>₹{p.hourlyPricing?.hourlyRate}</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricLabel}>Min. Hours</span>
                          <span className={styles.metricValue}>{p.hourlyPricing?.minimumBillableHours}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={styles.metric}>
                          <span className={styles.metricLabel}>Base Fare</span>
                          <span className={styles.metricValue}>₹{p.distancePricing?.baseFare}</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricLabel}>Per KM</span>
                          <span className={styles.metricValue}>₹{p.distancePricing?.perKmRate}</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricLabel}>Min Fare</span>
                          <span className={styles.metricValue}>₹{p.distancePricing?.minimumFare}</span>
                        </div>
                        <div className={styles.metric}>
                          <span className={styles.metricLabel}>Extra Drop</span>
                          <span className={styles.metricValue}>₹{p.distancePricing?.additionalDropFee}</span>
                        </div>
                      </>
                    )}
                  </div>

                  <div className={styles.priceAction}>
                    <Button variant="secondary" size="sm" leftIcon={<Edit2 size={14} />} onClick={() => setEditPrice(JSON.parse(JSON.stringify(p)))}>
                      Edit
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Optional Weight Rules Preview */}
        <div style={{ marginTop: 'var(--space-6)' }}>
          <h3 className={m.pageTitle} style={{ fontSize: 'var(--font-size-lg)', marginBottom: 'var(--space-2)' }}>Weight Pricing Rules — Optional</h3>
          <p className={m.pageSubtitle} style={{ marginBottom: 'var(--space-4)' }}>Configurable UI for optional weight-based surcharges. Not active in core fare calculation engine by default.</p>
          <Card>
            <CardHeader title="Weight Bands Configuration" action={<Badge variant={weightRule?.enabled ? 'success' : 'neutral'}>{weightRule?.enabled ? 'Enabled' : 'Disabled'}</Badge>} />
            <div className={styles.weightBands}>
              {weightRule?.bands.map(b => (
                <div key={b.id} className={styles.weightBandRow}>
                  <span>{b.minKg} kg — {b.maxKg} kg</span>
                  <span style={{ fontWeight: 600 }}>+ ₹{b.charge}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal isOpen={!!editPrice} onClose={() => setEditPrice(null)} title={`Edit Pricing — ${categories.find(c => c.id === editPrice?.categoryId)?.displayName}`} size="md">
        {editPrice && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {editPrice.pricingType === 'Hourly Based' ? (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Hourly Rate (₹)</label>
                  <input type="number" className={styles.input} value={editPrice.hourlyPricing?.hourlyRate} onChange={e => setEditPrice({ ...editPrice, hourlyPricing: { ...editPrice.hourlyPricing!, hourlyRate: Number(e.target.value) }})} />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Minimum Billable Hours</label>
                  <input type="number" className={styles.input} value={editPrice.hourlyPricing?.minimumBillableHours} onChange={e => setEditPrice({ ...editPrice, hourlyPricing: { ...editPrice.hourlyPricing!, minimumBillableHours: Number(e.target.value) }})} />
                </div>
              </>
            ) : (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Base Fare (₹)</label>
                  <input type="number" className={styles.input} value={editPrice.distancePricing?.baseFare} onChange={e => setEditPrice({ ...editPrice, distancePricing: { ...editPrice.distancePricing!, baseFare: Number(e.target.value) }})} />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Per KM Rate (₹)</label>
                  <input type="number" className={styles.input} value={editPrice.distancePricing?.perKmRate} onChange={e => setEditPrice({ ...editPrice, distancePricing: { ...editPrice.distancePricing!, perKmRate: Number(e.target.value) }})} />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Minimum Fare (₹)</label>
                  <input type="number" className={styles.input} value={editPrice.distancePricing?.minimumFare} onChange={e => setEditPrice({ ...editPrice, distancePricing: { ...editPrice.distancePricing!, minimumFare: Number(e.target.value) }})} />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.label}>Additional Drop Fee (₹)</label>
                  <input type="number" className={styles.input} value={editPrice.distancePricing?.additionalDropFee} onChange={e => setEditPrice({ ...editPrice, distancePricing: { ...editPrice.distancePricing!, additionalDropFee: Number(e.target.value) }})} />
                </div>
              </>
            )}
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
              <Button variant="secondary" onClick={() => setEditPrice(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleSavePrice} isLoading={saving}>Save Changes</Button>
            </div>
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}
