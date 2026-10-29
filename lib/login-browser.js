'use strict';

/**
 * OKX-style browser login: local callback + init/poll.
 * Never prints Privy tokens or gateway JWTs to stdout.
 * school.fun may not yet honor ?school_cli_callback= — local page is best-effort.
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const gateway = require('./gateway');

const DEFAULT_TIMEOUT_MS = 4 * 60 * 1000; // 4 minutes
const HOST = '127.0.0.1';

function timeoutMs() {
  const n = Number(process.env.SCHOOL_LOGIN_TIMEOUT_MS);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_TIMEOUT_MS;
}

function sessionsDir() {
  return path.join(path.dirname(config.configPath()), 'login-sessions');
}

function sessionFile(sessionId) {
  return path.join(sessionsDir(), `${sessionId}.json`);
}

function readSession(sessionId) {
  const p = sessionFile(sessionId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeSession(sessionId, meta) {
  fs.mkdirSync(sessionsDir(), { recursive: true });
  // Never persist secrets in the session sidecar
  const safe = { ...meta };
  delete safe.privy_token;
  delete safe.jwt;
  delete safe.token;
  fs.writeFileSync(sessionFile(sessionId), JSON.stringify(safe, null, 2) + '\n', 'utf8');
  return safe;
}

function newSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function buildLoginHtml({ callbackPath, privyAppId, sessionId, schoolCallbackHint }) {
  const appId = String(privyAppId || '').replace(/[^a-zA-Z0-9_]/g, '');
  const sid = String(sessionId || '').replace(/[^a-zA-Z0-9]/g, '');
  const cb = JSON.stringify(callbackPath);
  const hint = JSON.stringify(schoolCallbackHint || 'https://school.fun/');
  const appIdJson = JSON.stringify(appId);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>School CLI Login</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #0b0f14; color: #e8eef7; }
    .card { width: min(420px, 92vw); padding: 1.5rem; border-radius: 16px;
      background: #141b24; border: 1px solid #243041; box-shadow: 0 12px 40px #0008; }
    h1 { font-size: 1.15rem; margin: 0 0 .5rem; }
    p { margin: .4rem 0; color: #9db0c7; font-size: .92rem; line-height: 1.45; }
    button, a.btn { display: inline-block; margin-top: .9rem; padding: .7rem 1rem;
      border-radius: 10px; border: 0; background: #3d7eff; color: #fff;
      font-weight: 600; text-decoration: none; cursor: pointer; }
    a.btn.secondary { background: #243041; margin-left: .4rem; }
    .ok { color: #5ddea6; } .err { color: #ff7b8a; } .muted { color: #6d8098; font-size: .8rem; }
    code { font-size: .78rem; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect School.fun</h1>
    <p>Log in with Privy in your browser. Your Agent is waiting — never paste tokens into chat.</p>
    <p id="status" class="muted">Ready</p>
    <div>
      <button id="btn-open" type="button">Open school.fun login</button>
      <a class="btn secondary" id="btn-site" href="#" target="_blank" rel="noopener">school.fun</a>
    </div>
    <p class="muted" style="margin-top:1rem">Privy App <code>${appId}</code><br/>Session <code>${sid}</code></p>
    <p class="muted">If school.fun redirects back here with a token fragment, this page posts it to the local CLI callback automatically.</p>
  </div>
  <script>
(function () {
  var CALLBACK = ${cb};
  var SCHOOL_HINT = ${hint};
  var statusEl = document.getElementById('status');
  function setStatus(t, cls) {
    statusEl.textContent = t;
    statusEl.className = cls || 'muted';
  }
  function postToken(token) {
    if (!token) { setStatus('No token', 'err'); return; }
    setStatus('Sending to CLI…', 'muted');
    fetch(CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ privy_token: token })
    }).then(function (r) {
      return r.json().then(function (j) { return { r: r, j: j }; });
    }).then(function (x) {
      if (x.r.ok && x.j && x.j.ok) {
        setStatus('Login received. You can close this tab.', 'ok');
      } else {
        setStatus((x.j && x.j.error) || ('HTTP ' + x.r.status), 'err');
      }
    }).catch(function (e) {
      setStatus(String(e.message || e), 'err');
    });
  }
  (function consumeUrlToken() {
    var u = new URL(location.href);
    var t = u.searchParams.get('privy_token') || u.searchParams.get('token');
    if (!t && u.hash) {
      var m = u.hash.match(/(?:privy_token|token|access_token)=([^&]+)/);
      if (m) t = decodeURIComponent(m[1]);
    }
    if (t) {
      history.replaceState({}, '', u.pathname);
      postToken(t);
    }
  })();
  document.getElementById('btn-site').href = SCHOOL_HINT;
  document.getElementById('btn-open').addEventListener('click', function () {
    setStatus('Opened school.fun — finish Privy there', 'muted');
    window.open(SCHOOL_HINT, '_blank', 'noopener');
  });
})();
  </script>
</body>
</html>`;
}

/**
 * Start a one-shot local callback server.
 * Resolves when a privy_token is posted, or rejects on timeout/close.
 */
