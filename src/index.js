'use strict';

/**
 * sapcc-hac-client – Public programmatic API
 *
 * Usage as a Node.js dependency:
 *
 *   const { createClient } = require('sapcc-hac-client');
 *
 *   const client = createClient();          // reads from process.env / .env
 *   // or
 *   const client = createClient({ envPath: '/path/to/.env' });
 *   // or (no .env, pass config directly)
 *   const client = createClient({
 *     hacUrl:   'https://backoffice.xxx.commerce.ondemand.com',
 *     username: 'admin',
 *     password: 'secret',
 *   });
 *
 *   // Execute Groovy
 *   const result = await client.executeGroovy(`
 *     def ps = spring.getBean('productService')
 *     return ps.getProductForCode(catalogVersion, 'MY_CODE')
 *   `);
 *
 *   // Execute FlexibleSearch
 *   const result = await client.executeFlexSearch(
 *     "SELECT {pk} FROM {Product} WHERE {code} = 'MY_CODE'"
 *   );
 */

const HacClient  = require('./HacClient');
const { loadConfig, buildConfig } = require('./config');

/**
 * Create a configured HacClient instance.
 *
 * @param {object} [opts]
 * @param {string}  [opts.envPath]   - Explicit path to .env file
 * @param {string}  [opts.hacUrl]    - Override HAC_URL
 * @param {string}  [opts.username]  - Override HAC_USERNAME
 * @param {string}  [opts.password]  - Override HAC_PASSWORD
 * @param {boolean} [opts.ignoreSSL] - Override HAC_IGNORE_SSL
 * @param {number}  [opts.timeout]   - Override HAC_TIMEOUT (ms)
 * @returns {HacClient}
 */
function createClient(opts = {}) {
  let config;

  const hasDirectConfig = opts.hacUrl && opts.username && opts.password;

  if (hasDirectConfig) {
    // Caller provides all credentials explicitly – skip .env loading
    config = {
      hacUrl:    opts.hacUrl.replace(/\/$/, '').replace(/\/hac$/, ''),
      username:  opts.username,
      password:  opts.password,
      ignoreSSL: opts.ignoreSSL ?? false,
      timeout:   opts.timeout  ?? 30000,
    };
  } else {
    // Load from .env / environment variables
    config = loadConfig(opts.envPath);
    // Allow partial overrides
    if (opts.hacUrl)    config.hacUrl    = opts.hacUrl.replace(/\/$/, '').replace(/\/hac$/, '');
    if (opts.username)  config.username  = opts.username;
    if (opts.password)  config.password  = opts.password;
    if (opts.ignoreSSL !== undefined) config.ignoreSSL = opts.ignoreSSL;
    if (opts.timeout)   config.timeout   = opts.timeout;
  }

  return new HacClient(config);
}

module.exports = {
  createClient,
  HacClient,
};
