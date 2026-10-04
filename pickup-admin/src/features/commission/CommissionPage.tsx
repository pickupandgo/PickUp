'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Edit2, Percent } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Card, CardHeader } from '@/components/ui/Card/Card';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { Modal } from '@/components/ui/Modal/Modal';
import { Loader } from '@/components/ui/Loader/Loader';
import * as businessRulesService from '@/services/businessRulesService';
import type { CommissionRule } from '@/types/businessRules';
import m from '@/components/ui/shared/module.module.css';
import p from '@/features/pricing/PricingPage.module.css';

export default function CommissionPage() {
  const [commission, setCommission] = useState<CommissionRule | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [editVal, setEditVal] = useState<number>(0);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await businessRulesService.getCommission();
    setCommission(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    await businessRulesService.updateCommission({ platformCommissionPercentage: editVal });
    toast.success('Commission updated successfully');
    setSaving(false);
    setIsEditing(false);
    load();
  };

  if (loading || !commission) return <AdminLayout pageTitle="Commission"><Loader fullPage /></AdminLayout>;

  return (
    <AdminLayout pageTitle="Commission">
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Commission</h2>
            <p className={m.pageSubtitle}>Configure platform revenue share logic</p>
          </div>
        </div>

        <div style={{ maxWidth: 600 }}>
          <Card>
            <CardHeader 
              title="Platform Commission" 
              icon={<Percent size={18} />}
              action={<Badge variant={commission.status === 'active' ? 'success' : 'neutral'}>{commission.status === 'active' ? 'Active' : 'Inactive'}</Badge>}
            />
            <div style={{ padding: 'var(--space-4)', background: 'var(--color-gray-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 4 }}>Standard Cut</div>
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 800, color: 'var(--color-brand-600)' }}>{commission.platformCommissionPercentage}%</div>
              </div>
              <Button variant="secondary" leftIcon={<Edit2 size={14} />} onClick={() => { setEditVal(commission.platformCommissionPercentage); setIsEditing(true); }}>Edit</Button>
            </div>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-4)' }}>
              This flat percentage is deducted from the driver's earnings for every completed trip (excluding tolls/parking if applicable).
            </p>
          </Card>
        </div>
      </div>

      <Modal isOpen={isEditing} onClose={() => setIsEditing(false)} title="Edit Commission" size="sm">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className={p.formGroup}>
            <label className={p.label}>Platform Commission (%)</label>
            <input 
              type="number" 
              className={p.input} 
              value={editVal} 
              onChange={(e) => setEditVal(Number(e.target.value))} 
              min={0} max={100}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)' }}>
            <Button variant="secondary" onClick={() => setIsEditing(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} isLoading={saving}>Save Changes</Button>
          </div>
        </div>
      </Modal>
    </AdminLayout>
  );
}
