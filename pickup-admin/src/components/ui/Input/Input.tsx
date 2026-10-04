'use client';

import React, { forwardRef } from 'react';
import { clsx } from 'clsx';
import styles from './Input.module.css';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightElement?: React.ReactNode;
  fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, leftIcon, rightElement, fullWidth = true, className, id, ...props },
  ref
) {
  const inputId = id ?? `input-${Math.random().toString(36).slice(2)}`;

  return (
    <div className={clsx(styles.wrapper, fullWidth && styles['wrapper--full'])}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
          {props.required && <span className={styles.required} aria-hidden="true"> *</span>}
        </label>
      )}
      <div className={clsx(styles.inputWrap, error && styles['inputWrap--error'])}>
        {leftIcon && <span className={styles.leftIcon} aria-hidden="true">{leftIcon}</span>}
        <input
          ref={ref}
          id={inputId}
          className={clsx(
            styles.input,
            leftIcon && styles['input--hasLeft'],
            rightElement && styles['input--hasRight'],
            className
          )}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
          {...props}
        />
        {rightElement && <span className={styles.rightElement}>{rightElement}</span>}
      </div>
      {error && (
        <p id={`${inputId}-error`} className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${inputId}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
});
