const fs = require('node:fs'),
  cp = require('node:child_process');
if (process.env.MR_DISPOSABLE_QA !== 'true')
  throw Error('An explicitly disposable QA database is required');
const url = new URL(process.env.TEST_DATABASE_URL || '');
if (
  url.pathname !== '/mr_phase2_test' ||
  !['127.0.0.1', 'multipleride-qa-db'].includes(url.hostname)
)
  throw Error('QA target allowlist refused');
const files = fs
  .readdirSync('/app/test/integration')
  .filter((f) => f.endsWith('.int-spec.ts'))
  .sort();
const summary = [];
for (const file of files) {
  const name = file.replace('.int-spec.ts', '');
  const p = cp.spawnSync(
    process.execPath,
    [
      'node_modules/jest/bin/jest.js',
      '--config',
      'test/jest-integration.json',
      '--runInBand',
      '--runTestsByPath',
      'test/integration/' + file,
      '--json',
      '--outputFile=/tmp/' + name + '.json',
    ],
    {
      cwd: '/app',
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 240000,
    },
  );
  fs.writeFileSync('/tmp/' + name + '.log', (p.stdout || '') + (p.stderr || ''));
  let result;
  try {
    result = JSON.parse(fs.readFileSync('/tmp/' + name + '.json'));
  } catch {}
  const row = {
    suite: name,
    exit_code: p.status,
    passed: result?.numPassedTests ?? 0,
    failed: result?.numFailedTests ?? 0,
    total: result?.numTotalTests ?? 0,
    success: result?.success === true,
    failures: result?.testResults?.flatMap((s) =>
      s.assertionResults
        .filter((t) => t.status === 'failed')
        .map((t) => ({
          name: t.fullName,
          message: t.failureMessages
            .map((m) => m.replace(/\u001b\[[0-9;]*m/g, ''))
            .join('\n')
            .slice(0, 1000),
        })),
    ) ?? [{ name: 'runner failure', message: (p.stderr || '').slice(-1200) }],
  };
  summary.push(row);
  fs.writeFileSync('/tmp/integration-batched-summary.json', JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify({
      suite: name,
      passed: row.passed,
      failed: row.failed,
      success: row.success,
    }),
  );
}
process.exitCode = summary.every((s) => s.success) ? 0 : 1;
