'use strict';

const config = require('./config');

/**
 * Thin School.fun gateway client.
 * Prefixes SCHOOL_API_BASE, attaches x-org-id / x-tenant-id / Bearer JWT.
 * Never invents credentials; never hits order endpoints from here.
 */

function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  const p = String(path || '').replace(/^\/+/, '');
  return `${b}/${p}`;
}

function buildHeaders(extra = {}) {
  const env = config.gatewayEnv();
  const session = config.load();
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...extra,
  };
  if (env.orgId) headers['x-org-id'] = env.orgId;
  if (env.tenantId) headers['x-tenant-id'] = env.tenantId;

  const jwt = session.jwt || process.env.SCHOOL_JWT || null;
  if (jwt) headers.Authorization = `Bearer ${jwt}`;

  return headers;
}

/**
 * @param {string} path  e.g. "/time" or "query/markets"
 * @param {object} [opts]
 * @param {string} [opts.method]
 * @param {object} [opts.body]  JSON body
 * @param {object} [opts.headers]
 * @param {boolean} [opts.auth=true]  attach Bearer when session has jwt
 * @returns {Promise<{ ok: boolean, status: number, data: any, url: string }>}
 */
async function gatewayFetch(path, opts = {}) {
  const env = config.gatewayEnv();
  if (!env.apiBase) {
    throw new Error('SCHOOL_API_BASE is not set');
  }
  const url = joinUrl(env.apiBase, path);
  const method = (opts.method || 'GET').toUpperCase();
  const headers = buildHeaders(opts.headers || {});
  if (opts.auth === false) {
    delete headers.Authorization;
  }

  const init = { method, headers };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  return { ok: res.ok, status: res.status, data, url };
}

/** GET /time — cheap connectivity probe */
async function probeTime() {
  return gatewayFetch('time', { auth: false });
}

/** GET /query/markets — may require org/tenant headers */
async function probeMarkets() {
  return gatewayFetch('query/markets');
}

/**
 * Exchange a Privy access token for a gateway JWT.
 * POST {SCHOOL_API_BASE}/auth/privy  body: { privy_token }
 * Does not invent tokens — caller must supply a real Privy access token.
 */
async function exchangePrivyToken(privyToken) {
  if (!privyToken) {
    throw new Error('privy_token is required');
  }
  return gatewayFetch('auth/privy', {
    method: 'POST',
    auth: false,
    body: { privy_token: privyToken },
  });
}

module.exports = {
  joinUrl,
  buildHeaders,
  gatewayFetch,
  probeTime,
  probeMarkets,
  exchangePrivyToken,
};
