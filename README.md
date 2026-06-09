# sapcc-hac-client

> SAP Commerce Cloud HAC client — execute **Groovy scripts** and **FlexibleSearch queries** from your terminal or Node.js code.

[![npm version](https://img.shields.io/npm/v/sapcc-hac-client.svg)](https://www.npmjs.com/package/sapcc-hac-client)
[![npm downloads](https://img.shields.io/npm/dm/sapcc-hac-client.svg)](https://www.npmjs.com/package/sapcc-hac-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-20%20passed-brightgreen)](#running-tests)

---

## Features

| | |
|---|---|
| 🔐 | **Auto-authentication** — full Spring Security cookie + CSRF flow, handled internally |
| 📜 | **Groovy** — inline script, file or stdin; dry-run by default (`--commit` to persist) |
| 🔍 | **FlexibleSearch** — renders results as a rich table or CSV |
| 🌍 | **Credentials from `.env`** — never hard-code passwords |
| 📦 | **Dual-mode** — use as a **CLI** (`npx`) or as a **Node.js library** |
| 🔁 | **Session reuse** — one login per client instance, transparent CSRF refresh |
| 🩺 | **Debug mode** — `--debug` / `HAC_DEBUG=true` dumps the full HTTP exchange |

---

## Quick Start

```bash
# 1. Install globally
npm install -g sapcc-hac-client

# 2. Create .env
cp .env.example .env   # or create manually (see Configuration below)

# 3. Test connectivity
hac ping

# 4. Run a FlexibleSearch
hac fs "SELECT {pk},{version} FROM {CatalogVersion}"

# 5. Run a Groovy script
hac groovy "return spring.beanDefinitionNames.size()"
```

No global install? Use `npx`:

```bash
npx sapcc-hac-client ping
```

---

## Installation

```bash
# Global CLI
npm install -g sapcc-hac-client

# Project dependency
npm install sapcc-hac-client
```

---

## Configuration — `.env`

Create a `.env` file in your project root:

```dotenv
# Required
HAC_URL=https://backoffice.your-env.commerce.ondemand.com
HAC_USERNAME=admin
HAC_PASSWORD=your_password

# Optional
HAC_IGNORE_SSL=false     # true for self-signed certs (dev/staging)
HAC_TIMEOUT=30000        # request timeout in ms
HAC_DEBUG=false          # true to dump full HTTP exchange
```

> 💡 `HAC_URL` can include or omit the `/hac` suffix — both work.  
> 🔒 Add `.env` to `.gitignore` — never commit credentials.

---

## CLI Reference

### Global options

```
--env-file <path>   Path to .env file          [env: HAC_ENV_FILE]
--url <url>         HAC base URL               [env: HAC_URL]
--user <username>   HAC username               [env: HAC_USERNAME]
--pass <password>   HAC password               [env: HAC_PASSWORD]
--ignore-ssl        Ignore SSL errors          [env: HAC_IGNORE_SSL]
--timeout <ms>      Request timeout (ms)       [env: HAC_TIMEOUT]
--json              Raw JSON output
--debug             Verbose HTTP logging       [env: HAC_DEBUG]
--verbose           Verbose error stack trace
-v, --version       Show version
```

---

### `hac ping`

Test authentication and connectivity.

```bash
hac ping
hac --url https://hac.example.com --user admin --pass secret ping
```

---

### `hac groovy [script]`

Execute a Groovy script on the HAC.

```
Arguments:
  [script]                 Inline Groovy script

Options:
  -f, --file <path>        Path to a .groovy file
  --commit                 Commit DB transaction (default: dry-run / rollback)
  --script-type <type>     groovy | beanshell  (default: groovy)
```

**Examples:**

```bash
# Inline
hac groovy "return spring.beanDefinitionNames.size()"

# From file
hac groovy --file scripts/findProduct.groovy

# From stdin
cat scripts/migrate.groovy | hac groovy

# Commit a data modification
hac groovy --file scripts/updatePrices.groovy --commit

# Raw JSON output
hac groovy "return [version: '1.0']" --json
```

**Sample script:**

```groovy
// scripts/findProduct.groovy
def result = flexibleSearchService.search(
  "SELECT {pk},{code} FROM {Product} WHERE {code} = 'MY_PRODUCT'"
)
result.result.each { item ->
  println "PK: ${item.pk}  code: ${item.code}"
}
return "Found ${result.result.size()} product(s)"
```

---

### `hac flexsearch [query]` · alias `hac fs`

Execute a FlexibleSearch query.

```
Arguments:
  [query]                  Inline FlexibleSearch query

Options:
  -f, --file <path>        Path to query file (.fxs, .sql, .txt)
  --max-count <n>          Max rows fetched from HAC     (default: 200)
  --max-rows <n>           Max rows shown in table       (default: 50, 0 = all)
  --user <u>               User context                  (default: admin)
  --locale <l>             Localisation locale           (default: en)
  --csv                    Output as CSV
```

**Examples:**

```bash
# Inline
hac fs "SELECT {pk},{code},{name} FROM {Product}"

# From file
hac fs --file queries/pending-orders.fxs

# Export as CSV
hac fs "SELECT {pk},{code},{price} FROM {Product}" --csv > products.csv

# Fetch 1 000 rows, display all
hac fs "SELECT {pk} FROM {Product}" --max-count 1000 --max-rows 0

# French locale
hac fs "SELECT {pk},{name} FROM {Category}" --locale fr
```

---

## Node.js API

```js
const { createClient } = require('sapcc-hac-client');

// Reads .env automatically from cwd / project root
const client = createClient();

// Explicit .env path
const client = createClient({ envPath: './config/.env.prod' });

// Direct credentials (no .env)
const client = createClient({
  hacUrl:    'https://backoffice.xxx.commerce.ondemand.com',
  username:  'admin',
  password:  'secret',
  ignoreSSL: false,
  timeout:   60_000,
});
```

### `client.executeGroovy(script, options?)`

```js
const result = await client.executeGroovy(`
  def products = flexibleSearchService
    .search("SELECT {pk},{code} FROM {Product}")
    .result
  return "Found: ${products.size()}"
`);

console.log(result.success);          // boolean
console.log(result.executionResult);  // return value of the script
console.log(result.outputText);       // println() output
console.log(result.stacktrace);       // error stacktrace (if any)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `commit` | boolean | `false` | Commit DB transaction |
| `scriptType` | string | `'groovy'` | `'groovy'` or `'beanshell'` |

### `client.executeFlexSearch(query, options?)`

```js
const result = await client.executeFlexSearch(
  "SELECT {pk},{code},{name} FROM {Product}",
  { maxCount: 500, locale: 'fr' }
);

console.log(result.success);        // boolean
console.log(result.resultCount);    // total row count
console.log(result.executionTime);  // ms
console.log(result.headers);        // ['PK', 'code', 'name']
console.log(result.rows);           // [['8796...', 'CODE', 'Name'], ...]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxCount` | number | `200` | Max rows returned |
| `user` | string | `'admin'` | User context |
| `locale` | string | `'en'` | Localisation locale |

### Result types

```ts
// Groovy
interface GroovyResult {
  success:         boolean;
  executionResult: string | null;   // script return value
  outputText:      string | null;   // println() output
  stacktrace:      string;          // error stacktrace or ''
}

// FlexibleSearch
interface FlexSearchResult {
  success:        boolean;
  resultCount:    number;
  executionTime:  number | null;    // ms
  headers:        string[];
  rows:           string[][];
  error?:         string;           // present if success=false
}
```

---

## Authentication Flow (internals)

```
1. GET  /hac/login                     → seed JSESSIONID + ROUTE cookies + CSRF meta
2. POST /hac/j_spring_security_check   → authenticated session (maxRedirects:0)
         j_username, j_password, _csrf
         ← captures new JSESSIONID from Set-Cookie on the 302
3. GET  /hac/console/scripting         → fresh CSRF token for each operation
4. POST /hac/console/scripting/execute → execute Groovy
         or
   GET  /hac/console/flexsearch        → fresh CSRF token
   POST /hac/console/flexsearch/execute → execute FlexibleSearch
```

Session cookies are **managed manually** (no third-party cookie library).  
CSRF token is refreshed before each operation. Session expiry triggers transparent re-authentication.

---

## Examples

### Batch report

```js
// scripts/export-products.js
const { createClient } = require('sapcc-hac-client');
const fs = require('fs');

const client = createClient();

const { headers, rows } = await client.executeFlexSearch(
  "SELECT {pk},{code},{name} FROM {Product}",
  { maxCount: 10_000 }
);

const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
fs.writeFileSync('products.csv', csv);
console.log(`Exported ${rows.length} products`);
```

### Inspect Spring beans

```bash
hac groovy --file examples/groovy/list-services.groovy
```

### CronJob status

```bash
hac groovy --file examples/groovy/cronjob-status.groovy
```

### Pending orders

```bash
hac fs --file examples/flexsearch/pending-orders.fxs --max-rows 20
```

---

## Project Structure

```
sapcc-hac-client/
├── bin/
│   └── hac.js                ← CLI entry point  (npx / global)
├── src/
│   ├── index.js              ← Public API  (createClient)
│   ├── HacClient.js          ← Core: auth + Groovy + FlexSearch
│   ├── config.js             ← .env loader with auto-discovery
│   └── formatters.js         ← CLI output: tables, CSV, colours, spinner
├── tests/
│   └── HacClient.test.js     ← 20 unit tests (Jest)
├── examples/
│   ├── groovy/               ← list-services, find-products, cronjob-status
│   └── flexsearch/           ← all-products, active-customers, pending-orders
├── .env.example
├── CHANGELOG.md
└── package.json
```

---

## Running Tests

```bash
npm test
npm run test:coverage
```

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.  
See [CHANGELOG.md](CHANGELOG.md) for the release history.

---

## License

[MIT](LICENSE) © Youssef El Jaoujat
