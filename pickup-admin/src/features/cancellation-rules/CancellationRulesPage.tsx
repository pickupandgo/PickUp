'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Edit2, AlertOctagon, UserX } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Button } from '@/components/ui/Button/Button';
import { Modal } from '@/components/ui/Modal/Modal';
import { Loader } from '@/components/ui/Loader/Loader';
import * as businessRulesService from '@/services/businessRulesService';
import type { CancellationRule } from '@/types/businessRules';
import m from '@/components/ui/shared/module.module.css';
import p from '@/features/pricing/PricingPage.module.css';

export default function CancellationRulesPage() {
  const [rules, setRules] = useState<CancellationRule | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [editRules, setEditRules] = useState<CancellationRule | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await businessRulesService.getCancellationRules();
    setRules(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!editRules) return;
    setSaving(true);
    await businessRulesService.updateCancellationRules({
      customerDistanceThresholdMeters: editRules.customerDistanceThresholdMeters,
      customerCancellationChargePercentage: editRules.customerCancellationChargePercentage,
      driverRepeatedThreshold: editRules.driverRepeatedThreshold,
      driverAutoBlockDurationHours: editRules.driverAutoBlockDurationHours,
    });
    toast.success('Cancellation rules updated successfully');
    setSaving(false);
    setEditRules(null);
    load();
  };

  if (loading || !rules) return <AdminLayout pageTitle="Cancellation Rules"><Loader fullPage /></AdminLayout>;

  return (
    <AdminLayout pageTitle="Cancellation Rules">
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Cancellation Rules</h2>
            <p className={m.pageSubtitle}>Configure thresholds and penalties for trip cancellations</p>
          </div>
          <div className={m.pageActions}>
             <Button variant="secondary" leftIcon={<Edit2 size={14} />} onClick={() => setEditRules(JSON.parse(JSON.stringify(rules)))}>Edit Rules</Button>
          </div>
        </div>

        <div className={m.detailGrid}>
          {/* Customer */}
          <Card>
            <CardHeader title="Customer Cancellation" icon={<UserX size={18} />} />
            <div className={m.infoGrid}>
              <div className={m.infoItem}>
                <span className={m.infoLabel}>Proximity Threshold</span>
                <span className={m.infoValue} style={{ fontWeight: 600 }}>{rules.customerDistanceThresholdMeters} meters</span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: 2 }}>Driver must be within this distance to charge</span>
              </div>
              <div className={m.infoItem}>
                <span className={m.infoLabel}>Cancellation Fee</span>
                <span className={m.infoValue} style={{ fontWeight: 600 }}>{rules.customerCancellationChargePercentage}% of est. fare</span>
              </div>
            </div>
            
            <div style={{ marginTop: 'var(--space-5)' }}>
              <span className={m.infoLabel} style={{ marginBottom: 'var(--space-3)', display: 'block' }}>Customer Reasons</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {rules.reasons.filter(r => r.type === 'customer').map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: r.enabled ? 'var(--color-success-500)' : 'var(--color-gray-300)' }} />
                    <span style={{ color: r.enabled ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>{r.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Driver */}
          <Card>
            <CardHeader title="Driver Cancellation" icon={<AlertOctagon size={18} />} />
            <div className={m.infoGrid}>
              <div className={m.infoItem}>
                <span className={m.infoLabel}>Repeated Threshold</span>
                <span className={m.infoValue} style={{ fontWeight: 600, color: 'var(--color-danger-600)' }}>{rules.driverRepeatedThreshold} trips</span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: 2 }}>Max allowed cancellations per week</span>
              </div>
              <div className={m.infoItem}>
                <span className={m.infoLabel}>Auto-Block Duration</span>
                <span className={m.infoValue} style={{ fontWeight: 600 }}>{rules.driverAutoBlockDurationHours} hours</span>
              </div>
            </div>

            <div style={{ marginTop: 'var(--space-5)' }}>
              <span className={m.infoLabel} style={{ marginBottom: 'var(--space-3)', display: 'block' }}>Driver Reasons</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {rules.reasons.filter(r => r.type === 'driver').map(r => (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: r.enabled ? 'var(--color-success-500)' : 'var(--color-gray-300)' }} />
                    <span style={{ color: r.enabled ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)' }}>{r.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Modal isOpen={!!editRules} onClose={() => setEditRules(null)} title="Edit Cancellation Rules" size="md">
        {editRules && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border)', paddingBottom: 4 }}>Customer Rules</h4>
            <div className={p.formGroup}>
              <label className={p.label}>Distance Threshold (meters)</label>
              <input type="number" className={p.input} value={editRules.customerDistanceThresholdMeters} onChange={(e) => setEditRules({ ...editRules, customerDistanceThresholdMeters: Number(e.target.value) })} />
            </div>
            <div className={p.formGroup}>
              <label className={p.label}>Cancellation Charge (%)</label>
              <input type="number" className={p.input} value={editRules.customerCancellationChargePercentage} onChange={(e) => setEditRules({ ...editRules, customerCancellationChargePercentage: Number(e.target.value) })} />
            </div>

            <h4 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 700, color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border)', paddingBottom: 4, marginTop: 'var(--space-4)' }}>Driver Rules</h4>
            <div className={p.formGroup}>
              <label className={p.label}>Repeated Threshold (Cancellations)</label>
              <input type="number" className={p.input} value={editRules.driverRepeatedThreshold} onChange={(e) => setEditRules({ ...editRules, driverRepeatedThreshold: Number(e.target.value) })} />
            </div>
            <div className={p.formGroup}>
              <label className={p.label}>Auto-Block Duration (Hours)</label>
              <input type="number" className={p.input} value={editRules.driverAutoBlockDurationHours} onChange={(e) => setEditRules({ ...editRules, driverAutoBlockDurationHours: Number(e.target.value) })} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
              <Button variant="secondary" onClick={() => setEditRules(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleSave} isLoading={saving}>Save Changes</Button>
            </div>
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}
