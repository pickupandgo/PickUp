'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Car,
  CheckSquare,
  Truck,
  ClipboardList,
  MapPin,
  DollarSign,
  Wallet,
  CreditCard,
  BadgeCheck,
  XCircle,
  Globe,
  FileText,
  MessageSquare,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  Package,
  Box,
  Activity,
  Percent,
  ShieldAlert,
} from 'lucide-react';
import { clsx } from 'clsx';
import styles from './Sidebar.module.css';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  disabled?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: '',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard size={18} /> },
    ],
  },
  {
    title: 'Customers',
    items: [
      { label: 'Customers', href: '/customers', icon: <Users size={18} /> },
    ],
  },
  {
    title: 'Drivers',
    items: [
      { label: 'Drivers', href: '/drivers', icon: <Car size={18} /> },
      { label: 'KYC Verification', href: '/kyc', icon: <CheckSquare size={18} /> },
    ],
  },
  {
    title: 'Fleet',
    items: [
      { label: 'Vehicles', href: '/vehicles', icon: <Truck size={18} /> },
      { label: 'Vehicle Categories', href: '/vehicle-categories', icon: <Box size={18} /> },
    ],
  },
  {
    title: 'Business / Pricing',
    items: [
      { label: 'Fare & Pricing', href: '/pricing', icon: <DollarSign size={18} /> },
      { label: 'Surcharges', href: '/surcharges', icon: <Activity size={18} /> },
      { label: 'Commission', href: '/commission', icon: <Percent size={18} /> },
      { label: 'Cancellation Rules', href: '/cancellation-rules', icon: <ShieldAlert size={18} /> },
    ],
  },
  {
    title: 'Operations',

    items: [
      { label: 'Bookings', href: '/bookings', icon: <ClipboardList size={18} /> },
      { label: 'Live Trips', href: '/live-trips', icon: <MapPin size={18} /> },
    ],
  },
  {
    title: 'Business',
    items: [
      { label: 'Pricing', href: '/pricing', icon: <DollarSign size={18} />, disabled: true },
      { label: 'Wallet & Commission', href: '/wallet', icon: <Wallet size={18} />, disabled: true },
      { label: 'Payments', href: '/payments', icon: <CreditCard size={18} />, disabled: true },
      { label: 'Subscriptions', href: '/subscriptions', icon: <BadgeCheck size={18} />, disabled: true },
      { label: 'Cancellations', href: '/cancellations', icon: <XCircle size={18} />, disabled: true },
      { label: 'Service Area', href: '/service-area', icon: <Globe size={18} />, disabled: true },
    ],
  },
  {
    title: 'Reports',
    items: [
      { label: 'Reports', href: '/reports', icon: <FileText size={18} /> },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Driver Instructions', href: '/driver-instructions', icon: <MessageSquare size={18} /> },
      { label: 'Audit Logs', href: '/audit-logs', icon: <ScrollText size={18} /> },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className={styles.mobileOverlay}
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          styles.sidebar,
          collapsed && styles['sidebar--collapsed'],
          mobileOpen && styles['sidebar--mobileOpen']
        )}
        aria-label="Main navigation"
      >
        {/* Logo */}
        <div className={styles.logoArea}>
          <div className={styles.logoMark}>
            <Package size={20} />
          </div>
          {!collapsed && (
            <div className={styles.logoText}>
              <span className={styles.logoName}>Pick Up</span>
              <span className={styles.logoSub}>Admin Panel</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className={styles.nav} aria-label="Sidebar navigation">
          {NAV_SECTIONS.map((section, si) => (
            <div key={si} className={styles.section}>
              {section.title && !collapsed && (
                <span className={styles.sectionTitle}>{section.title.toUpperCase()}</span>
              )}
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.disabled ? '#' : item.href}
                    aria-current={active ? 'page' : undefined}
                    aria-disabled={item.disabled}
                    title={collapsed ? item.label : undefined}
                    onClick={item.disabled ? (e) => e.preventDefault() : onMobileClose}
                    className={clsx(
                      styles.navItem,
                      active && styles['navItem--active'],
                      item.disabled && styles['navItem--disabled']
                    )}
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    {!collapsed && (
                      <span className={styles.navLabel}>{item.label}</span>
                    )}
                    {!collapsed && item.disabled && (
                      <span className={styles.comingSoon}>Soon</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <button
          className={styles.collapseBtn}
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </aside>
    </>
  );
}
