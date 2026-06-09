'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Loads .env configuration for the HAC client.
 * Resolution order (first found wins):
 *   1. Explicit envPath passed as argument
 *   2. .env in current working directory
 *   3. .env in the caller's project root (walk up until package.json or .git)
 */
function loadConfig(envPath) {
  const dotenv = require('dotenv');

  // 1. Explicit path
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`[sapcc-hac-client] .env file not found at: ${resolved}`);
    }
    dotenv.config({ path: resolved });
  } else {
    // 2. .env in cwd
    const cwdEnv = path.join(process.cwd(), '.env');
    if (fs.existsSync(cwdEnv)) {
      dotenv.config({ path: cwdEnv });
    } else {
      // 3. Walk up to find project root
      const rootEnv = findEnvFile(process.cwd());
      if (rootEnv) {
        dotenv.config({ path: rootEnv });
      }
    }
  }

  const config = buildConfig();
  validate(config);
  return config;
}

/**
 * Builds the config object from process.env (already loaded via dotenv or CI env vars).
 */
function buildConfig() {
  return {
    hacUrl: (process.env.HAC_URL || '').replace(/\/$/, ''),
    username: process.env.HAC_USERNAME || '',
    password: process.env.HAC_PASSWORD || '',
    ignoreSSL: process.env.HAC_IGNORE_SSL === 'true',
    timeout: parseInt(process.env.HAC_TIMEOUT || '30000', 10),
  };
}

function validate(config) {
  const missing = [];
  if (!config.hacUrl)   missing.push('HAC_URL');
  if (!config.username) missing.push('HAC_USERNAME');
  if (!config.password) missing.push('HAC_PASSWORD');

  if (missing.length > 0) {
    throw new Error(
      `[sapcc-hac-client] Missing required environment variables: ${missing.join(', ')}\n` +
      `Copy .env.example to .env and fill in the values.`
    );
  }
}

/**
 * Walk up directories looking for a .env file, stopping at filesystem root,
 * .git dir or package.json boundary.
 */
function findEnvFile(startDir) {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root

    // Stop at project boundary
    if (
      fs.existsSync(path.join(dir, '.git')) ||
      fs.existsSync(path.join(dir, 'package.json'))
    ) {
      break;
    }
    dir = parent;
  }
  return null;
}

module.exports = { loadConfig, buildConfig, validate };
