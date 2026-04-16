'use strict';

const { createClient } = require('redis');

const DEFAULT_REDIS_KEY = 'canastra-online:state:v1';

function resolveRedisStateKey() {
  const baseKey = process.env.REDIS_STATE_KEY || DEFAULT_REDIS_KEY;
  const includeMode = process.env.REDIS_STATE_KEY_INCLUDE_MODE !== 'false';
  if (!includeMode) return baseKey;

  const mode = process.env.DEV_MODE === 'true' ? 'dev' : 'prod';
  return `${baseKey}:${mode}`;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function buildRedisUrlFromEnv() {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;

  const host = process.env.REDIS_HOST;
  if (!host) return null;

  const port = parsePositiveInt(process.env.REDIS_PORT, 6379);
  const db = parsePositiveInt(process.env.REDIS_DB, 0);
  const password = process.env.REDIS_PASSWORD;

  const auth = password ? `:${encodeURIComponent(password)}@` : '';
  return `redis://${auth}${host}:${port}/${db}`;
}

function createRedisPersistence(logger = console) {
  const redisUrl = buildRedisUrlFromEnv();
  const key = resolveRedisStateKey();
  const connectTimeoutMs = parsePositiveInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 3000);
  const saveIntervalMs = parsePositiveInt(process.env.REDIS_SAVE_INTERVAL_MS, 2000);

  let client = null;
  let enabled = false;
  let initAttempted = false;

  async function init() {
    initAttempted = true;
    if (!redisUrl) {
      logger.log('[Redis] Disabled: REDIS_URL or REDIS_HOST not set.');
      return false;
    }

    client = createClient({ url: redisUrl, socket: { connectTimeout: connectTimeoutMs } });
    client.on('error', (err) => {
      logger.warn(`[Redis] Connection error: ${err.message}`);
    });

    try {
      await client.connect();
      enabled = true;
      logger.log(`[Redis] Connected. Persistence key: ${key}`);
      return true;
    } catch (err) {
      enabled = false;
      logger.warn(`[Redis] Unavailable. Running in memory mode: ${err.message}`);
      try {
        await client.quit();
      } catch {
        // ignore cleanup errors
      }
      client = null;
      return false;
    }
  }

  function isEnabled() {
    return enabled;
  }

  function getSaveIntervalMs() {
    return saveIntervalMs;
  }

  async function loadState() {
    if (!enabled || !client) return null;
    try {
      const raw = await client.get(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      logger.warn(`[Redis] Could not load state: ${err.message}`);
      return null;
    }
  }

  async function saveState(state) {
    if (!enabled || !client) return false;
    try {
      await client.set(key, JSON.stringify(state));
      return true;
    } catch (err) {
      logger.warn(`[Redis] Could not save state: ${err.message}`);
      return false;
    }
  }

  async function close() {
    if (!client) return;
    try {
      await client.quit();
    } catch {
      // ignore
    } finally {
      client = null;
      enabled = false;
    }
  }

  return {
    init,
    isEnabled,
    getSaveIntervalMs,
    loadState,
    saveState,
    close,
    get redisConfigured() {
      return !!redisUrl;
    },
    get initAttempted() {
      return initAttempted;
    },
  };
}

module.exports = { createRedisPersistence };
