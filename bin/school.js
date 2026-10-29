#!/usr/bin/env node
'use strict';

const config = require('../lib/config');
const skills = require('../lib/skills');
const gateway = require('../lib/gateway');
const loginBrowser = require('../lib/login-browser');

function usage() {
  return `school — School.fun AI agent CLI (paper-first)

Usage:
  school login                      Live: browser init + poll (OKX-style; no token paste)
  school login --live               Same as bare login (browser flow)
  school login --init               Start login server; print loginUrl + sessionId; Agent shows link
  school login --poll --session ID  Wait until browser login finishes (or timeout)
  school login --paper              Local paper session (stub address)
  school login --token T            DEBUG ONLY: exchange Privy token → JWT (also PRIVY_TOKEN)
  school logout                     Clear local session
  school status [--probe]           Show mode / auth / has_jwt / last_call (+ optional GET /time)
  school gateway time               Probe GET {SCHOOL_API_BASE}/time
  school gateway markets            Probe GET {SCHOOL_API_BASE}/query/markets
  school skills list                List P0 skills from school-skills/skills.json
  school skills run <id> [--input JSON]
                                    Run a skill (trade_paper = local sim only)

Env:
  SCHOOL_API_BASE           Gateway base (default https://school.fun/dex/gateway/v1)
  PRIVY_APP_ID              Privy app id (public; default from school.fun web)
  SCHOOL_ORG_ID             x-org-id header
  SCHOOL_TENANT_ID          x-tenant-id header
  SCHOOL_JWT                Optional Bearer JWT overlay (not written unless login succeeds)
  PRIVY_TOKEN               DEBUG ONLY: Privy access token (prefer browser login)
  SCHOOL_LOGIN_TIMEOUT_MS   Browser login timeout (default 240000)
  SCHOOL_LOGIN_NO_OPEN=1    Do not auto-open the browser
  KUANT_API_BASE            Future token_security base (default https://api.kuant.ai)
  SCHOOL_SKILLS_PATH        Override path to skills.json
  SCHOOL_CLI_CONFIG         Override session config file path
  SCHOOL_CLI_HOME           Dir for config.json (default ~/.school-cli)

Notes:
  - Product login: school login → open loginUrl → Privy in browser → CLI polls local callback.
  - Never paste Privy tokens into chat. --token / PRIVY_TOKEN are debug/dev only.
  - POST {SCHOOL_API_BASE}/auth/privy body: { "privy_token": "<privy access token>" }
  - trade_paper never signs or hits chain. No order endpoints from this CLI yet.
  - school.fun may not yet honor ?school_cli_callback=; local page still accepts redirect tokens.
`;
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--paper') {
      flags.paper = true;
    } else if (a === '--privy') {
      flags.privy = true;
    } else if (a === '--live') {
      flags.live = true;
    } else if (a === '--init') {
      flags.init = true;
    } else if (a === '--poll') {
      flags.poll = true;
    } else if (a === '--serve-session') {
      flags.serveSession = args[++i];
    } else if (a === '--session') {
      flags.session = args[++i];
    } else if (a === '--probe') {
      flags.probe = true;
    } else if (a === '--token' || a === '-t') {
      flags.token = args[++i];
    } else if (a === '--input' || a === '-i') {
      flags.input = args[++i];
    } else if (a === '--help' || a === '-h') {
      flags.help = true;
    } else if (a === '--no-open') {
      flags.noOpen = true;
      process.env.SCHOOL_LOGIN_NO_OPEN = '1';
    } else if (a.startsWith('--')) {
      flags[a.slice(2)] = args[++i] ?? true;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function cmdLoginPaper() {
  const fakeAddress = 'So1SchoolPaper111111111111111111111111111';
  const prev = config.load();
  const saved = config.save({
    mode: 'paper',
    auth: null,
    jwt: null,
    expires_at: null,
    address: fakeAddress,
    last_call: prev.last_call,
  });

  printJson({
    ok: true,
    skill: 'wallet_login',
    provider: 'privy-stub',
    mode: saved.mode,
    address: saved.address,
    auth: saved.auth,
    config: config.configPath(),
  });
}

/** DEBUG ONLY — exchange a pasted Privy token. Not the product path. */
async function cmdLoginDebugToken(flags) {
  const env = config.gatewayEnv();
  const privyToken = flags.token || process.env.PRIVY_TOKEN || null;

  if (!privyToken) {
    printJson({
      ok: false,
      skill: 'wallet_login',
      mode: 'live',
      error: 'missing_privy_token',
      message:
        'Debug token path only. Prefer: school login (browser init/poll). ' +
        'For debug, pass --token <privy_jwt> or PRIVY_TOKEN.',
      how: {
        product: 'school login',
        debug_endpoint: `${env.apiBase}/auth/privy`,
        method: 'POST',
        body: { privy_token: '<privy access token>' },
        privy_app_id: env.privyAppId,
      },
    });
    process.exitCode = 1;
    return;
  }

  try {
    const done = await loginBrowser.completeWithPrivyToken(privyToken);
    printJson({
      ...done,
      debug: true,
      note: '--token / PRIVY_TOKEN is debug/dev only; product path is school login (browser)',
    });
  } catch (e) {
    if (e.code === 'AUTH_PRIVY_REJECTED') {
      printJson({
        ok: false,
        skill: 'wallet_login',
        mode: 'live',
        error: 'auth_privy_rejected',
        status: e.status,
        url: e.url,
        data: e.data,
      });
    } else if (e.code === 'NO_JWT') {
      printJson({
        ok: false,
        skill: 'wallet_login',
        mode: 'live',
        error: 'no_jwt_in_response',
        data: e.data,
        note: 'Gateway response had no token/access_token/jwt field. Session not saved.',
      });
    } else {
      console.error('gateway auth/privy failed:', e.message);
    }
    process.exitCode = 1;
  }
}

async function cmdLoginBrowser(flags) {
  // --init: detached serve + print loginUrl for Agent
  if (flags.init) {
    const out = await loginBrowser.runInitDetached();
    printJson(out);
    if (!out.ok) process.exitCode = 1;
    return;
  }

  // --poll --session
  if (flags.poll) {
    const sid = flags.session || process.env.SCHOOL_LOGIN_SESSION_ID;
    if (!sid) {
      printJson({
        ok: false,
        phase: 'poll',
        error: 'missing_session',
        message: 'Usage: school login --poll --session <id>',
      });
      process.exitCode = 1;
      return;
    }
    const out = await loginBrowser.pollSession(sid);
    printJson(out);
    if (!out.ok) process.exitCode = 1;
    return;
  }

  // Internal: detached child
  if (flags.serveSession) {
    await loginBrowser.serveSession(flags.serveSession);
    return;
  }

  // Default live: same-process init → print → open → poll → done
  // Print init first so Agents can surface loginUrl while we block.
  try {
    const { done } = await loginBrowser.runBrowserLogin({
      openBrowser: !flags.noOpen,
      onInit: (init) => {
        printJson({
          ok: true,
          phase: 'init',
          loginUrl: init.loginUrl,
          sessionId: init.sessionId,
          expires_at: init.expires_at,
          privy_app_id: config.gatewayEnv().privyAppId,
          message: 'Open loginUrl and finish Privy in the browser. Waiting for local callback…',
        });
      },
    });
    printJson(done);
  } catch (e) {
    if (e.code === 'LOGIN_TIMEOUT') {
      printJson({
        ok: false,
        phase: 'poll',
        error: 'login_timeout',
        message: 'Timed out waiting for browser login callback',
      });
    } else if (e.code === 'AUTH_PRIVY_REJECTED') {
      printJson({
        ok: false,
        phase: 'done',
        error: 'auth_privy_rejected',
        status: e.status,
        url: e.url,
        data: e.data,
      });
    } else if (e.code === 'NO_JWT') {
      printJson({
        ok: false,
        phase: 'done',
        error: 'no_jwt_in_response',
        data: e.data,
      });
    } else {
      printJson({
        ok: false,
        phase: 'done',
        error: e.code || 'login_failed',
        message: e.message,
      });
    }
    process.exitCode = 1;
  }
}

async function cmdLogin(flags) {
  // Paper stub — unchanged
  if (flags.paper) {
    cmdLoginPaper();
    return;
  }

  // Debug token path (also --privy --token for back-compat)
  const debugToken = flags.token || process.env.PRIVY_TOKEN;
  if (debugToken || (flags.privy && (flags.token || process.env.PRIVY_TOKEN))) {
    // If --privy without token and no PRIVY_TOKEN → fall through to browser
    if (debugToken) {
      await cmdLoginDebugToken(flags);
      return;
    }
  }
  if (flags.privy && !debugToken && !flags.live && !flags.init && !flags.poll && !flags.serveSession) {
    // --privy alone: product browser flow (not missing_token error)
    await cmdLoginBrowser({ ...flags, live: true });
    return;
  }

  // Explicit debug request without token
  if (flags.token === '' || (flags['debug-token'] && !debugToken)) {
    await cmdLoginDebugToken(flags);
    return;
  }

  // Default / --live / --init / --poll / --serve-session
  await cmdLoginBrowser(flags);
}

function cmdLogout() {
  const saved = config.save(config.defaultConfig());
  printJson({ ok: true, cleared: true, mode: saved.mode, config: config.configPath() });
}

async function cmdStatus(flags) {
  const cfg = config.load();
  const env = config.gatewayEnv();
  const out = {
    mode: cfg.mode,
    auth: cfg.auth || null,
    has_jwt: Boolean(cfg.jwt),
    expires_at: cfg.expires_at || null,
    last_call: cfg.last_call,
    address: cfg.address ?? null,
    config: config.configPath(),
    skills_path: skills.skillsPath(),
    gateway: {
      api_base: env.apiBase,
      privy_app_id: env.privyAppId,
      org_id: env.orgId,
      tenant_id: env.tenantId,
      kuant_api_base: env.kuantBase,
    },
  };

  if (flags.probe) {
    try {
      const probe = await gateway.probeTime();
      out.probe = {
        path: '/time',
        ok: probe.ok,
        status: probe.status,
        url: probe.url,
        data: probe.data,
      };
    } catch (e) {
      out.probe = { path: '/time', ok: false, error: e.message };
    }
  }

  printJson(out);
}

async function cmdGateway(sub) {
  if (sub === 'time') {
    try {
      const probe = await gateway.probeTime();
      printJson({
        ok: probe.ok,
        status: probe.status,
        url: probe.url,
        data: probe.data,
      });
      if (!probe.ok) process.exitCode = 1;
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
    return;
  }
  if (sub === 'markets') {
    try {
      const probe = await gateway.probeMarkets();
      printJson({
        ok: probe.ok,
        status: probe.status,
        url: probe.url,
        data: probe.data,
      });
      if (!probe.ok) process.exitCode = 1;
    } catch (e) {
      console.error(e.message);
      process.exitCode = 1;
    }
    return;
  }
  console.error('Usage: school gateway time | school gateway markets');
  process.exitCode = 1;
}

function cmdSkillsList() {
  const rows = skills.listSkills();
  for (const r of rows) {
    process.stdout.write(`${r.id}\t${r.group}\t${r.title}\n`);
  }
  process.stderr.write(`# ${rows.length} skills from ${skills.skillsPath()}\n`);
}

function cmdSkillsRun(id, flags) {
  if (!id) {
    console.error('Missing skill id. Usage: school skills run <id> [--input JSON]');
    process.exitCode = 1;
    return;
  }

  let input = {};
  if (flags.input) {
    try {
      input = JSON.parse(flags.input);
    } catch (e) {
      console.error('Invalid --input JSON:', e.message);
      process.exitCode = 1;
      return;
    }
  }

  try {
    const result = skills.runSkill(id, input);
    config.setLastCall(id);
    printJson(result);
  } catch (e) {
    console.error(e.message);
    process.exitCode = e.code === 'UNKNOWN_SKILL' ? 2 : 1;
  }
}

async function main() {
  const { positional, flags } = parseArgs(process.argv);
  if (flags.help || positional.length === 0) {
    process.stdout.write(usage());
    return;
  }

  const [cmd, sub, ...rest] = positional;

  switch (cmd) {
    case 'login':
      await cmdLogin(flags);
      break;
    case 'logout':
      cmdLogout();
      break;
    case 'status':
      await cmdStatus(flags);
      break;
    case 'gateway':
      await cmdGateway(sub);
      break;
    case 'skills':
      if (sub === 'list') {
        cmdSkillsList();
      } else if (sub === 'run') {
        cmdSkillsRun(rest[0], flags);
      } else {
        console.error('Usage: school skills list | school skills run <id>');
        process.exitCode = 1;
      }
      break;
    default:
      console.error(`Unknown command: ${cmd}\n`);
      process.stdout.write(usage());
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
