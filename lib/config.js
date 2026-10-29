'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/** Public defaults captured from school.fun web (not secrets). */
const DEFAULTS = {
  SCHOOL_API_BASE: 'https://school.fun/dex/gateway/v1',
  PRIVY_APP_ID: 'cmub8c7cw00p30bjwjmplktib',
  SCHOOL_ORG_ID: 'org_cnbdq6b0jcUhF5KM',
  SCHOOL_TENANT_ID: 'tnt_FaMPg11lEX98rTYW',
  KUANT_API_BASE: 'https://api.kuant.ai',
};

/**
 * Session store:
 * - Default: ~/.school-cli/config.json
 * - Box / override: SCHOOL_CLI_CONFIG or project .session.json via SCHOOL_CLI_HOME
 */
function configPath() {
  if (process.env.SCHOOL_CLI_CONFIG) {
    return process.env.SCHOOL_CLI_CONFIG;
  }
  if (process.env.SCHOOL_CLI_HOME) {
    return path.join(process.env.SCHOOL_CLI_HOME, 'config.json');
  }
  const local = path.join(__dirname, '..', '.session.json');
  if (process.env.SCHOOL_CLI_USE_LOCAL === '1') {
    return local;
  }
  return path.join(os.homedir(), '.school-cli', 'config.json');
}

function envOrDefault(name) {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  return DEFAULTS[name] ?? null;
}

/** Live gateway / Privy env (defaults from public web capture). */
function gatewayEnv() {
  return {
    apiBase: envOrDefault('SCHOOL_API_BASE'),
    privyAppId: envOrDefault('PRIVY_APP_ID'),
    orgId: envOrDefault('SCHOOL_ORG_ID'),
    tenantId: envOrDefault('SCHOOL_TENANT_ID'),
    kuantBase: envOrDefault('KUANT_API_BASE'),
    jwtFromEnv: process.env.SCHOOL_JWT || null,
  };
}

function defaultConfig() {
  return {
    mode: 'paper',
    // Legacy field kept null; prefer auth / jwt (not an API Key).
    key: null,
    auth: null, // "jwt" | null
    jwt: null,
    expires_at: null,
    address: null,
    last_call: null,
  };
}

function load() {
  const p = configPath();
  try {
    if (!fs.existsSync(p)) return defaultConfig();
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    const cfg = { ...defaultConfig(), ...parsed };
    // Env JWT can overlay empty session jwt for one-shot probes
    if (!cfg.jwt && process.env.SCHOOL_JWT) {
      cfg.jwt = process.env.SCHOOL_JWT;
      cfg.auth = 'jwt';
    }
    return cfg;
  } catch (err) {
    return defaultConfig();
  }
}

function save(cfg) {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const hasJwt = Boolean(cfg.jwt);
  const out = {
    mode: cfg.mode || 'paper',
    key: null, // deprecated — never store API keys here
    auth: cfg.auth ?? (hasJwt ? 'jwt' : null),
    jwt: cfg.jwt ?? null,
    expires_at: cfg.expires_at ?? null,
    address: cfg.address ?? null,
    last_call: cfg.last_call ?? null,
  };
  fs.writeFileSync(p, JSON.stringify(out, null, 2) + '\n', 'utf8');
  return out;
}

function setLastCall(id) {
  const cfg = load();
  cfg.last_call = { id, at: new Date().toISOString() };
  return save(cfg);
}

module.exports = {
  DEFAULTS,
  configPath,
  defaultConfig,
  gatewayEnv,
  load,
  save,
  setLastCall,
};
