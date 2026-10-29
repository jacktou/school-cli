'use strict';

const fs = require('fs');
const path = require('path');

function skillsPath() {
  if (process.env.SCHOOL_SKILLS_PATH) {
    return process.env.SCHOOL_SKILLS_PATH;
  }
  return path.resolve(__dirname, '..', '..', 'school-skills', 'skills.json');
}

function loadSkillsContract() {
  const p = skillsPath();
  if (!fs.existsSync(p)) {
    throw new Error(
      `skills.json not found at ${p}. Set SCHOOL_SKILLS_PATH or place school-skills next to school-cli.`
    );
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function listSkills() {
  const contract = loadSkillsContract();
  return (contract.skills || []).map((s) => ({
    id: s.id,
    group: s.group,
    title: s.title,
    description: s.description,
  }));
}

function findSkill(id) {
  const contract = loadSkillsContract();
  return (contract.skills || []).find((s) => s.id === id) || null;
}

function stubNote(skillId) {
  return {
    _mock: true,
    _note: `Placeholder/mock data for ${skillId}. Not live School.fun API. mode=paper.`,
  };
}

/** Normalize common aliases when the canonical key is missing. */
function normalizeAliases(input) {
  const out = { ...(input || {}) };
  if (out.ca == null && out.mint != null) out.ca = out.mint;
  if (out.size == null && out.amount != null) out.size = out.amount;
  if (out.pair == null && out.token != null) out.pair = out.token;
  return out;
}

function isMissing(v) {
  return v === undefined || v === null || v === '';
}

/**
 * Require fields after aliasing. Does not invent values.
 * @param {object} input
 * @param {string[]} fields
 * @param {string} skillId
 * @param {object} example
 */
function requireFields(input, fields, skillId, example) {
  const missing = fields.filter((f) => isMissing(input[f]));
  if (missing.length === 0) return;
  const exampleStr = JSON.stringify(example);
  throw new Error(
    `Skill ${skillId} missing required field(s): ${missing.join(', ')}. ` +
      `Example: --input '${exampleStr}'`
  );
}

function runSkill(id, input = {}) {
  const skill = findSkill(id);
  if (!skill) {
    const err = new Error(
      `Unknown skill id: ${id}. Run \`school skills list\` for P0 ids.`
    );
    err.code = 'UNKNOWN_SKILL';
    throw err;
  }

  input = normalizeAliases(input);

  switch (id) {
    case 'trade_paper': {
      requireFields(input, ['pair', 'side', 'size'], id, {
        pair: 'SOL/USDC',
        side: 'buy',
        size: 1,
      });
      const pair = input.pair;
      const side = input.side;
      const size = Number(input.size);
      const fill_price = 148.25;
      return {
        mode: 'paper',
        pair,
        side,
        size,
        fill_price,
        pnl_sim: 0,
        filled_at: new Date().toISOString(),
        _note: 'Local simulation only — no chain, no Privy signature.',
      };
    }
    case 'alpha_radar': {
      const limit = input.limit || 3;
      const items = [
        {
          symbol: 'MOCK1',
          ca: 'So11111111111111111111111111111111111111112',
          mcap: 1_250_000,
          alpha: 72.4,
          tags: ['meme', 'mock'],
        },
        {
          symbol: 'MOCK2',
          ca: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          mcap: 3_400_000,
          alpha: 81.1,
          tags: ['narrative', 'mock'],
        },
        {
          symbol: 'MOCK3',
          ca: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
          mcap: 2_100_000,
          alpha: 65.0,
          tags: ['mock'],
        },
      ].slice(0, Math.min(limit, 3));
      return { ...stubNote(id), data: items };
    }
    case 'alpha_transcript': {
      return {
        ...stubNote(id),
        symbol: input.name || 'MOCK',
        ca: input.ca || 'So11111111111111111111111111111111111111112',
        alpha: 70.0,
        milestones: ['$1M pool entry (mock)', 'renounced (mock)'],
        narrative: 'Placeholder narrative — wire School.fun Alpha API later.',
        social: {
          x_mentions_24h: null,
          narrative_tags: [],
          kol_handles: [],
          sentiment: null,
        },
      };
    }
    case 'token_security': {
      requireFields(input, ['ca'], id, {
        ca: 'So11111111111111111111111111111111111111112',
      });
      return {
        ...stubNote(id),
        ca: input.ca,
        renounced: true,
        blacklist: false,
        tax: 0,
        top10: 22.5,
      };
    }
    case 'trade_quote': {
      requireFields(input, ['pair', 'side', 'size'], id, {
        pair: 'SOL/USDC',
        side: 'buy',
        size: 1,
      });
      const size = Number(input.size);
      const price = 148.2;
      const fee = size * price * 0.001;
      return {
        ...stubNote(id),
        pair: input.pair,
        side: input.side,
        size,
        price,
        fee,
        est_fill: price,
      };
    }
    case 'vault_list': {
      return {
        ...stubNote(id),
        data: [
          {
            pool: 'Public Alpha Pool (mock)',
            apr: 12.5,
            tvl: 850_000,
            alpha_score: 78,
            operator: 'school.fun',
          },
        ],
      };
    }
    default: {
      return { ...stubNote(id), input };
    }
  }
}

module.exports = {
  skillsPath,
  loadSkillsContract,
  listSkills,
  findSkill,
  runSkill,
  normalizeAliases,
};
