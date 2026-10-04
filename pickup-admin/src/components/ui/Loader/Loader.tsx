'use client';

import React from 'react';
import styles from './Loader.module.css';

interface LoaderProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  fullPage?: boolean;
}

export function Loader({ size = 'md', label = 'Loading...', fullPage = false }: LoaderProps) {
  const spinner = (
    <div className={styles.container} role="status" aria-label={label}>
      <div className={`${styles.spinner} ${styles[`spinner--${size}`]}`} />
      {label && <span className={styles.label}>{label}</span>}
    </div>
  );

  if (fullPage) {
    return <div className={styles.fullPage}>{spinner}</div>;
  }

  return spinner;
}
