import React from 'react';
import ProfileDetailsForm, { type ProfileDetailsProps } from './ProfileDetailsForm';
export default function EditProfileScreen(props: Omit<ProfileDetailsProps, 'editing'>) {
  return <ProfileDetailsForm {...props} editing />;
}

