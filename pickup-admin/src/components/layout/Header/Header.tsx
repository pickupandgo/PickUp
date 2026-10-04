'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Menu, ChevronDown, LogOut, User, Settings, Bell } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import styles from './Header.module.css';

interface HeaderProps {
  pageTitle?: string;
  onMobileMenuToggle: () => void;
}

export function Header({ pageTitle = 'Dashboard', onMobileMenuToggle }: HeaderProps) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setDropdownOpen(false);
    await logout();
    router.push('/login');
  };

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : 'AD';

  const roleLabel: Record<string, string> = {
    owner: 'Owner',
    admin: 'Administrator',
    supervisor: 'Supervisor',
  };

  return (
    <header className={styles.header} role="banner">
      {/* Left */}
      <div className={styles.left}>
        <button
          className={styles.mobileMenuBtn}
          onClick={onMobileMenuToggle}
          aria-label="Open navigation menu"
          id="mobile-menu-button"
        >
          <Menu size={20} />
        </button>
        <div className={styles.pageTitle}>
          <h1 className={styles.pageTitleText}>{pageTitle}</h1>
        </div>
      </div>

      {/* Right */}
      <div className={styles.right}>
        {/* Notification bell (placeholder for future milestone) */}
        <button
          className={styles.iconBtn}
          aria-label="Notifications"
          title="Notifications (coming soon)"
          disabled
        >
          <Bell size={18} />
        </button>

        {/* Profile dropdown */}
        <div className={styles.profileWrap} ref={dropdownRef}>
          <button
            className={styles.profileBtn}
            onClick={() => setDropdownOpen((v) => !v)}
            aria-expanded={dropdownOpen}
            aria-haspopup="menu"
            aria-label="Admin profile menu"
            id="profile-menu-button"
          >
            <div className={styles.avatar} aria-hidden="true">{initials}</div>
            <div className={styles.profileInfo}>
              <span className={styles.profileName}>{user?.name ?? 'Admin'}</span>
              <span className={styles.profileRole}>
                {user?.role ? roleLabel[user.role] ?? user.role : ''}
              </span>
            </div>
            <ChevronDown
              size={14}
              className={`${styles.chevron} ${dropdownOpen ? styles['chevron--open'] : ''}`}
              aria-hidden="true"
            />
          </button>

          {/* Dropdown Menu */}
          {dropdownOpen && (
            <div
              className={styles.dropdown}
              role="menu"
              aria-labelledby="profile-menu-button"
            >
              <div className={styles.dropdownHeader}>
                <div className={styles.avatarLg} aria-hidden="true">{initials}</div>
                <div>
                  <p className={styles.dropdownName}>{user?.name}</p>
                  <p className={styles.dropdownEmail}>{user?.email}</p>
                </div>
              </div>
              <div className={styles.dropdownDivider} />
              <button
                className={styles.dropdownItem}
                role="menuitem"
                disabled
                title="Coming soon"
              >
                <User size={15} aria-hidden="true" />
                Profile Settings
              </button>
              <button
                className={styles.dropdownItem}
                role="menuitem"
                disabled
                title="Coming soon"
              >
                <Settings size={15} aria-hidden="true" />
                System Settings
              </button>
              <div className={styles.dropdownDivider} />
              <button
                className={`${styles.dropdownItem} ${styles['dropdownItem--danger']}`}
                role="menuitem"
                onClick={handleLogout}
                id="logout-button"
              >
                <LogOut size={15} aria-hidden="true" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
