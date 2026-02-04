# Changelog

## 0.4.0 (2026-02-04)

### Breaking Changes
- Experimental modules (agent-sdk, federation, economics, fallback) moved to `dpth/experimental`
  - Old imports: `import { DpthAgent } from 'dpth/agent-sdk'`
  - New imports: `import { DpthAgent } from 'dpth/experimental'`
- `EntityType` is now `string` (was closed union). Use `ENTITY_TYPES` constants for well-known types.
- `configure()`, `getAdapter()`, `resetAdapter()` are deprecated. Use `dpth()` factory instead.
- Standalone entity/temporal/correlation functions are deprecated. Use `dpth()` API.
- SQLite adapter: `transaction()` removed. Use `transactionSync()` (matches better-sqlite3's synchronous model).

### New Features
- **Object-style `resolve()`**: `db.entity.resolve({ type, name, source, externalId, email, attributes })`
  - Legacy positional args still work (deprecated, removed in v1.0)
- **Error classes**: `DpthError`, `ValidationError`, `EntityNotFoundError`, `StorageError`, `AdapterCapabilityError`
  - Input validation on all public methods with descriptive error messages
- **Email index**: O(1) entity matching by email (was O(n) full scan)
- **Candidate blocking**: Large entity sets (>500) narrowed by first-letter + length before Levenshtein
- **`putBatch()`**: Bulk write operations in a single SQLite transaction
- **`history()` pagination**: `db.temporal.history(key, { limit, offset })`
- **`ENTITY_TYPES` constants**: Well-known types as `const` object

### Performance
- **SQLite queries use `json_extract()`**: Filtering pushed to SQL engine instead of loading all rows into JS. ~100x faster for filtered queries at scale.
- **Computed JSON indexes**: Entity type and email fields indexed in SQLite for fast lookups.
- **Snapshot index eliminated**: `history()` uses query-based lookup instead of growing JSON array blob. Constant-time writes (was O(n) read-modify-write).
- **Correlation cap**: Metrics capped at 10,000 data points (prevents unbounded memory growth).
- **Graceful fallback**: SQLite adapter falls back to JS filtering if `json_extract` unavailable (SQLite < 3.38).

### Other
- **Cross-platform crypto**: Uses Web Crypto API (`globalThis.crypto`) instead of Node.js `crypto`. Works in Node 19+, Deno, Bun, browsers, Cloudflare Workers.
- **Barrel export cleaned**: `index.ts` only exports core modules. Experimental modules via `dpth/experimental`.
- **Package keywords updated**: Focused on entity-resolution, data-matching, temporal-data (was: decentralized, distributed, p2p).
- **190 tests** (was 171).

## 0.3.0 (2026-02-03)

- Unified `dpth()` factory API
- Storage adapter system (memory, SQLite, vector)
- VectorOverlay pattern
- 171 tests

## 0.2.0 (2026-02-03)

- Storage adapters: MemoryAdapter, SQLiteAdapter, MemoryVectorAdapter
- `better-sqlite3` as optional peer dependency
- 124 tests

## 0.1.0 (2026-02-03)

- Initial release
- Entity resolution, temporal history, correlation detection
- Agent SDK, federation, economics (now in experimental)
- 86 tests
