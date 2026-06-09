'use strict';

const chalk   = require('chalk');
const Table   = require('cli-table3');

// ─── Groovy ──────────────────────────────────────────────────────────────────

/**
 * Print Groovy execution result to stdout.
 * @param {object} result - result from HacClient.executeGroovy()
 * @param {object} [opts]
 * @param {boolean} [opts.json=false] - raw JSON output
 */
function printGroovyResult(result, { json = false } = {}) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const icon = result.success ? chalk.green('✔') : chalk.red('✘');
  console.log(`\n${icon}  ${chalk.bold('Groovy execution')} ${result.success ? chalk.green('SUCCESS') : chalk.red('FAILED')}`);

  if (result.outputText && result.outputText.trim()) {
    console.log(`\n${chalk.cyan('── Output ──────────────────────────────')}`);
    console.log(result.outputText.trim());
  }

  if (result.executionResult !== null && result.executionResult !== undefined) {
    const val = String(result.executionResult);
    if (val.trim()) {
      console.log(`\n${chalk.cyan('── Result ──────────────────────────────')}`);
      console.log(val.trim());
    }
  }

  if (result.stacktrace && result.stacktrace.trim()) {
    console.log(`\n${chalk.red('── Stacktrace ──────────────────────────')}`);
    console.log(chalk.red(result.stacktrace.trim()));
  }

  console.log('');
}

// ─── FlexibleSearch ───────────────────────────────────────────────────────────

/**
 * Print FlexibleSearch result as a table (or JSON).
 * @param {object} result - result from HacClient.executeFlexSearch()
 * @param {object} [opts]
 * @param {boolean} [opts.json=false]   - raw JSON output
 * @param {boolean} [opts.csv=false]    - CSV output
 * @param {number}  [opts.maxRows=0]    - truncate display (0 = all)
 */
function printFlexSearchResult(result, { json = false, csv = false, maxRows = 0 } = {}) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.success) {
    console.error(chalk.red(`\n✘  FlexibleSearch FAILED:\n${result.error}`));
    return;
  }

  const rows = maxRows > 0 ? result.rows.slice(0, maxRows) : result.rows;

  if (csv) {
    printCsv(result.headers, rows);
    return;
  }

  const meta = [
    chalk.green('✔  FlexibleSearch SUCCESS'),
    `   ${chalk.bold('Rows:')} ${result.resultCount}`,
    result.executionTime
      ? `   ${chalk.bold('Time:')} ${result.executionTime} ms`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  console.log(`\n${meta}\n`);

  if (result.headers.length === 0 || rows.length === 0) {
    console.log(chalk.yellow('   (no results)'));
    console.log('');
    return;
  }

  const table = new Table({
    head:  result.headers.map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
    wordWrap: true,
  });

  rows.forEach((row) => {
    table.push(row.map((cell) => (cell === null || cell === undefined ? chalk.dim('NULL') : String(cell))));
  });

  console.log(table.toString());

  if (maxRows > 0 && result.resultCount > maxRows) {
    console.log(chalk.dim(`\n   … ${result.resultCount - maxRows} more row(s) not shown (use --max-rows to adjust)`));
  }

  console.log('');
}

function printCsv(headers, rows) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  console.log(headers.map(escape).join(','));
  rows.forEach((row) => console.log(row.map(escape).join(',')));
}

// ─── Error ────────────────────────────────────────────────────────────────────

function printError(err, { verbose = false } = {}) {
  console.error(`\n${chalk.red('✘  Error:')} ${err.message}`);
  if (verbose && err.stack) {
    console.error(chalk.dim(err.stack));
  }
  console.error('');
}

// ─── Spinner helper ───────────────────────────────────────────────────────────

async function withSpinner(text, fn) {
  // ora is ESM-only in v6+, we use v5 (CJS)
  const ora = require('ora');
  const spinner = ora({ text, color: 'cyan' }).start();
  try {
    const result = await fn();
    spinner.stop();
    return result;
  } catch (err) {
    spinner.fail(text);
    throw err;
  }
}

module.exports = {
  printGroovyResult,
  printFlexSearchResult,
  printError,
  withSpinner,
};
