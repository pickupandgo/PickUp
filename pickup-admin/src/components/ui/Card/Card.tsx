'use client';

import React from 'react';
import { clsx } from 'clsx';
import styles from './Card.module.css';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  bordered?: boolean;
}

export function Card({ children, className, padding = 'md', bordered = true }: CardProps) {
  return (
    <div
      className={clsx(
        styles.card,
        styles[`card--${padding}`],
        bordered && styles['card--bordered'],
        className
      )}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, description, action, icon, className }: CardHeaderProps) {
  return (
    <div className={clsx(styles.header, className)}>
      <div className={styles.headerText} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {icon && <div style={{ color: 'var(--color-text-secondary)', display: 'flex' }}>{icon}</div>}
        <div>
          <h3 className={styles.title}>{title}</h3>
          {description && <p className={styles.description}>{description}</p>}
        </div>
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}


export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx(styles.body, className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx(styles.footer, className)}>{children}</div>;
}
