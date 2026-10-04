'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Edit2, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { AdminLayout } from '@/components/layout/AdminLayout/AdminLayout';
import { Button } from '@/components/ui/Button/Button';
import { Badge } from '@/components/ui/Badge/Badge';
import { Modal } from '@/components/ui/Modal/Modal';
import { Loader } from '@/components/ui/Loader/Loader';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { PageSkeleton } from '@/components/ui/PageSkeleton/PageSkeleton';
import * as instructionService from '@/services/driverInstructionService';
import { DriverInstruction, InstructionStatus, InstructionType } from '@/types/driverInstruction';
import m from '@/components/ui/shared/module.module.css';

export default function DriverInstructionsPage() {
  const [instructions, setInstructions] = useState<DriverInstruction[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Form state
  const [formId, setFormId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<InstructionType>('Driver Instruction');
  const [status, setStatus] = useState<InstructionStatus>('Active');
  const [priority, setPriority] = useState<number>(1);

  const load = async () => {
    setLoading(true);
    const data = await instructionService.getInstructions();
    setInstructions(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreateModal = () => {
    setFormId('');
    setTitle('');
    setMessage('');
    setType('Driver Instruction');
    setStatus('Active');
    setPriority(1);
    setIsModalOpen(true);
  };

  const openEditModal = (inst: DriverInstruction) => {
    setFormId(inst.id);
    setTitle(inst.title);
    setMessage(inst.message);
    setType(inst.type);
    setStatus(inst.status);
    setPriority(inst.priority || 1);
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim() || !message.trim()) {
      return toast.error('Title and message are required.');
    }
    setSaving(true);
    await instructionService.saveInstruction({
      id: formId || undefined,
      title,
      message,
      type,
      status,
      priority
    });
    toast.success('Instruction saved successfully.');
    setSaving(false);
    setIsModalOpen(false);
    load();
  };

  const handleToggleStatus = async (id: string, currentStatus: InstructionStatus) => {
    const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
    await instructionService.toggleStatus(id, newStatus);
    toast.success(`Instruction marked as ${newStatus}`);
    load();
  };

  return (
    <AdminLayout pageTitle="Driver Instructions">
      <div className={m.page}>
        <div className={m.pageHeader}>
          <div>
            <h2 className={m.pageTitle}>Driver Instructions & Messages</h2>
            <p className={m.pageSubtitle}>Manage operational instructions pushed to the Driver App</p>
          </div>
          <div className={m.pageActions}>
            <Button leftIcon={<Plus size={16} />} onClick={openCreateModal}>New Instruction</Button>
          </div>
        </div>

        <div className={m.tableCard}>
          {loading ? (
            <PageSkeleton rows={5} showToolbar={false} />
          ) : instructions.length === 0 ? (
            <EmptyState title="No instructions found" description="Create a new instruction to show it to drivers." action={<Button onClick={openCreateModal}>Create Instruction</Button>} />
          ) : (
            <div className={`${m.tableWrap} admin-table-wrap`}>
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Title & Message</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {instructions.map((inst) => (
                    <tr key={inst.id}>
                      <td><Badge variant={inst.type === 'Driver Instruction' ? 'neutral' : 'warning'}>{inst.type}</Badge></td>
                      <td>
                        <div className={m.cellPrimary}>{inst.title}</div>
                        <div className={m.cellSecondary} style={{ maxWidth: 400, whiteSpace: 'normal', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {inst.message}
                        </div>
                      </td>
                      <td>{inst.priority}</td>
                      <td><Badge variant={inst.status === 'Active' ? 'success' : 'danger'}>{inst.status}</Badge></td>
                      <td style={{ fontSize: 'var(--font-size-sm)' }}>
                        {new Date(inst.updatedAt).toLocaleDateString()}
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>by {inst.createdBy.split('@')[0]}</div>
                      </td>
                      <td>
                        <div className={m.actionCell}>
                          <Button size="sm" variant="ghost" onClick={() => openEditModal(inst)} leftIcon={<Edit2 size={14} />}>Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => handleToggleStatus(inst.id, inst.status)} leftIcon={inst.status === 'Active' ? <XCircle size={14} color="var(--color-danger-500)" /> : <CheckCircle size={14} color="var(--color-success-500)" />}>
                            {inst.status === 'Active' ? 'Disable' : 'Enable'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={formId ? 'Edit Instruction' : 'Create Instruction'} size="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Type</label>
            <select className={m.filterSelect} style={{ width: '100%', padding: '10px 12px' }} value={type} onChange={e => setType(e.target.value as InstructionType)}>
              <option value="Driver Instruction">Driver Instruction</option>
              <option value="Operational Message">Operational Message</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Title</label>
            <input type="text" className={m.filterSelect} style={{ width: '100%', padding: '10px 12px' }} value={title} onChange={e => setTitle(e.target.value)} placeholder="E.g. Rain Protocol" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Message Content</label>
            <textarea className={m.filterSelect} style={{ width: '100%', padding: '10px 12px', minHeight: 100 }} value={message} onChange={e => setMessage(e.target.value)} placeholder="Message shown to drivers..." />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Priority (Order)</label>
              <input type="number" className={m.filterSelect} style={{ width: '100%', padding: '10px 12px' }} value={priority} onChange={e => setPriority(parseInt(e.target.value) || 1)} min={1} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Status</label>
              <select className={m.filterSelect} style={{ width: '100%', padding: '10px 12px' }} value={status} onChange={e => setStatus(e.target.value as InstructionStatus)}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} isLoading={saving}>Save Instruction</Button>
          </div>
        </div>
      </Modal>
    </AdminLayout>
  );
}
