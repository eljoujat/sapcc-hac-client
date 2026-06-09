#!/usr/bin/env node
'use strict';

const { Command, Option } = require('commander');
const fs                  = require('fs');
const path                = require('path');
const chalk               = require('chalk');

const { createClient }                          = require('../src/index');
const { printGroovyResult, printFlexSearchResult, printError, withSpinner } = require('../src/formatters');

const pkg = require('../package.json');

// ─────────────────────────────────────────────────────────────────────────────
//  Root program
// ─────────────────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('hac')
  .description(
    chalk.bold('SAP Commerce Cloud HAC CLI\n') +
    chalk.dim('Execute Groovy scripts and FlexibleSearch queries against a HAC endpoint.')
  )
  .version(pkg.version, '-v, --version')
  .addOption(new Option('--env-file <path>',   'Path to .env file').env('HAC_ENV_FILE'))
  .addOption(new Option('--url <url>',         'HAC base URL').env('HAC_URL'))
  .addOption(new Option('--user <username>',   'HAC username').env('HAC_USERNAME'))
  .addOption(new Option('--pass <password>',   'HAC password').env('HAC_PASSWORD'))
  .addOption(new Option('--ignore-ssl',        'Ignore SSL certificate errors').env('HAC_IGNORE_SSL'))
  .addOption(new Option('--timeout <ms>',      'Request timeout in ms (default: 30000)').env('HAC_TIMEOUT').default('30000'))
  .addOption(new Option('--json',              'Output raw JSON'))
  .addOption(new Option('--debug',             'Affiche les requêtes HTTP internes (HAC_DEBUG=true)').env('HAC_DEBUG'))
  .addOption(new Option('--verbose',           'Verbose error output'));

// ─────────────────────────────────────────────────────────────────────────────
//  groovy command
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('groovy')
  .description('Execute a Groovy script on the HAC')
  .argument('[script]', 'Inline Groovy script (or use --file)')
  .option('-f, --file <path>',   'Path to a .groovy script file')
  .option('--commit',            'Commit DB transaction (default: dry-run)')
  .option('--script-type <type>','Script type: groovy | beanshell (default: groovy)', 'groovy')
  .option('--csv',               'Output result as CSV (when result is tabular)')
  .action(async (inlineScript, opts, cmd) => {
    const globalOpts = program.opts();

    try {
      const script = resolveScript(inlineScript, opts.file, 'groovy');
      const client = buildClient(globalOpts);

      const result = await withSpinner(
        `Executing Groovy on ${maskUrl(globalOpts.url || process.env.HAC_URL || '…')} …`,
        () => client.executeGroovy(script, {
          commit:     !!opts.commit,
          scriptType: opts.scriptType,
        })
      );

      printGroovyResult(result, { json: !!globalOpts.json });

      if (!result.success) process.exit(1);

    } catch (err) {
      printError(err, { verbose: !!globalOpts.verbose });
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
//  flexsearch command
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('flexsearch')
  .alias('fs')
  .description('Execute a FlexibleSearch query on the HAC')
  .argument('[query]', 'Inline FlexibleSearch query (or use --file)')
  .option('-f, --file <path>',   'Path to a .fxs / .sql / .txt query file')
  .option('--max-count <n>',     'Max rows returned (default: 200)', '200')
  .option('--max-rows <n>',      'Max rows displayed in table (0 = all, default: 50)', '50')
  .option('--user <u>',         'User context for the query (default: admin)', 'admin')
  .option('--locale <l>',        'Locale for localised attributes (default: en)', 'en')
  .option('--csv',               'Output as CSV instead of table')
  .action(async (inlineQuery, opts, cmd) => {
    const globalOpts = program.opts();

    try {
      const query  = resolveScript(inlineQuery, opts.file, 'flexsearch');
      const client = buildClient(globalOpts);

      const result = await withSpinner(
        `Running FlexibleSearch on ${maskUrl(globalOpts.url || process.env.HAC_URL || '…')} …`,
        () => client.executeFlexSearch(query, {
          maxCount: parseInt(opts.maxCount, 10),
          user:     opts.user,
          locale:   opts.locale,
        })
      );

      printFlexSearchResult(result, {
        json:    !!globalOpts.json,
        csv:     !!opts.csv,
        maxRows: parseInt(opts.maxRows, 10),
      });

      if (!result.success) process.exit(1);

    } catch (err) {
      printError(err, { verbose: !!globalOpts.verbose });
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
//  ping command (smoke test)
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('ping')
  .description('Test authentication and connectivity to the HAC')
  .action(async (_opts, cmd) => {
    const globalOpts = program.opts();

    try {
      const client = buildClient(globalOpts);
      await withSpinner(
        `Connecting to ${maskUrl(globalOpts.url || process.env.HAC_URL || '…')} …`,
        () => client.authenticate()
      );
      console.log(chalk.green('\n✔  Connected successfully!\n'));
    } catch (err) {
      printError(err, { verbose: !!globalOpts.verbose });
      process.exit(1);
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the script/query from inline arg or file.
 */
function resolveScript(inline, filePath, type) {
  if (filePath) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`File not found: ${resolved}`);
    }
    return fs.readFileSync(resolved, 'utf8');
  }

  if (inline && inline.trim()) {
    return inline.trim();
  }

  // Read from stdin if piped
  if (!process.stdin.isTTY) {
    return fs.readFileSync('/dev/stdin', 'utf8');
  }

  throw new Error(
    `No ${type} input provided.\n` +
    `  Inline:  hac ${type} "your script"\n` +
    `  File:    hac ${type} --file path/to/script\n` +
    `  Stdin:   echo "script" | hac ${type}`
  );
}

/**
 * Build HacClient from resolved CLI options.
 */
function buildClient(opts) {
  if (opts.debug) process.env.HAC_DEBUG = 'true';
  return createClient({
    envPath:   opts.envFile,
    hacUrl:    opts.url,
    username:  opts.user,
    password:  opts.pass,
    ignoreSSL: opts.ignoreSsl,
    timeout:   opts.timeout ? parseInt(opts.timeout, 10) : undefined,
  });
}

/**
 * Mask password-bearing URL for display.
 */
function maskUrl(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}`;
  } catch {
    return url;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
program.parseAsync(process.argv).catch((err) => {
  printError(err);
  process.exit(1);
});