function startCallbackServer(opts = {}) {
  const env = config.gatewayEnv();
  const sessionId = opts.sessionId || newSessionId();
  const expiresAt = new Date(Date.now() + timeoutMs()).toISOString();
  let privyTokenResolve;
  let privyTokenReject;
  let settled = false;
  const tokenPromise = new Promise((resolve, reject) => {
    privyTokenResolve = resolve;
    privyTokenReject = reject;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${HOST}`);

    const sendJson = (code, obj) => {
      const body = JSON.stringify(obj);
      res.writeHead(code, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end(body);
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/login')) {
      const callbackPath = '/callback';
      const schoolCallbackHint =
        `https://school.fun/?school_cli_callback=${encodeURIComponent(`http://${HOST}:${server.address().port}/callback`)}` +
        `&school_cli_session=${encodeURIComponent(sessionId)}`;
      const html = buildLoginHtml({
        callbackPath,
        privyAppId: env.privyAppId,
        sessionId,
        schoolCallbackHint,
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(200, { ok: true, sessionId, status: settled ? 'settled' : 'waiting' });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/callback') {
      let raw = '';
      req.on('data', (c) => {
        raw += c;
        if (raw.length > 1_000_000) req.destroy();
      });
      req.on('end', () => {
        let token = null;
        try {
          const ct = req.headers['content-type'] || '';
          if (ct.includes('application/json')) {
            const j = JSON.parse(raw || '{}');
            token = j.privy_token || j.token || j.access_token || null;
          } else if (ct.includes('application/x-www-form-urlencoded')) {
            const params = new URLSearchParams(raw);
            token = params.get('privy_token') || params.get('token');
          } else {
            // try json anyway
            try {
              const j = JSON.parse(raw || '{}');
              token = j.privy_token || j.token || null;
            } catch {
              token = raw && raw.trim() ? raw.trim() : null;
            }
          }
        } catch {
          token = null;
        }

        if (!token) {
          sendJson(400, { ok: false, error: 'missing_privy_token' });
          return;
        }
        if (settled) {
          sendJson(409, { ok: false, error: 'already_received' });
          return;
        }
        settled = true;
        writeSession(sessionId, {
          ...(readSession(sessionId) || {}),
          sessionId,
          status: 'received',
          expires_at: expiresAt,
        });
        sendJson(200, { ok: true, received: true });
        privyTokenResolve(token);
      });
      return;
    }

    sendJson(404, { ok: false, error: 'not_found' });
  });

  const listenPromise = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, () => {
      server.removeListener('error', reject);
      resolve(server.address());
    });
  });

  const timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      writeSession(sessionId, {
        ...(readSession(sessionId) || {}),
        sessionId,
        status: 'expired',
        expires_at: expiresAt,
      });
      privyTokenReject(Object.assign(new Error('login_timeout'), { code: 'LOGIN_TIMEOUT' }));
      try {
        server.close();
      } catch {
        /* ignore */
      }
    }
  }, timeoutMs());

  return {
    sessionId,
    expiresAt,
    server,
    ready: listenPromise.then((addr) => {
      const port = addr.port;
      const loginUrl = `http://${HOST}:${port}/login`;
      writeSession(sessionId, {
        sessionId,
        port,
        loginUrl,
        expires_at: expiresAt,
        status: 'waiting',
        pid: process.pid,
      });
      return { port, loginUrl, sessionId, expires_at: expiresAt };
    }),
    waitForToken: () =>
      tokenPromise.finally(() => {
        clearTimeout(timeout);
      }),
    close: () =>
      new Promise((resolve) => {
        clearTimeout(timeout);
        server.close(() => resolve());
      }),
  };
}

