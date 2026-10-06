import { parseProvisionArgs, ProvisionUsageError } from './provision-args';

const FEE_RULE = ['create-fee-rule', '--type', 'PERCENTAGE', '--value', '10'];

describe('parseProvisionArgs', () => {
  it('parses create-driver with --approve and the KYC legal name', () => {
    expect(
      parseProvisionArgs([
        'create-driver',
        '--phone',
        '+919876543210',
        '--subject',
        'uid_123',
        '--approve',
        '--name',
        '  Ramesh   Kumar ',
      ]),
    ).toEqual({
      kind: 'create-driver',
      phone: '+919876543210',
      subject: 'uid_123',
      approve: true,
      legalName: 'Ramesh Kumar',
    });
  });

  it('defaults --approve to false and the legal name to none', () => {
    expect(
      parseProvisionArgs(['create-driver', '--phone', '+919876543210', '--subject', 'uid_123']),
    ).toMatchObject({ approve: false, legalName: null });
  });

  it('parses create-admin, approve-driver and set-legal-name', () => {
    expect(
      parseProvisionArgs(['create-admin', '--phone', '+919876543210', '--subject', 'uid_9']),
    ).toEqual({
      kind: 'create-admin',
      phone: '+919876543210',
      subject: 'uid_9',
    });
    expect(parseProvisionArgs(['approve-driver', '--phone', '+919876543210'])).toEqual({
      kind: 'approve-driver',
      phone: '+919876543210',
    });
    expect(
      parseProvisionArgs(['set-legal-name', '--phone', '+919876543210', '--name', "Anil D'Souza"]),
    ).toEqual({ kind: 'set-legal-name', phone: '+919876543210', legalName: "Anil D'Souza" });
  });

  it('parses create-customer and create-fee-rule, rounding HALF_UP by default', () => {
    expect(
      parseProvisionArgs(['create-customer', '--phone', '+919876543210', '--subject', 'uid_7']),
    ).toEqual({ kind: 'create-customer', phone: '+919876543210', subject: 'uid_7' });
    const expected = {
      kind: 'create-fee-rule',
      ruleType: 'PERCENTAGE',
      value: '10',
      roundingMode: 'HALF_UP',
      category: null,
      reason: 'V1 platform fee approved',
    };
    expect(parseProvisionArgs([...FEE_RULE, '--reason', 'V1 platform fee approved'])).toEqual(
      expected,
    );
    expect(
      parseProvisionArgs([
        ...FEE_RULE,
        '--rounding',
        'HALF_UP',
        '--reason',
        'V1 platform fee approved',
      ]),
    ).toEqual(expected);
  });

  it.each([
    [
      ['create-fee-rule', '--type', 'PERCENT', '--value', '10', '--reason', 'reason text'],
      /--type/,
    ],
    [
      ['create-fee-rule', '--type', 'FIXED', '--value', '1e3', '--reason', 'reason text'],
      /--value/,
    ],
    [
      [...FEE_RULE, '--rounding', 'DOWN', '--reason', 'reason text'],
      /--rounding must be one of HALF_UP/,
    ],
    [[...FEE_RULE, '--rounding', 'UP', '--reason', 'reason text'], /--rounding/],
    [[...FEE_RULE, '--reason', 'short'], /--reason/],
    [[...FEE_RULE, '--reason', 'reason text', '--category', 'truck'], /--category/],
    [['create-fee-rule', '--phone', '+919876543210'], /--phone/],
    [[...FEE_RULE, '--reason', 'reason text', '--name', 'Ramesh Kumar'], /--name/],
    [
      ['create-customer', '--phone', '+919876543210', '--subject', 'uid', '--value', '10'],
      /--value/,
    ],
  ])('rejects fee rule input %j', (argv, message) => {
    expect(() => parseProvisionArgs(argv)).toThrow(message);
  });

  it.each([
    [[], /command is required/],
    [['delete-everything'], /Unknown command/],
    [['create-driver', '--phone', '9876543210', '--subject', 'uid'], /E\.164/],
    [['create-driver', '--phone', '+919876543210'], /--subject/],
    [
      ['create-driver', '--phone', '+919876543210', '--subject', 'uid; DROP TABLE users'],
      /--subject/,
    ],
    [['create-admin', '--phone', '+919876543210', '--subject', 'uid', '--approve'], /--approve/],
    [['create-admin', '--phone', '+919876543210', '--subject', 'uid', '--name', 'Ravi'], /--name/],
    [['approve-driver', '--phone', '+919876543210', '--subject', 'uid'], /--subject/],
    [['create-driver', '--phone', '+919876543210', '--subject', 'uid', '--role', 'ADMIN'], /role/],
    [['set-legal-name', '--phone', '+919876543210'], /--name/],
    [['set-legal-name', '--phone', '+919876543210', '--name', 'R1'], /--name/],
    [['set-legal-name', '--phone', '+919876543210', '--name', '12345'], /--name/],
    [['set-legal-name', '--phone', '+919876543210', '--name', 'Ravi <script>'], /--name/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseProvisionArgs(argv)).toThrow(ProvisionUsageError);
    expect(() => parseProvisionArgs(argv)).toThrow(message);
  });
});
