#!/usr/bin/env node
'use strict';

const config = require('../lib/config');
const skills = require('../lib/skills');

function usage() {
  return `school — School.fun AI agent CLI (paper-first)

Usage:
  school login [--paper]     Privy stub: write local paper session
  school logout              Clear local session
  school status              Show mode / key / last_call
  school skills list         List P0 skills from school-skills/skills.json
  school skills run <id> [--input JSON]
                             Run a skill (trade_paper = local sim only)

Env:
  SCHOOL_SKILLS_PATH   Override path to skills.json
  SCHOOL_CLI_CONFIG    Override session config file path
  SCHOOL_CLI_HOME      Dir for config.json (default ~/.school-cli)

Notes:
  - Live Privy login blocked until PRIVY_APP_ID is provided (TODO).
  - trade_paper never signs or hits chain.
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

function cmdLogin(flags) {
  // TODO(privy): when PRIVY_APP_ID (and client secret if needed) arrives,
  // replace this stub with real Privy browser/device login and store
  // session token + wallet address. Never invent Privy credentials.
  const paper = flags.paper !== false; // default paper until Privy ready
  if (!paper && !process.env.PRIVY_APP_ID) {
    console.error(
      'Live login requires PRIVY_APP_ID. Use `school login --paper` for local stub.\n' +
        'TODO: wire Privy hosted wallet when App ID is provided (do not invent credentials).'
    );
    process.exitCode = 1;
    return;
  }

  const fakeAddress = 'So1SchoolPaper111111111111111111111111111';
  const saved = config.save({
    mode: 'paper',
    key: null,
    address: fakeAddress,
    last_call: config.load().last_call,
  });

  printJson({
    ok: true,
    skill: 'wallet_login',
    provider: 'privy-stub',
    mode: saved.mode,
    address: saved.address,
    config: config.configPath(),
    todo: 'Replace stub with real Privy when PRIVY_APP_ID arrives',
  });
}

function cmdLogout() {
  const saved = config.save(config.defaultConfig());
  printJson({ ok: true, cleared: true, mode: saved.mode, config: config.configPath() });
}

function cmdStatus() {
  const cfg = config.load();
  printJson({
    mode: cfg.mode,
    key: cfg.key,
    last_call: cfg.last_call,
    address: cfg.address ?? null,
    config: config.configPath(),
    skills_path: skills.skillsPath(),
  });
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

function main() {
  const { positional, flags } = parseArgs(process.argv);
  if (flags.help || positional.length === 0) {
    process.stdout.write(usage());
    return;
  }

  const [cmd, sub, ...rest] = positional;

  switch (cmd) {
    case 'login':
      cmdLogin(flags);
      break;
    case 'logout':
      cmdLogout();
      break;
    case 'status':
      cmdStatus();
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

main();
