'use strict';
// Offline ops module from the EXACT Backend image, only a NEW disposable DB.
const a = require('node:assert/strict');
const { createRequire } = require('node:module');
const r = createRequire('/app/package.json');
const { PrismaClient } = r('/app/dist/generated/prisma/client.js');
const { PrismaPg } = r('@prisma/adapter-pg');
const { runProvisionCommand } = r('/app/dist/cli/provision-commands.js');
const { parseProvisionArgs } = r('/app/dist/cli/provision-args.js');
(async () => {
  const u = new URL(process.env.DATABASE_URL);
  a.equal(u.hostname, '172.29.63.2');
  a.equal(u.pathname, '/mr_joint_backend_e2e');
  a.equal(u.username, 'ci_owner');
  a.equal(process.env.NODE_ENV, 'test');
  a.equal(process.env.CONTRACT_E2E_FIXTURE, 'true');
  const p = new PrismaClient({
    adapter: new PrismaPg({ connectionString: u.href, max: 1 }),
  });
  try {
    a.equal(await p.user.count(), 0);
    const cmds = [
      [
        'create-admin',
        '--phone',
        '+15555550100',
        '--subject',
        'ci_admin',
        '--reason',
        'Synthetic isolated joint CI admin only',
      ],
      [
        'create-customer',
        '--phone',
        '+15555550101',
        '--subject',
        'ci_customer',
      ],
      [
        'create-customer',
        '--phone',
        '+15555550102',
        '--subject',
        'ci_other_customer',
      ],
      [
        'create-contract-eligible-driver',
        '--phone',
        '+15555550103',
        '--subject',
        'ci_driver',
        '--name',
        'Synthetic Driver',
      ],
      [
        'create-driver',
        '--phone',
        '+15555550104',
        '--subject',
        'ci_pending_driver',
        '--name',
        'Synthetic Pending',
      ],
      [
        'create-fee-rule',
        '--type',
        'PERCENTAGE',
        '--value',
        '10',
        '--reason',
        'Synthetic isolated joint CI fee only',
      ],
      [
        'create-pricing-version',
        '--code',
        'PROTOTYPE-JOINT-CI',
        '--file',
        '/fixtures/pricing.json',
        '--reason',
        'Synthetic CI prototype; never production rates',
      ],
    ];
    for (const cmd of cmds)
      await runProvisionCommand(p, 'firebase', parseProvisionArgs(cmd));
    console.log(
      JSON.stringify({
        result: 'PASS',
        synthetic_users: 5,
        eligible_drivers: 1,
        pending_drivers: 1,
        pricing_and_fee_fixtures: true,
        object_storage_contacted: false,
        financial_provider_contacted: false,
      }),
    );
  } finally {
    await p.$disconnect();
  }
})().catch((e) => {
  console.error('SYNTHETIC_SEED_FAILED ' + (e?.code || e?.name || 'UNKNOWN'));
  process.exitCode = 1;
});
