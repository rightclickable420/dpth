# Contributing to dpth.io

Thanks for your interest in contributing! dpth.io is an open-source project and we welcome contributions of all kinds.

## Getting Started

```bash
git clone https://github.com/rightclickable420/dpth.git
cd dpth
npm install
npm run build
npm test
```

## Development

```bash
npm run dev    # Watch mode (rebuild on changes)
npm test       # Run all tests (smoke + integration)
npm run build  # Build to dist/
```

## Project Structure

```
src/
├── entity.ts        # Entity resolution across data sources
├── correlation.ts   # Cross-source pattern detection
├── temporal.ts      # Time-native storage with history
├── embed.ts         # Semantic embeddings and search
├── agent-sdk.ts     # Client SDK for agents joining the network
├── fallback.ts      # Centralized inference fallback
├── economics.ts     # Credit system and rate limiting
├── federation.ts    # Federated learning coordinator
├── types.ts         # Shared type definitions
├── index.ts         # Main entry point (re-exports all)
└── api/             # Next.js API routes (not in npm package)

test/
├── smoke.ts         # Unit tests for each module
└── integration.ts   # Full agent lifecycle test

examples/
├── demo-agent.ts    # Minimal demo agent
└── inference-agent.ts  # Real Ollama-powered inference agent
```

## Making Changes

1. Fork the repo and create a branch
2. Make your changes
3. Run `npm run build` — must pass with zero errors
4. Run `npm test` — all tests must pass
5. Commit with a clear message (we follow [Conventional Commits](https://www.conventionalcommits.org/))
6. Open a PR against `main`

## Commit Messages

```
feat: add new module
fix: correct entity resolution edge case
docs: update PROTOCOL.md
test: add federation integration tests
chore: update dependencies
```

## What We're Looking For

- **Bug fixes** — found something broken? Fix it!
- **Tests** — more test coverage is always welcome
- **Documentation** — clearer docs, better examples
- **New modules** — have an idea for a new capability? Open an issue first to discuss
- **Performance** — profiling, optimization, benchmarks

## Code Style

- TypeScript strict mode
- ESM imports with `.js` extensions (for Node16 module resolution)
- No external runtime dependencies for core library
- Each module should be self-contained with its own tests

## Questions?

Open an issue or start a discussion. We're friendly.

---

*Built by humans and agents, working together.*
