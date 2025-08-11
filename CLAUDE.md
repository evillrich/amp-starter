# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build Commands
- `pnpm build` - Build all packages using TypeScript project references
- `pnpm clean` - Clean all build artifacts
- `pnpm dev` or `pnpm amp` - Run the CLI in development mode with ts-node

### Package Management
- This is a pnpm monorepo with workspaces in `packages/*` and `apps/*`
- Node.js version requirement: >=20 <21
- Package manager: pnpm@10.14.0

### Running the CLI
- Development: `pnpm dev <command>` or `pnpm amp <command>`
- The CLI entry point is `apps/cli/src/index.ts`
- Data is stored in `.amp` directory by default (configurable with `--data` flag)

## Architecture Overview

### Monorepo Structure
The project uses a layered architecture with clear separation of concerns:

1. **Core Interfaces** (`packages/engine-spi/`)
   - Defines the Service Provider Interface (SPI) for engines, models, storage, and logging
   - Key interfaces: `AgentEngine`, `ModelProvider`, `StorageBundle`, `RunLogger`, `AgentContext`

2. **SDK** (`packages/sdk/`)
   - Re-exports SPI interfaces for convenience
   - Provides utilities like `createAgentContext()` and `randId()`
   - Serves as the main API surface for consumers

3. **Storage Layer**
   - `packages/storage/` - Storage abstractions
   - `packages/storage-sqlite/` - SQLite implementation using better-sqlite3 and Drizzle ORM
   - Handles projects, artifacts, and versioning

4. **Engine & Model Providers**
   - `packages/engine-basic/` - Basic agent engine implementation
   - `packages/model-provider/` - Model provider implementations (currently EchoModel)

5. **Content Handlers**
   - `packages/content-handlers-text/` - Text content processing
   - `packages/content-handlers-csv/` - CSV content processing

6. **Logging**
   - `packages/logger-file/` - File-based run logger implementation

7. **CLI Application** (`apps/cli/`)
   - Main entry point for the amp command
   - Commands: `project` (create, list, show), `artifact` (add, history, export), `run`

### Key Design Patterns
- **Dependency Injection**: All external dependencies (storage, logger, model) are injected through the `AgentContext`
- **Project-based Organization**: All data is organized under projects with unique IDs (format: `proj_<timestamp>_<random>`)
- **Artifact Versioning**: Files can be versioned as artifacts within projects
- **Run Logging**: Each execution creates a run log file in `.amp/runs/<projectId>/<runId>.log`

### TypeScript Configuration
- Uses TypeScript project references for build optimization
- Base config in `tsconfig.base.json` with ES2022 target and CommonJS modules
- Each package has its own `tsconfig.json` extending the base
- Build orchestration through `tsconfig.build.json`