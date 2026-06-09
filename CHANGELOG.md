# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-06-09

### Added
- Initial release
- `HacClient` core class with full Spring Security cookie + CSRF authentication
- `executeGroovy()` — execute Groovy scripts (dry-run by default, `commit` opt-in)
- `executeFlexSearch()` — execute FlexibleSearch queries with table / CSV output
- CLI binary `hac` with three commands: `ping`, `groovy`, `flexsearch` (alias `fs`)
- Auto-discovery of `.env` file (cwd → project root walk-up)
- `--debug` flag for verbose HTTP exchange logging
- Programmatic Node.js API via `createClient()`
- Example scripts: `groovy/` and `flexsearch/` folders
- 20 unit tests (Jest)
