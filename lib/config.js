'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

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
  // Prefer project-local session on shared box when present
  const local = path.join(__dirname, '..', '.session.json');
  if (process.env.SCHOOL_CLI_USE_LOCAL === '1') {
    return local;
  }
  return path.join(os.homedir(), '.school-cli', 'config.json');
}

function defaultConfig() {
  return {
    mode: 'paper',
    key: null,
    address: null,
    last_call: null,
  };
}

function load() {
  const p = configPath();
  try {
    if (!fs.existsSync(p)) return defaultConfig();
    const raw = fs.readFileSync(p, 'utf8');
    return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch (err) {
    return defaultConfig();
  }
}

function save(cfg) {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const out = {
    mode: cfg.mode || 'paper',
    key: cfg.key ?? null,
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
  configPath,
  defaultConfig,
  load,
  save,
  setLastCall,
};
