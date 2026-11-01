import type { CustomerProfileData } from './session';

export const profileIssues = (profile: CustomerProfileData) => ({
  fullName: !profile.fullName.trim() ? 'Enter your full name.'
    : profile.fullName.trim().length > 120 ? 'Use 120 characters or fewer.' : '',
  email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim()) || profile.email.trim().endsWith('.')
    || profile.email.trim().length > 255 ? 'Enter a valid email address.' : '',
  age: !/^\d{1,3}$/.test(profile.age?.trim() ?? '') || Number(profile.age) < 1 || Number(profile.age) > 120
    ? 'Enter your age, from 1 to 120.' : '',
  address: !profile.address?.trim() ? 'Enter your location or address.'
    : profile.address.trim().length > 500 ? 'Use 500 characters or fewer.' : '',
});

export const hasRequiredProfile = (profile: CustomerProfileData): boolean =>
  Object.values(profileIssues(profile)).every(issue => !issue);

