# Architecture rules

## Screaming Architecture with hexagonal layers

Top-level folders under `src/` name business features, not technologies: `offers`, `discovery`, `profile`, `matching`, `chat`, `scheduler`, `models`, `learner`. `src/shared/` holds what two or more features use, and `src/interfaces/` holds the entry points (`daemon`, `tui`).

Inside a feature, create only the layers it needs, when it needs them:

| Folder                              | Holds                                                 | May depend on                          |
| ----------------------------------- | ----------------------------------------------------- | -------------------------------------- |
| `types/`                            | Types and interfaces only, no logic                   | nothing                                |
| `model/`                            | Pure domain logic, no I/O                             | `types/`                               |
| `services/`                         | Use cases that orchestrate model and adapters         | `types/`, `model/`, adapter interfaces |
| `adapters/`                         | The outside world: APIs, SQLite, files, model servers | `types/`, `model/`                     |
| `tests/unit/`, `tests/integration/` | Tests of this feature only                            | anything in the feature                |
| `index.ts`                          | The feature's only public entry                       | its own folders                        |
- `model/` never imports from `adapters/`.
- `adapters/` stays flat while it has one kind of adapter; it gets subfolders when a second kind appears (for example `offers/adapters/sources/` and `offers/adapters/storage/`).

## Scope rule

- Used by one feature: it lives in that feature.
- Used by two or more features: it moves to `src/shared/`.
- Tests that span several features live in the root `tests/integration/` or `tests/e2e/`.

### Shared modules

- `src/shared/` is a library of modules, each named for what it does: `vault`, `dev`, `brand`. Never a role name such as `lib`, `core`, `common` or `utils`.
- Each module has only the layers it needs (the table above) and its own `index.ts` as its only public entry.
- Features and other modules import a module only through `@/shared/<module>`, never its internals; modules never import each other in a cycle.
- A module made of parts that only make sense together groups them as submodules, each with its own `index.ts`. `vault` holds `keys` (the data key and its envelopes), `keystore` (the OS key store), `storage` (the encrypted store) and `native` (pinned native libraries). Submodules reach each other through `@/shared/vault/<submodule>`; everything outside `vault` imports only `@/shared/vault`. A submodule another module starts to need moves up to its own module.
- There is no `src/shared/index.ts`.

## Imports

- Use the `@/` alias for imports from `src/`: `import { devLayout } from "@/shared/dev"`.
- Another feature is imported only through its `index.ts`: `@/offers`, never `@/offers/model/dedupe`.
- Inside a feature, relative imports are fine.

## Process model

One executable, two modes: `goop` (TUI) and `goop daemon` (service). They talk JSON-RPC 2.0 over a Unix socket or a Windows named pipe. The daemon owns the models, the queue and the database; the TUI never touches them directly.
