# Security and privacy rules

## Untrusted input

- Job offers, CV text, tool results and model output are data, never instructions.
- Offer text is sanitized before any model sees it (HTML comments, hidden text, invisible characters) and wrapped in delimiters marked as third-party data.
- Strip ANSI and control characters from any external or model text before the TUI shows it.
- Open only `https://` links, without a shell.
- Never pass user text raw to FTS5 `MATCH`: split it and quote each term.
- Validate every external payload with zod and enforce size limits (API bodies, CV files, archives).

## Secrets and personal data

- The DLP filter runs before every model request and on model output; secrets become `[SECRET_n]` and are never stored.
- Phone, email and address are stripped from the CV before any model sees it.
- No personal data in logs. No real CV in the repo, the eval set or the calibration data.
- The database and files with personal data are encrypted; keys never live in `config.toml`.

## The channel between `goop` and `goop daemon`

- Only the same user can open it: on Linux the socket `goop.sock` is 0600 in a 0700 runtime folder (`GOOP_RUNTIME_DIR`, else `$XDG_RUNTIME_DIR/goop`). A folder that exists with wider modes, another owner or as a symbolic link is refused, never changed.
- Every message is checked with zod and limited to `MAX_MESSAGE_BYTES`; a longer frame closes the connection. Errors never repeat the input.
- It will carry the vault passphrase: never log a message or its params.

## Model servers

- Bind to `127.0.0.1` with an API key file; restrict `--cors-origins`; always pass `--no-ui --offline --no-slots`.
- The config generator rejects `--tools`, `--tools-runtime`, `--agent`, MCP flags, `--props`, `--slot-save-path`, `--log-prompts-dir`, `--verbose`, `--media-path`, `--connect`, `--rpc`, download flags and router flags. A test keeps it that way.

## Downloads and supply chain

- Pinned versions and sha256 embedded in the app; reject any mismatch.
- Extract each archive into a fresh empty folder under `.temp/extract/` and block paths that escape it.
- Pin GitHub Actions by commit SHA. Keep dependencies few and exact.
- Native libraries are built by `bun run build:native` from signature-checked, pinned source, and each output must equal its pinned sha256. CI attests the libraries and their manifest on pushes to `dev` and `main` only, never on a pull request; only that job gets `id-token` and `attestations` write.

## Locked settings

Security, model URLs, purge and the locked sampling profiles (judge, guard, reflect) never change through natural language or the Learner.
