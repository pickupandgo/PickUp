import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { KeyboardTypeOptions } from 'react-native';
import Icon from '../../components/atoms/Icon';
import type {
  OnboardingDocument,
  UploadProgress,
} from '../../services/onboarding/DriverOnboardingService';
import {
  documentState,
  label,
} from '../../services/onboarding/onboardingPresentation';

export const palette = {
  ink: '#102C50',
  muted: '#64748B',
  line: '#E2E4EB',
  red: '#CE122B',
  green: '#257A42',
  amber: '#A46709',
};
export function Action({
  title,
  onPress,
  disabled,
  busy,
  secondary,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[
        s.action,
        secondary && s.secondary,
        (disabled || busy) && s.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? palette.ink : '#FFFFFF'} />
      ) : (
        <Text style={[s.actionText, secondary && s.secondaryText]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}
export function Field({
  title,
  value,
  onChange,
  error,
  keyboardType,
  editable = true,
  secureTextEntry,
  multiline,
  maxLength = 120,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  editable?: boolean;
  secureTextEntry?: boolean;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <View style={s.field}>
      <Text style={s.fieldTitle}>{title}</Text>
      <TextInput
        accessibilityLabel={title}
        value={value}
        onChangeText={onChange}
        editable={editable}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'}
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        maxLength={maxLength}
        style={[
          s.input,
          multiline && s.multiline,
          !editable && s.readonly,
          !!error && s.inputError,
        ]}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={s.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
export function Badge({ status }: { status: string }) {
  const bad = [
    'REJECTED',
    'NEEDS_CORRECTION',
    'SCAN_FAILED',
    'SUSPENDED',
  ].includes(status);
  const good = ['VERIFIED', 'APPROVED'].includes(status);
  const pending = [
    'SCANNING',
    'PENDING_REVIEW',
    'IN_REVIEW',
    'SUBMITTED',
    'UNDER_REVIEW',
    'UPLOADING',
  ].includes(status);
  const color = bad
    ? palette.red
    : good
    ? palette.green
    : pending
    ? palette.amber
    : palette.muted;
  return (
    <View
      style={[
        s.badge,
        {
          backgroundColor: bad
            ? '#FDE4E6'
            : good
            ? '#E6F4E9'
            : pending
            ? '#FFF0D6'
            : '#ECEEF2',
        },
      ]}
    >
      <Text style={[s.badgeText, { color }]}>
        {label(status).toUpperCase()}
      </Text>
    </View>
  );
}
export function Notice({
  title,
  children,
  danger,
}: React.PropsWithChildren<{ title: string; danger?: boolean }>) {
  return (
    <View style={[s.notice, danger && s.danger]}>
      <View style={s.row}>
        <Icon
          name="info_outline"
          size={21}
          color={danger ? palette.red : palette.ink}
        />
        <Text style={[s.noticeTitle, danger && s.error]}>{title}</Text>
      </View>
      <Text style={s.body}>{children}</Text>
    </View>
  );
}
export function DocumentCard({
  type,
  document,
  progress,
  editable,
  onUpload,
  onPreview,
  onConfirm,
}: {
  type: string;
  document?: OnboardingDocument;
  progress?: UploadProgress;
  editable: boolean;
  onUpload: () => void;
  onPreview: () => void;
  onConfirm?: () => void;
}) {
  const state = progress ? 'UPLOADING' : documentState(document);
  const rejected = ['REJECTED', 'SCAN_FAILED'].includes(state);
  const previewable =
    document?.scannedAt &&
    ['QUARANTINED', 'VERIFIED'].includes(document.status);
  return (
    <View style={[s.document, rejected && s.documentRejected]}>
      <View style={s.row}>
        <View style={s.documentIcon}>
          <Icon
            name={
              /PHOTO|PORTRAIT|PLATE/.test(type) ? 'photo_camera' : 'description'
            }
            size={22}
            color={palette.ink}
          />
        </View>
        <View style={s.grow}>
          <Text style={s.documentTitle}>{label(type)}</Text>
          <Text style={s.caption}>Required evidence</Text>
        </View>
        <Badge status={state} />
      </View>
      {document?.rejectionReason ? (
        <View style={s.reason}>
          <Text style={s.error}>Reason for correction</Text>
          <Text style={s.body}>{document.rejectionReason}</Text>
        </View>
      ) : null}
      {progress ? (
        <View
          accessibilityRole="progressbar"
          accessibilityValue={
            progress.percent === null
              ? undefined
              : { min: 0, max: 100, now: progress.percent }
          }
        >
          <Text style={s.caption}>
            {progress.phase === 'CONFIRMING'
              ? 'Confirming secure upload…'
              : progress.phase === 'PREPARING'
              ? 'Preparing document…'
              : `Uploading${
                  progress.percent === null ? '…' : ` ${progress.percent}%`
                }`}
          </Text>
          {progress.percent !== null ? (
            <View style={s.track}>
              <View style={[s.fill, { width: `${progress.percent}%` }]} />
            </View>
          ) : (
            <ActivityIndicator color={palette.amber} />
          )}
        </View>
      ) : state === 'SCANNING' ? (
        <Text style={s.pending}>Uploaded securely. Malware scan pending.</Text>
      ) : state === 'PENDING_REVIEW' ? (
        <Text style={s.pending}>
          Security scan complete. Awaiting human review.
        </Text>
      ) : null}
      {document?.reviewedAt ? (
        <Text style={s.caption}>
          Reviewed {new Date(document.reviewedAt).toLocaleDateString()}
        </Text>
      ) : null}
      {previewable ? (
        <Action
          title={`Preview ${label(type)}`}
          secondary
          onPress={onPreview}
        />
      ) : null}
      {!progress && onConfirm && ['UPLOADING', 'SCANNING'].includes(state) ? (
        <Action
          title={`Retry confirmation for ${label(type)}`}
          secondary
          onPress={onConfirm}
        />
      ) : null}
      {editable && !progress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${document ? 'Replace' : 'Upload'} ${label(
            type,
          )}`}
          onPress={onUpload}
          style={s.upload}
        >
          <Icon
            name={rejected ? 'refresh' : 'add_a_photo'}
            color={palette.ink}
            size={26}
          />
          <Text style={s.uploadText}>
            {rejected
              ? 'RETAKE / RESUBMIT'
              : document
              ? 'REPLACE DOCUMENT'
              : 'Tap to capture or upload'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  action: {
    backgroundColor: '#050505',
    minHeight: 50,
    borderRadius: 28,
    padding: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 5,
  },
  actionText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
    textAlign: 'center',
  },
  secondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: palette.line,
  },
  secondaryText: { color: palette.ink },
  disabled: { opacity: 0.4 },
  field: { gap: 7, marginBottom: 15 },
  fieldTitle: { color: palette.ink, fontSize: 12, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#D3D8E2',
    borderRadius: 7,
    paddingHorizontal: 13,
    minHeight: 48,
    color: palette.ink,
    backgroundColor: '#FFFFFF',
  },
  multiline: { minHeight: 86, textAlignVertical: 'top' },
  readonly: { backgroundColor: '#F1F3F6' },
  inputError: { borderColor: palette.red },
  error: { color: palette.red, fontSize: 12 },
  badge: {
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 4,
    maxWidth: 120,
  },
  badgeText: { fontSize: 8, fontWeight: '700' },
  notice: {
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#D5E1EF',
    backgroundColor: '#EDF3FA',
    padding: 14,
    gap: 8,
    marginBottom: 18,
  },
  danger: { backgroundColor: '#FFF0F2', borderColor: '#F3C8CE' },
  noticeTitle: { fontSize: 15, color: palette.ink, fontWeight: '700', flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1 },
  body: { fontSize: 12, lineHeight: 18, color: palette.ink },
  document: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 13,
    padding: 14,
    gap: 13,
    backgroundColor: '#FFFFFF',
    marginBottom: 13,
  },
  documentRejected: { borderColor: '#F1B5BD', backgroundColor: '#FFFDFD' },
  documentIcon: {
    width: 35,
    height: 35,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F2F6',
    borderRadius: 9,
  },
  documentTitle: { color: palette.ink, fontSize: 13, fontWeight: '600' },
  caption: { color: palette.muted, fontSize: 10, marginTop: 4 },
  reason: {
    borderColor: '#F3C8CE',
    borderWidth: 1,
    borderRadius: 7,
    padding: 11,
    backgroundColor: '#FFF5F6',
    gap: 6,
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E8E2ED',
    marginTop: 9,
  },
  fill: { height: 4, borderRadius: 2, backgroundColor: '#E0A63C' },
  pending: { color: palette.amber, fontSize: 11, lineHeight: 17 },
  upload: {
    minHeight: 85,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D4D9E4',
    backgroundColor: '#F7F8FC',
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  uploadText: {
    color: palette.ink,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
});
