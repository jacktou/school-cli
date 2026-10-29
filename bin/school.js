#!/usr/bin/env node
'use strict';

const config = require('../lib/config');
const skills = require('../lib/skills');
const gateway = require('../lib/gateway');

function usage() {
  return `school — School.fun AI agent CLI (paper-first)

Usage:
  school login --paper              Local paper session (stub address)
  school login --privy [--token T]  Exchange Privy access token → gateway JWT
  school logout                     Clear local session
  school status [--probe]           Show mode / auth / last_call (+ optional GET /time)
  school gateway time               Probe GET {SCHOOL_API_BASE}/time
  school skills list                List P0 skills from school-skills/skills.json
  school skills run <id> [--input JSON]
                                    Run a skill (trade_paper = local sim only)

Env:
  SCHOOL_API_BASE      Gateway base (default https://school.fun/dex/gateway/v1)
  PRIVY_APP_ID         Privy app id (public; default from school.fun web)
  SCHOOL_ORG_ID        x-org-id header
  SCHOOL_TENANT_ID     x-tenant-id header
  SCHOOL_JWT           Optional Bearer JWT overlay (not written unless login --privy)
  PRIVY_TOKEN          Privy access token for login --privy
  KUANT_API_BASE       Future token_security base (default https://api.kuant.ai)
  SCHOOL_SKILLS_PATH   Override path to skills.json
  SCHOOL_CLI_CONFIG    Override session config file path
  SCHOOL_CLI_HOME      Dir for config.json (default ~/.school-cli)

Notes:
  - login --privy needs a real Privy access token (browser/device). We never invent tokens.
  - POST {SCHOOL_API_BASE}/auth/privy body: { "privy_token": "<privy access token>" }
  - trade_paper never signs or hits chain. No order endpoints from this CLI yet.
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
    } else if (a === '--probe') {
      flags.probe = true;
    } else if (a === '--token' || a === '-t') {
      flags.token = args[++i];
    } else if (a === '--input' || a === '-i') {
      flags.input = args[++i];
    } else if (a === '--help' || a === '-h') {
      flags.help = true;
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

async function cmdLoginPrivy(flags) {
  const env = config.gatewayEnv();
  const privyToken = flags.token || process.env.PRIVY_TOKEN || null;

  if (!privyToken) {
    printJson({
      ok: false,
      skill: 'wallet_login',
      mode: 'live',
      error: 'missing_privy_token',
      message:
        'Live login needs a Privy access token from the browser/device login flow. ' +
        'We do not invent tokens. Pass --token <privy_jwt> or set PRIVY_TOKEN.',
      how: {
        endpoint: `${env.apiBase}/auth/privy`,
        method: 'POST',
        body: { privy_token: '<privy access token from Privy>' },
        privy_app_id: env.privyAppId,
        example_cli: 'PRIVY_TOKEN=... school login --privy',
        example_cli_flag: 'school login --privy --token <privy_jwt>',
      },
    });
    process.exitCode = 1;
    return;
  }

  let res;
  try {
    res = await gateway.exchangePrivyToken(privyToken);
  } catch (e) {
    console.error('gateway auth/privy failed:', e.message);
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    printJson({
      ok: false,
      skill: 'wallet_login',
      mode: 'live',
      error: 'auth_privy_rejected',
      status: res.status,
      url: res.url,
      data: res.data,
    });
    process.exitCode = 1;
    return;
  }

  const data = res.data || {};
  // Gateway may return token / access_token / jwt — accept common shapes; do not invent.
  const jwt =
    data.token || data.access_token || data.jwt || data.accessToken || null;
  const expiresAt =
    data.expires_at || data.expiresAt || data.exp || null;
  const address =
    data.address || data.wallet || data.wallet_address || null;

  if (!jwt) {
    printJson({
      ok: false,
      skill: 'wallet_login',
      mode: 'live',
      error: 'no_jwt_in_response',
      status: res.status,
      url: res.url,
      data,
      note: 'Gateway response had no token/access_token/jwt field. Session not saved.',
    });
    process.exitCode = 1;
    return;
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

  printJson({
    ok: true,
    skill: 'wallet_login',
    provider: 'privy',
    mode: saved.mode,
    auth: saved.auth,
    has_jwt: true,
    expires_at: saved.expires_at,
    address: saved.address,
    config: config.configPath(),
  });
}

function cmdLogin(flags) {
  if (flags.privy) {
    return cmdLoginPrivy(flags);
  }
  // Default and --paper: local stub
  if (flags.paper || (!flags.privy && !flags.live)) {
    cmdLoginPaper();
    return;
  }
  // Bare `school login` without flags → paper (backward compatible)
  cmdLoginPaper();
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
