'use client';

import React from 'react';
import { Skeleton } from '@/components/ui/Skeleton/Skeleton';
import styles from './PageSkeleton.module.css';

interface PageSkeletonProps {
  /** Number of skeleton table rows to show */
  rows?: number;
  /** Show summary/KPI cards at top */
  showCards?: boolean;
  /** Show toolbar/filter bar */
  showToolbar?: boolean;
}

export function PageSkeleton({ rows = 8, showCards = false, showToolbar = true }: PageSkeletonProps) {
  return (
    <div className={styles.wrapper}>
      {/* Page Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Skeleton width={200} height={26} borderRadius="6px" />
          <Skeleton width={280} height={14} borderRadius="4px" />
        </div>
        <Skeleton width={120} height={36} borderRadius="8px" />
      </div>

      {/* Summary Cards */}
      {showCards && (
        <div className={styles.cards}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={styles.card}>
              <Skeleton width={48} height={48} borderRadius="12px" />
              <div className={styles.cardBody}>
                <Skeleton width="60%" height={12} borderRadius="4px" />
                <Skeleton width="40%" height={22} borderRadius="4px" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      {showToolbar && (
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <Skeleton width={240} height={36} borderRadius="8px" />
            <Skeleton width={140} height={36} borderRadius="8px" />
            <Skeleton width={120} height={36} borderRadius="8px" />
          </div>
          <Skeleton width={100} height={36} borderRadius="8px" />
        </div>
      )}

      {/* Table */}
      <div className={styles.tableCard}>
        {/* Table Header */}
        <div className={styles.tableHead}>
          {[20, 12, 10, 14, 10, 10, 10].map((w, i) => (
            <Skeleton key={i} width={`${w}%`} height={12} borderRadius="4px" />
          ))}
        </div>

        {/* Table Rows */}
        <div className={styles.tableBody}>
          {Array.from({ length: rows }, (_, rowIdx) => (
            <div key={rowIdx} className={styles.tableRow}>
              {/* Avatar + text column */}
              <div className={styles.cellWithAvatar}>
                <Skeleton width={36} height={36} borderRadius="50%" />
                <div className={styles.cellText}>
                  <Skeleton width="70%" height={13} borderRadius="4px" />
                  <Skeleton width="50%" height={11} borderRadius="4px" />
                </div>
              </div>
              <Skeleton width="12%" height={13} borderRadius="4px" />
              <Skeleton width="10%" height={24} borderRadius="20px" />
              <Skeleton width="14%" height={13} borderRadius="4px" />
              <Skeleton width="10%" height={13} borderRadius="4px" />
              <Skeleton width="10%" height={13} borderRadius="4px" />
              <div style={{ display: 'flex', gap: 8 }}>
                <Skeleton width={64} height={30} borderRadius="6px" />
                <Skeleton width={64} height={30} borderRadius="6px" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
