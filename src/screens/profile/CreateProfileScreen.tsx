import React from 'react';
import ProfileDetailsForm, { type ProfileDetailsProps } from './ProfileDetailsForm';
export default function CreateProfileScreen(props: Omit<ProfileDetailsProps, 'editing'>) {
  return <ProfileDetailsForm {...props} />;
}

