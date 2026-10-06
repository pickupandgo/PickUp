import { parseArgs } from 'node:util';
import {
  FEE_RULE_TYPES,
  FEE_VALUE_PATTERN,
  type FeeRuleType,
  ROUNDING_MODES,
  type RoundingMode,
} from '../fees/fee-calculator';
import { FEE_CATEGORY_PATTERN } from '../fees/fee-rules';

export type ProvisionCommand =
  | {
      readonly kind: 'create-driver';
      readonly phone: string;
      readonly subject: string;
      readonly approve: boolean;
      /** KYC legal name, compared with the bank's registered name before payouts. */
      readonly legalName: string | null;
    }
  | { readonly kind: 'create-admin'; readonly phone: string; readonly subject: string }
  | { readonly kind: 'create-customer'; readonly phone: string; readonly subject: string }
  | { readonly kind: 'approve-driver'; readonly phone: string }
  | { readonly kind: 'set-legal-name'; readonly phone: string; readonly legalName: string }
  | {
      readonly kind: 'create-fee-rule';
      readonly ruleType: FeeRuleType;
      readonly value: string;
      readonly roundingMode: RoundingMode;
      readonly category: string | null;
      readonly reason: string;
    };

export const PROVISION_USAGE = `Usage:
  node dist/cli/provision.js create-driver   --phone <E.164> --subject <firebase-uid> [--approve]
                                             [--name "<KYC legal name>"]
  node dist/cli/provision.js create-admin    --phone <E.164> --subject <firebase-uid>
  node dist/cli/provision.js create-customer --phone <E.164> --subject <firebase-uid>
  node dist/cli/provision.js approve-driver  --phone <E.164>
  node dist/cli/provision.js set-legal-name  --phone <E.164> --name "<KYC legal name>"
  node dist/cli/provision.js create-fee-rule --type <PERCENTAGE|FIXED> --value <decimal>
                                             --reason "<text>" [--category <CODE>]
                                             [--rounding HALF_UP]

Fees always round HALF_UP to the nearest paisa; --rounding accepts only HALF_UP.

Environment:
  DATABASE_URL   Owner/migrator connection string (the API role cannot write identity tables).
  AUTH_PROVIDER  Identity provider name stored with the subject. Default: firebase.

Examples:
  node dist/cli/provision.js create-driver --phone +919876543210 --subject e7eYigIsoZRjXxi4HJqrJXGXuHk2 --approve --name "Ramesh Kumar"
  node dist/cli/provision.js create-fee-rule --type PERCENTAGE --value 10 --reason "V1 platform fee approved by Nikhil Enterprises"`;

/** Thrown for invalid input. The message is safe to print. */
export class ProvisionUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisionUsageError';
  }
}

const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/;
/** Firebase UIDs are up to 128 characters; we accept the URL-safe alphabet they use. */
const SUBJECT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

interface ParsedValues {
  phone?: string;
  subject?: string;
  approve?: boolean;
  name?: string;
  type?: string;
  value?: string;
  rounding?: string;
  reason?: string;
  category?: string;
}

