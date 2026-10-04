'use client';

import React from 'react';
import { clsx } from 'clsx';
import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  className?: string;
}

export function Skeleton({ width, height = 16, borderRadius, className }: SkeletonProps) {
  return (
    <span
      className={clsx(styles.skeleton, className)}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        borderRadius,
      }}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={clsx(styles.textGroup, className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? '60%' : '100%'}
          height={14}
          borderRadius="4px"
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={clsx(styles.card, className)}>
      <Skeleton width={40} height={40} borderRadius="8px" />
      <div className={styles.cardContent}>
        <Skeleton width="60%" height={14} borderRadius="4px" />
        <Skeleton width="40%" height={12} borderRadius="4px" />
      </div>
    </div>
  );
}
