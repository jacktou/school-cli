'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const bin = path.join(root, 'bin', 'school.js');
const fixturesSkills = path.join(root, 'fixtures', 'skills.json');
const tmpConfig = path.join(
  os.tmpdir(),
  `school-cli-smoke-${process.pid}-${Date.now()}.json`
);

process.env.SCHOOL_CLI_CONFIG = tmpConfig;
process.env.SCHOOL_SKILLS_PATH = fixturesSkills;
// Keep smoke offline: do not rely on network for paper path
delete process.env.PRIVY_TOKEN;
delete process.env.SCHOOL_JWT;

let failed = 0;

function run(label, args, check) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: process.env,
    cwd: root,
  });
  const ok = check(r);
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}`);
    console.log(`  exit=${r.status} signal=${r.signal}`);
    if (r.stdout) console.log(`  stdout: ${r.stdout.slice(0, 500)}`);
    if (r.stderr) console.log(`  stderr: ${r.stderr.slice(0, 500)}`);
  }
  return r;
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

console.log(`smoke: config=${tmpConfig}`);
console.log(`smoke: skills=${fixturesSkills}`);

run('--help', ['--help'], (r) => r.status === 0 && /school —/.test(r.stdout));

run('status (before login)', ['status'], (r) => {
  if (r.status !== 0) return false;
  const j = parseJson(r.stdout);
  return j && j.mode === 'paper' && j.auth === null && j.has_jwt === false;
});

run('login --paper', ['login', '--paper'], (r) => {
  if (r.status !== 0) return false;
  const j = parseJson(r.stdout);
  return j && j.ok === true && j.address && j.mode === 'paper';
});

run('status (after login, expect address)', ['status'], (r) => {
  if (r.status !== 0) return false;
  const j = parseJson(r.stdout);
  return (
    j &&
    j.address != null &&
    String(j.address).length > 0 &&
    j.has_jwt === false &&
    j.auth === null
  );
});

run('login --privy without token (expect exit 1 + instructions)', ['login', '--privy'], (r) => {
  if (r.status !== 1) return false;
  const j = parseJson(r.stdout);
  return j && j.ok === false && j.error === 'missing_privy_token' && j.how && j.how.endpoint;
});

run('skills list', ['skills', 'list'], (r) => {
  if (r.status !== 0) return false;
  return (
    /alpha_radar/.test(r.stdout) &&
    /trade_paper/.test(r.stdout) &&
    /token_security/.test(r.stdout)
  );
});

run('skills run alpha_radar', ['skills', 'run', 'alpha_radar'], (r) => {
  if (r.status !== 0) return false;
  const j = parseJson(r.stdout);
  return j && Array.isArray(j.data);
});

run(
  'skills run trade_paper (valid input)',
  [
    'skills',
    'run',
    'trade_paper',
    '--input',
    JSON.stringify({ pair: 'SOL/USDC', side: 'buy', size: 1 }),
  ],
  (r) => {
    if (r.status !== 0) return false;
    const j = parseJson(r.stdout);
    return j && j.mode === 'paper' && j.pair === 'SOL/USDC' && j.fill_price != null;
  }
);

run(
  'skills run token_security (with ca)',
  [
    'skills',
    'run',
    'token_security',
    '--input',
    JSON.stringify({ ca: 'So11111111111111111111111111111111111111112' }),
  ],
  (r) => {
    if (r.status !== 0) return false;
    const j = parseJson(r.stdout);
    return j && j.ca && typeof j.renounced === 'boolean';
  }
);

run('skills run missing_id (expect exit 2)', ['skills', 'run', 'missing_id'], (r) => {
  return r.status === 2;
});

run('logout', ['logout'], (r) => {
  if (r.status !== 0) return false;
  const j = parseJson(r.stdout);
  return j && j.ok === true && j.cleared === true;
});

run('status (after logout, address null)', ['status'], (r) => {
  if (r.status !== 0) return false;
  const j = parseJson(r.stdout);
  return j && (j.address === null || j.address === undefined) && j.has_jwt === false;
});

try {
  fs.unlinkSync(tmpConfig);
} catch {
  /* ignore */
}

if (failed > 0) {
  console.log(`\n${failed} step(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke steps passed');
process.exit(0);
