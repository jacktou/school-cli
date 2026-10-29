'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const bin = path.join(root, 'bin', 'school.js');
const fixturesSkills = path.join(root, 'fixtures', 'skills.json');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-cli-smoke-'));
const tmpConfig = path.join(tmpDir, 'config.json');

process.env.SCHOOL_CLI_CONFIG = tmpConfig;
process.env.SCHOOL_SKILLS_PATH = fixturesSkills;
process.env.SCHOOL_LOGIN_NO_OPEN = '1';
delete process.env.PRIVY_TOKEN;
delete process.env.SCHOOL_JWT;
delete process.env.SCHOOL_LOGIN_DRY_RUN;

let failed = 0;
const cleanups = [];

function run(label, args, check, envExtra = {}) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...envExtra },
    cwd: root,
  });
  const ok = check(r);
  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}`);
    console.log(`  exit=${r.status} signal=${r.signal}`);
    if (r.stdout) console.log(`  stdout: ${r.stdout.slice(0, 800)}`);
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

/** Parse first JSON object from multi-json stdout (init then done). */
function parseJsonObjects(stdout) {
  const out = [];
  const text = String(stdout || '').trim();
  if (!text) return out;
  // Try whole, then split on }\n{
  try {
    out.push(JSON.parse(text));
    return out;
  } catch {
    /* multi */
  }
  const parts = text.split(/\n(?=\{)/);
  for (const p of parts) {
    try {
      out.push(JSON.parse(p));
    } catch {
      /* skip */
    }
  }
  return out;
}

function httpJson(method, urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: data
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data),
            }
          : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
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

run('status (after paper login)', ['status'], (r) => {
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

// Live init shape (no real Privy): --init starts local server
(function testLoginInit() {
  const label = 'login --init (loginUrl shape + local server)';
  const r = spawnSync(process.execPath, [bin, 'login', '--init', '--no-open'], {
    encoding: 'utf8',
    env: { ...process.env, SCHOOL_LOGIN_TIMEOUT_MS: '15000' },
    cwd: root,
  });
  const j = parseJson(r.stdout);
  let ok =
    r.status === 0 &&
    j &&
    j.ok === true &&
    j.phase === 'init' &&
    typeof j.loginUrl === 'string' &&
    /^http:\/\/127\.0\.0\.1:\d+\/login$/.test(j.loginUrl) &&
    typeof j.sessionId === 'string' &&
    j.sessionId.length >= 16 &&
    typeof j.expires_at === 'string';

  if (ok && j.pid) {
    cleanups.push(() => {
      try {
        process.kill(j.pid, 'SIGTERM');
      } catch {
        /* ignore */
      }
    });
  }

  // Hit login page + health
  if (ok) {
    try {
      const loginPage = spawnSync('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', j.loginUrl], {
        encoding: 'utf8',
      });
      const healthUrl = j.loginUrl.replace(/\/login$/, '/health');
      const health = spawnSync('curl', ['-sS', healthUrl], { encoding: 'utf8' });
      const healthJson = parseJson(health.stdout);
      ok =
        loginPage.status === 0 &&
        loginPage.stdout.trim() === '200' &&
        healthJson &&
        healthJson.ok === true &&
        healthJson.sessionId === j.sessionId;
    } catch (e) {
      ok = false;
      console.log(`  helper error: ${e.message}`);
    }
  }

  if (ok) {
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}`);
    console.log(`  exit=${r.status}`);
    if (r.stdout) console.log(`  stdout: ${r.stdout.slice(0, 800)}`);
    if (r.stderr) console.log(`  stderr: ${r.stderr.slice(0, 500)}`);
  }

  // Dry-run callback → poll done (still no real Privy / gateway)
  if (j && j.ok && j.loginUrl && j.sessionId) {
    const label2 = 'login dry-run callback + --poll';
    let ok2 = false;
    try {
      // Restart serve is already running from --init; POST callback.
      // Child was started without DRY_RUN — kill and redo with DRY_RUN for exchange.
      if (j.pid) {
        try {
          process.kill(j.pid, 'SIGTERM');
        } catch {
          /* ignore */
        }
      }

      const rInit = spawnSync(process.execPath, [bin, 'login', '--init', '--no-open'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          SCHOOL_LOGIN_TIMEOUT_MS: '20000',
          SCHOOL_LOGIN_DRY_RUN: '1',
        },
        cwd: root,
      });
      const init2 = parseJson(rInit.stdout);
      if (init2 && init2.ok && init2.pid) {
        cleanups.push(() => {
          try {
            process.kill(init2.pid, 'SIGTERM');
          } catch {
            /* ignore */
          }
        });
        const cb = init2.loginUrl.replace(/\/login$/, '/callback');
        const post = spawnSync(
          'curl',
          ['-sS', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', '{"privy_token":"fake-for-dry-run"}', cb],
          { encoding: 'utf8' }
        );
        const postJ = parseJson(post.stdout);
        const rPoll = spawnSync(
          process.execPath,
          [bin, 'login', '--poll', '--session', init2.sessionId],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              SCHOOL_LOGIN_TIMEOUT_MS: '20000',
              SCHOOL_LOGIN_DRY_RUN: '1',
            },
            cwd: root,
          }
        );
        const pollJ = parseJson(rPoll.stdout);
        ok2 =
          postJ &&
          postJ.ok === true &&
          rPoll.status === 0 &&
          pollJ &&
          pollJ.ok === true &&
          pollJ.phase === 'done' &&
          pollJ.has_jwt === true &&
          !JSON.stringify(pollJ).includes('fake-for-dry-run') &&
          !JSON.stringify(pollJ).includes('dry-run-jwt');
      }
    } catch (e) {
      console.log(`  dry-run error: ${e.message}`);
      ok2 = false;
    }
    if (ok2) {
      console.log(`PASS  ${label2}`);
    } else {
      failed += 1;
      console.log(`FAIL  ${label2}`);
    }
  }
})();

run('help mentions browser login + DEBUG token', ['--help'], (r) => {
  return (
    r.status === 0 &&
    /loginUrl/.test(r.stdout) &&
    /DEBUG/.test(r.stdout) &&
    /--paper/.test(r.stdout)
  );
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

run('status (after logout)', ['status'], (r) => {
  if (r.status !== 0) return false;
  const j = parseJson(r.stdout);
  return j && (j.address === null || j.address === undefined) && j.has_jwt === false;
});

for (const fn of cleanups) {
  try {
    fn();
  } catch {
    /* ignore */
  }
}

try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  /* ignore */
}

if (failed > 0) {
  console.log(`\n${failed} step(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke steps passed');
process.exit(0);