function tryOpenUrl(url) {
  if (process.env.SCHOOL_LOGIN_NO_OPEN === '1') return false;
  const plat = process.platform;
  let cmd;
  let args;
  if (plat === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (plat === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Exchange privy token → gateway JWT and persist session (no secrets on stdout).
 */
async function completeWithPrivyToken(privyToken) {
  // CI / smoke: accept callback without hitting Privy gateway
  if (process.env.SCHOOL_LOGIN_DRY_RUN === '1') {
    const prev = config.load();
    const saved = config.save({
      mode: 'live',
      auth: 'jwt',
      jwt: 'dry-run-jwt',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      address: 'DryRun111111111111111111111111111111111',
      last_call: prev.last_call,
    });
    return {
      ok: true,
      phase: 'done',
      skill: 'wallet_login',
      provider: 'privy-dry-run',
      mode: saved.mode,
      auth: saved.auth,
      has_jwt: true,
      expires_at: saved.expires_at,
      address: saved.address,
      config: config.configPath(),
      dry_run: true,
    };
  }
  const res = await gateway.exchangePrivyToken(privyToken);
  if (!res.ok) {
    const err = new Error('auth_privy_rejected');
    err.code = 'AUTH_PRIVY_REJECTED';
    err.status = res.status;
    err.url = res.url;
    err.data = res.data;
    throw err;
  }
  const data = res.data || {};
  const jwt =
    data.token || data.access_token || data.jwt || data.accessToken || null;
  const expiresAt = data.expires_at || data.expiresAt || data.exp || null;
  const address = data.address || data.wallet || data.wallet_address || null;
  if (!jwt) {
    const err = new Error('no_jwt_in_response');
    err.code = 'NO_JWT';
    err.data = data;
    throw err;
  }
  const prev = config.load();
  const saved = config.save({
    mode: 'live',
    auth: 'jwt',
    jwt,
    expires_at: expiresAt,
    address,
    last_call: prev.last_call,
  });
  return {
    ok: true,
    phase: 'done',
    skill: 'wallet_login',
    provider: 'privy',
    mode: saved.mode,
    auth: saved.auth,
    has_jwt: true,
    expires_at: saved.expires_at,
    address: saved.address,
    config: config.configPath(),
  };
}

/**
 * Full init → print handled by caller → wait → exchange.
 */
async function runBrowserLogin({ openBrowser = true, onInit } = {}) {
  const handle = startCallbackServer();
  const init = await handle.ready;
  if (typeof onInit === 'function') onInit(init);
  if (openBrowser) tryOpenUrl(init.loginUrl);

  let token;
  try {
    token = await handle.waitForToken();
  } catch (e) {
    await handle.close();
    writeSession(init.sessionId, {
      sessionId: init.sessionId,
      loginUrl: init.loginUrl,
      port: init.port,
      expires_at: init.expires_at,
      status: e.code === 'LOGIN_TIMEOUT' ? 'expired' : 'error',
      error: e.code || e.message,
    });
    throw e;
  }

  try {
    const done = await completeWithPrivyToken(token);
    writeSession(init.sessionId, {
      sessionId: init.sessionId,
      loginUrl: init.loginUrl,
      port: init.port,
      expires_at: init.expires_at,
      status: 'done',
      address: done.address || null,
    });
    await handle.close();
    return { init, done };
  } catch (e) {
    writeSession(init.sessionId, {
      sessionId: init.sessionId,
      loginUrl: init.loginUrl,
      port: init.port,
      expires_at: init.expires_at,
      status: 'error',
      error: e.code || e.message,
    });
    await handle.close();
    throw e;
  }
}

/**
 * Init only: start detached waiter process, return loginUrl for the Agent.
 */
async function runInitDetached() {
  const env = config.gatewayEnv();
  const sessionId = newSessionId();
  const expiresAt = new Date(Date.now() + timeoutMs()).toISOString();

  const childEnv = {
    ...process.env,
    SCHOOL_LOGIN_SESSION_ID: sessionId,
    SCHOOL_LOGIN_EXPIRES_AT: expiresAt,
  };
  const bin = process.argv[1]; // school.js
  const child = spawn(process.execPath, [bin, 'login', '--serve-session', sessionId], {
    detached: true,
    stdio: 'ignore',
    env: childEnv,
  });
  child.unref();

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const meta = readSession(sessionId);
    if (meta && meta.loginUrl && meta.status === 'waiting') {
      return {
        ok: true,
        phase: 'init',
        loginUrl: meta.loginUrl,
        sessionId,
        expires_at: meta.expires_at || expiresAt,
        pid: meta.pid || child.pid,
        privy_app_id: env.privyAppId,
        note:
          'Open loginUrl, complete Privy in browser. Then: school login --poll --session ' +
          sessionId,
      };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    ok: false,
    phase: 'init',
    error: 'serve_start_timeout',
    sessionId,
    message: 'Background login server did not publish loginUrl in time',
  };
}

/**
 * Long-running serve for detached init (internal).
 */
async function serveSession(sessionId) {
  const handle = startCallbackServer({ sessionId });
  const init = await handle.ready;
  // session file already written by startCallbackServer
  let token;
  try {
    token = await handle.waitForToken();
  } catch (e) {
    await handle.close();
    process.exitCode = e.code === 'LOGIN_TIMEOUT' ? 1 : 1;
    return;
  }
  try {
    const done = await completeWithPrivyToken(token);
    writeSession(sessionId, {
      sessionId,
      loginUrl: init.loginUrl,
      port: init.port,
      expires_at: init.expires_at,
      status: 'done',
      address: done.address || null,
      has_jwt: true,
    });
  } catch (e) {
    writeSession(sessionId, {
      sessionId,
      loginUrl: init.loginUrl,
      port: init.port,
      expires_at: init.expires_at,
      status: 'error',
      error: e.code || e.message,
    });
    process.exitCode = 1;
  }
  await handle.close();
}

/**
 * Poll session sidecar until done / error / expired.
 */
async function pollSession(sessionId, { intervalMs = 500 } = {}) {
  const started = Date.now();
  const maxWait = timeoutMs() + 5_000;
  while (Date.now() - started < maxWait) {
    const meta = readSession(sessionId);
    if (!meta) {
      return { ok: false, phase: 'poll', error: 'unknown_session', sessionId };
    }
    if (meta.status === 'done') {
      const cfg = config.load();
      return {
        ok: true,
        phase: 'done',
        skill: 'wallet_login',
        provider: 'privy',
        mode: cfg.mode,
        auth: cfg.auth,
        has_jwt: Boolean(cfg.jwt),
        expires_at: cfg.expires_at,
        address: cfg.address,
        sessionId,
        config: config.configPath(),
      };
    }
    if (meta.status === 'expired') {
      return { ok: false, phase: 'poll', error: 'login_timeout', sessionId };
    }
    if (meta.status === 'error') {
      return {
        ok: false,
        phase: 'poll',
        error: meta.error || 'login_error',
        sessionId,
      };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, phase: 'poll', error: 'login_timeout', sessionId };
}

module.exports = {
  timeoutMs,
  startCallbackServer,
  tryOpenUrl,
  completeWithPrivyToken,
  runBrowserLogin,
  runInitDetached,
  serveSession,
  pollSession,
  readSession,
  writeSession,
  sessionsDir,
  HOST,
};
