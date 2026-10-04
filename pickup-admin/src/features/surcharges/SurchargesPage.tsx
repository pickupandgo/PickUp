'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Edit2, CloudRain, Car } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { Modal } from '@/components/ui/Modal/Modal';
import { Loader } from '@/components/ui/Loader/Loader';
import * as businessRulesService from '@/services/businessRulesService';
import type { SurchargeRule } from '@/types/businessRules';
import m from '@/components/ui/shared/module.module.css';
import p from '@/features/pricing/PricingPage.module.css'; // Reuse some form styles

export default function SurchargesPage() {
  const [surcharges, setSurcharges] = useState<SurchargeRule[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [editSurcharge, setEditSurcharge] = useState<SurchargeRule | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await businessRulesService.getSurcharges();
    setSurcharges(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!editSurcharge) return;
    setSaving(true);
    await businessRulesService.updateSurcharge(editSurcharge.id, editSurcharge);
    toast.success(`${editSurcharge.name} updated successfully`);
    setSaving(false);
    setEditSurcharge(null);
    load();
  };

  const toggleEnabled = async (rule: SurchargeRule) => {
    await businessRulesService.updateSurcharge(rule.id, { enabled: !rule.enabled });
    toast.success(`${rule.name} ${rule.enabled ? 'disabled' : 'enabled'}`);
    load();
  };

  if (loading) return <AdminLayout pageTitle="Surcharges"><Loader fullPage /></AdminLayout>;

  return (
    <AdminLayout pageTitle="Surcharges">
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Surcharges</h2>
            <p className={m.pageSubtitle}>Configure traffic, weather, and other dynamic pricing multipliers</p>
          </div>
        </div>

        <div className={m.detailGrid} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))' }}>
          {surcharges.map(rule => (
            <Card key={rule.id}>
              <CardHeader 
                title={rule.name} 
                icon={rule.name.includes('Traffic') ? <Car size={18} /> : <CloudRain size={18} />}
                action={
                  <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <Badge variant={rule.enabled ? 'success' : 'neutral'}>{rule.enabled ? 'Enabled' : 'Disabled'}</Badge>
                    <Button size="sm" variant="outline" onClick={() => toggleEnabled(rule)}>{rule.enabled ? 'Disable' : 'Enable'}</Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditSurcharge(JSON.parse(JSON.stringify(rule)))} leftIcon={<Edit2 size={12} />}>Edit</Button>
                  </div>
                }
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', opacity: rule.enabled ? 1 : 0.6 }}>
                {rule.tiers.map(tier => (
                  <div key={tier.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                    <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{tier.label}</span>
                    <span style={{ fontWeight: 700, color: 'var(--color-brand-600)' }}>
                      +{tier.value}{tier.type === 'percentage' ? '%' : '₹'}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Modal isOpen={!!editSurcharge} onClose={() => setEditSurcharge(null)} title={`Edit ${editSurcharge?.name}`} size="md">
        {editSurcharge && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {editSurcharge.tiers.map((tier, index) => (
              <div key={tier.id} className={p.formGroup}>
                <label className={p.label}>{tier.label} (+{tier.type === 'percentage' ? '%' : '₹'})</label>
                <input 
                  type="number" 
                  className={p.input} 
                  value={tier.value} 
                  onChange={(e) => {
                    const newTiers = [...editSurcharge.tiers];
                    newTiers[index].value = Number(e.target.value);
                    setEditSurcharge({ ...editSurcharge, tiers: newTiers });
                  }} 
                />
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
              <Button variant="secondary" onClick={() => setEditSurcharge(null)}>Cancel</Button>
              <Button variant="primary" onClick={handleSave} isLoading={saving}>Save Changes</Button>
            </div>
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}
