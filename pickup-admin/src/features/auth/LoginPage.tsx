'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Package, Mail, Lock, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button/Button';
import { Input } from '@/components/ui/Input/Input';
import { PasswordInput } from '@/components/ui/Input/PasswordInput';
import styles from './LoginPage.module.css';

interface FormValues {
  email: string;
  password: string;
}

interface FormErrors {
  email?: string;
  password?: string;
}

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.email.trim()) {
    errors.email = 'Email address is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (!values.password) {
    errors.password = 'Password is required.';
  } else if (values.password.length < 6) {
    errors.password = 'Password must be at least 6 characters.';
  }
  return errors;
}

export default function LoginPage() {
  const { login, isAuthenticated, isLoading, error, clearError } = useAuth();
  const router = useRouter();

  const [values, setValues] = useState<FormValues>({ email: '', password: '' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState({ email: false, password: false });
  const [submitting, setSubmitting] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, router]);

  // Clear server error when user edits fields
  useEffect(() => {
    if (error) clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const handleChange = (field: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
  };

  const handleBlur = (field: keyof FormValues) => () => {
    setTouched((t) => ({ ...t, [field]: true }));
    const fieldErrors = validate({ ...values });
    setErrors((prev) => ({ ...prev, [field]: fieldErrors[field] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate all fields
    const allErrors = validate(values);
    setErrors(allErrors);
    setTouched({ email: true, password: true });

    if (Object.keys(allErrors).length > 0) return;

    setSubmitting(true);
    const success = await login(values);
    setSubmitting(false);

    if (success) {
      router.push('/dashboard');
    }
  };

  if (isLoading && !submitting) {
    // During initial session check, show nothing (handled by AuthProvider)
    return null;
  }

  return (
    <div className={styles.page}>
      {/* Left decorative panel */}
      <div className={styles.brandPanel} aria-hidden="true">
        <div className={styles.brandContent}>
          <div className={styles.brandLogo}>
            <Package size={32} />
          </div>
          <h2 className={styles.brandTitle}>Pick Up</h2>
          <p className={styles.brandSubtitle}>
            Logistics Management Platform
          </p>
          <div className={styles.brandStats}>
            <div className={styles.statItem}>
              <span className={styles.statValue}>Jodhpur</span>
              <span className={styles.statLabel}>Operating City</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statItem}>
              <span className={styles.statValue}>6+</span>
              <span className={styles.statLabel}>Vehicle Types</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.statItem}>
              <span className={styles.statValue}>24/7</span>
              <span className={styles.statLabel}>Operations</span>
            </div>
          </div>
          <div className={styles.brandDecoration}>
            <div className={styles.circle1} />
            <div className={styles.circle2} />
          </div>
        </div>
      </div>

      {/* Login Form Panel */}
      <div className={styles.formPanel}>
        <div className={styles.formWrap}>
          {/* Mobile logo */}
          <div className={styles.mobileLogo} aria-hidden="true">
            <div className={styles.mobileLogoMark}>
              <Package size={22} />
            </div>
            <span className={styles.mobileLogoText}>Pick Up</span>
          </div>

          {/* Heading */}
          <div className={styles.heading}>
            <h1 className={styles.title}>Admin Sign In</h1>
            <p className={styles.subtitle}>
              Sign in to access the Pick Up operations dashboard.
            </p>
          </div>

          {/* Server error */}
          {error && (
            <div className={styles.serverError} role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form
            className={styles.form}
            onSubmit={handleSubmit}
            noValidate
            aria-label="Admin login form"
          >
            <Input
              id="login-email"
              label="Email Address"
              type="email"
              placeholder="admin@pickupjodhpur.in"
              autoComplete="email"
              value={values.email}
              onChange={handleChange('email')}
              onBlur={handleBlur('email')}
              error={touched.email ? errors.email : undefined}
              leftIcon={<Mail size={15} />}
              required
              disabled={submitting}
            />

            <PasswordInput
              id="login-password"
              label="Password"
              placeholder="Enter your password"
              autoComplete="current-password"
              value={values.password}
              onChange={handleChange('password')}
              onBlur={handleBlur('password')}
              error={touched.password ? errors.password : undefined}
              required
              disabled={submitting}
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              isLoading={submitting}
              id="login-submit-button"
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          {/* Demo credentials hint */}
          <div className={styles.demoHint}>
            <p className={styles.demoLabel}>Demo credentials</p>
            <p className={styles.demoCredential}>
              <strong>Email:</strong> admin@pickupjodhpur.in
            </p>
            <p className={styles.demoCredential}>
              <strong>Password:</strong> Admin@123
            </p>
          </div>

          <p className={styles.footerNote}>
            Pick Up Admin Panel · Jodhpur, Rajasthan
          </p>
        </div>
      </div>
    </div>
  );
}