const IDENTITY_FLAGS = ['phone', 'subject', 'approve', 'name'] as const;
const FEE_FLAGS = ['type', 'value', 'rounding', 'reason', 'category'] as const;
/** At least one letter; letters (any script), marks, spaces, dots, apostrophes and hyphens. */
const LEGAL_NAME_PATTERN = /^(?=.*\p{L})[\p{L}\p{M} .'-]{3,120}$/u;

export function parseProvisionArgs(argv: readonly string[]): ProvisionCommand {
  const [command, ...rest] = argv;

  let values: ParsedValues;
  try {
    ({ values } = parseArgs({
      args: [...rest],
      options: {
        phone: { type: 'string' },
        subject: { type: 'string' },
        approve: { type: 'boolean' },
        name: { type: 'string' },
        type: { type: 'string' },
        value: { type: 'string' },
        rounding: { type: 'string' },
        reason: { type: 'string' },
        category: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    // node:util errors may come from another realm (e.g. under Jest), so avoid instanceof.
    const message = (error as { message?: unknown } | null)?.message;
    throw new ProvisionUsageError(typeof message === 'string' ? message : 'Invalid arguments');
  }

  switch (command) {
    case 'create-driver':
      rejectFlags(values, FEE_FLAGS, command);
      return {
        kind: command,
        phone: requirePhone(values.phone),
        subject: requireSubject(values.subject),
        approve: values.approve ?? false,
        legalName: values.name === undefined ? null : requireLegalName(values.name),
      };
    case 'create-admin':
    case 'create-customer':
      rejectFlags(values, ['approve', 'name', ...FEE_FLAGS], command);
      return {
        kind: command,
        phone: requirePhone(values.phone),
        subject: requireSubject(values.subject),
      };
    case 'approve-driver':
      rejectFlags(values, ['approve', 'subject', 'name', ...FEE_FLAGS], command);
      return { kind: command, phone: requirePhone(values.phone) };
    case 'set-legal-name':
      rejectFlags(values, ['approve', 'subject', ...FEE_FLAGS], command);
      return {
        kind: command,
        phone: requirePhone(values.phone),
        legalName: requireLegalName(values.name),
      };
    case 'create-fee-rule':
      rejectFlags(values, IDENTITY_FLAGS, command);
      return {
        kind: command,
        ruleType: requireOneOf(values.type, FEE_RULE_TYPES, '--type'),
        value: requireFeeValue(values.value),
        roundingMode: requireOneOf(values.rounding ?? 'HALF_UP', ROUNDING_MODES, '--rounding'),
        category: optionalCategory(values.category),
        reason: requireReason(values.reason),
      };
    default:
      throw new ProvisionUsageError(
        command ? `Unknown command: ${command}` : 'A command is required',
      );
  }
}

function requirePhone(phone: string | undefined): string {
  if (!phone || !PHONE_PATTERN.test(phone)) {
    throw new ProvisionUsageError('--phone must be in E.164 format, e.g. +919876543210');
  }
  return phone;
}

function requireSubject(subject: string | undefined): string {
  if (!subject || !SUBJECT_PATTERN.test(subject)) {
    throw new ProvisionUsageError(
      '--subject must be the Firebase UID (letters, digits, "-" or "_")',
    );
  }
  return subject;
}

function requireOneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flag: string,
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (!match) {
    throw new ProvisionUsageError(`${flag} must be one of ${allowed.join(', ')}`);
  }
  return match;
}

function requireLegalName(name: string | undefined): string {
  const normalized = name?.normalize('NFC').trim().replace(/\s+/g, ' ') ?? '';
  if (!LEGAL_NAME_PATTERN.test(normalized)) {
    throw new ProvisionUsageError(
      '--name must be the KYC legal name: 3-120 letters, spaces, dots, apostrophes or hyphens',
    );
  }
  return normalized;
}

function requireFeeValue(value: string | undefined): string {
  if (!value || !FEE_VALUE_PATTERN.test(value)) {
    throw new ProvisionUsageError('--value must be a decimal with at most 4 decimals, e.g. 10');
  }
  return value;
}

function optionalCategory(category: string | undefined): string | null {
  if (category === undefined) {
    return null;
  }
  if (!FEE_CATEGORY_PATTERN.test(category)) {
    throw new ProvisionUsageError('--category must be an upper-case code such as MINI_TRUCK');
  }
  return category;
}

function requireReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? '';
  if (trimmed.length < 10 || trimmed.length > 500) {
    throw new ProvisionUsageError('--reason must be 10-500 characters');
  }
  return trimmed;
}

function rejectFlags(
  values: ParsedValues,
  flags: readonly (keyof ParsedValues)[],
  command: string,
): void {
  for (const flag of flags) {
    if (values[flag] !== undefined) {
      throw new ProvisionUsageError(`--${flag} is not used by ${command}`);
    }
  }
}
