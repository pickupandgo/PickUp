'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Eye, Plus, Edit2, Ban, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Badge } from '@/components/ui/Badge/Badge';
import { Button } from '@/components/ui/Button/Button';
import { ConfirmDialog } from '@/components/ui/Modal/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { PageSkeleton } from '@/components/ui/PageSkeleton/PageSkeleton';
import { Pagination } from '@/components/ui/Pagination/Pagination';
import * as vehicleCategoryService from '@/services/vehicleCategoryService';
import type { VehicleCategoryConfig, CategoryPricing } from '@/types/vehicleCategory';
import m from '@/components/ui/shared/module.module.css';

const PAGE_SIZE = 10;

export default function VehicleCategoriesListPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<VehicleCategoryConfig[]>([]);
  const [pricing, setPricing] = useState<CategoryPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [confirmToggle, setConfirmToggle] = useState<VehicleCategoryConfig | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [cats, prices] = await Promise.all([
      vehicleCategoryService.getCategories(),
      vehicleCategoryService.getPricing()
    ]);
    
    let filtered = cats;
    if (search) {
      const q = search.toLowerCase();
      filtered = cats.filter(c => 
        c.displayName.toLowerCase().includes(q) || 
        c.categoryCode.toLowerCase().includes(q)
      );
    }
    setCategories(filtered);
    setPricing(prices);
    setPage(1);
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const paginated = categories.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleToggleStatus = async () => {
    if (!confirmToggle) return;
    setActionLoading(true);
    const newStatus = confirmToggle.status === 'active' ? 'inactive' : 'active';
    await vehicleCategoryService.updateCategory(confirmToggle.id, { status: newStatus });
    toast.success(`Category ${newStatus === 'active' ? 'enabled' : 'disabled'}`);
    setActionLoading(false);
    setConfirmToggle(null);
    load();
  };

  const getPriceDisplay = (catId: string) => {
    const p = pricing.find(x => x.categoryId === catId);
    if (!p) return { base: '—', perKm: '—', min: '—' };
    if (p.pricingType === 'Hourly Based') {
      return { base: `₹${p.hourlyPricing?.hourlyRate}/hr`, perKm: '—', min: '—' };
    }
    return {
      base: `₹${p.distancePricing?.baseFare}`,
      perKm: `₹${p.distancePricing?.perKmRate}`,
      min: `₹${p.distancePricing?.minimumFare}`,
    };
  };

  return (
    <AdminLayout pageTitle="Vehicle Categories">
      {loading ? (
        <PageSkeleton rows={6} showToolbar />
      ) : (
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Vehicle Categories</h2>
            <p className={m.pageSubtitle}>Manage fleet categories, capacity, and basic pricing models</p>
          </div>
          <div className={m.pageActions}>
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => toast('Add Category UI would open here (mocked)')}>
              Add Category
            </Button>
          </div>
        </div>

        <div className={m.toolbar}>
          <div className={m.toolbarLeft}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
              <input 
                className={m.filterSelect} 
                style={{ paddingLeft: 36, width: '100%' }} 
                placeholder="Search categories…" 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
              />
              {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--color-text-tertiary)' }}><X size={14} /></button>}
            </div>
          </div>
        </div>

        <div className={m.tableCard}>
          {categories.length === 0 ? (
            <EmptyState title="No categories found" description="Adjust your search." />
          ) : (
            <>
              <div className={`${m.tableWrap} admin-table-wrap`}>
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Capacity</th>
                      <th>Pricing Type</th>
                      <th>Base / Hourly</th>
                      <th>Per KM</th>
                      <th>Min Fare</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((c) => {
                      const prices = getPriceDisplay(c.id);
                      return (
                        <tr key={c.id} style={{ opacity: c.status === 'inactive' ? 0.6 : 1 }}>
                          <td>
                            <div className={m.cellPrimary}>{c.displayName}</div>
                            <div className={m.cellSecondary}>{c.categoryCode}</div>
                          </td>
                          <td>{c.capacityDisplay}</td>
                          <td><Badge variant="neutral">{c.pricingType}</Badge></td>
                          <td style={{ fontWeight: 600 }}>{prices.base}</td>
                          <td>{prices.perKm}</td>
                          <td>{prices.min}</td>
                          <td>
                            <Badge variant={c.status === 'active' ? 'success' : 'neutral'} dot>
                              {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                            </Badge>
                          </td>
                          <td>
                            <div className={m.actionCell}>
                              <Button size="sm" variant="ghost" onClick={() => router.push(`/vehicle-categories/${c.id}`)} leftIcon={<Eye size={14} />}>View</Button>
                              {c.status === 'active' 
                                ? <Button size="sm" variant="ghost" onClick={() => setConfirmToggle(c)} style={{ color: 'var(--color-warning-600)' }}>Disable</Button>
                                : <Button size="sm" variant="ghost" onClick={() => setConfirmToggle(c)} style={{ color: 'var(--color-success-600)' }}>Enable</Button>
                              }
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className={m.resultCount}><span>{categories.length} categor{categories.length !== 1 ? 'ies' : 'y'}</span></div>
              <Pagination page={page} pageSize={PAGE_SIZE} total={categories.length} onPageChange={setPage} />
            </>
          )}
        </div>
      </div>
      )}

      {confirmToggle && (
        <ConfirmDialog
          isOpen
          onClose={() => setConfirmToggle(null)}
          onConfirm={handleToggleStatus}
          isLoading={actionLoading}
          variant={confirmToggle.status === 'active' ? 'warning' : 'info'}
          title={confirmToggle.status === 'active' ? 'Disable Category?' : 'Enable Category?'}
          description={confirmToggle.status === 'active' 
            ? `Are you sure you want to disable ${confirmToggle.displayName}? New vehicles cannot be registered under this category.`
            : `Are you sure you want to enable ${confirmToggle.displayName}?`
          }
          confirmLabel={confirmToggle.status === 'active' ? 'Disable' : 'Enable'}
        />
      )}
    </AdminLayout>
  );
}
