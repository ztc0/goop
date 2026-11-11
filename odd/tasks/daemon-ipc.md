# daemon and IPC (goop T17)

goop's two modes, `goop` (TUI) and `goop daemon`, and the private channel between them. Branch `feat/daemon-ipc` from `dev` `eb51ff9`. Built in mentor mode: the maintainer writes the code, step by step.

## Specs

- S1: "Commands: `goop` (TUI), `goop daemon` (service); config directory `goop`." (goop.md S2)
- S2: "one executable with two modes talking JSON-RPC 2.0 over a Unix socket / Windows named pipe." (goop.md S11)
- S3: "The daemon owns the models, the queue and the database; the TUI never touches them directly." (`architecture.md`)
- S4: "Validate every external payload with zod and enforce size limits" (`security.md`): every JSON-RPC message is checked with zod and has a maximum size.
- S5: Only processes of the same user can open the channel; no other user can read or write it. Linux: the socket lives in a 0700 folder (`GOOP_RUNTIME_DIR`, `.temp/run/` in development, goop.md S26). Windows: "an FFI pipe with an owner-only DACL, `FILE_FLAG_FIRST_PIPE_INSTANCE` and `PIPE_REJECT_REMOTE_CLIENTS`, non-blocking." (goop.md L61)
- S6: Before it sends anything, the TUI checks that the other end belongs to the same user (on Windows a pipe name can be taken first by another user: `GetNamedPipeServerProcessId` and the owner SID, T15a).
- S7: The daemon unlocks the vault; the TUI asks the user for the passphrase or recovery key and sends it to the daemon over the channel. Secrets never reach a log (AGENTS.md rule 7).
- S8: A, D and E do not know whether the channel is a socket or a pipe: one port, one adapter per system.

## Tasks

| ID  | Specs      | Task                                                                                       | Route  | Commit                    |
| --- | ---------- | ------------------------------------------------------------------------------------------ | ------ | ------------------------- |
| T1  | S2, S4     | A: JSON-RPC 2.0 messages: types, zod schemas, a maximum size, parse and build (pure)       | inline | 4b8f895                   |
| T2  | S5, S8     | B: the channel port and the Linux adapter (socket in a 0700 folder)                        | inline | 3fb581c, 8904317, 1af1067 |
| T3  | S1, S3     | D: `goop` and `goop daemon`, talking over the channel on Linux                             | inline | -                         |
| T4  | S7         | E: unlocking the vault from the TUI through the daemon                                     | inline | -                         |
| T5  | S5, S6, S8 | C: the Windows adapter (FFI pipe, owner-only DACL, server owner check), real run in the VM | inline | -                         |

## Log

- L1: "podemos seguir para delantar trabajo", then "antes de continuar usa la skill de maestro juinor". In mentor mode the maintainer chose the order "d,a,e,b,c"; the mentor explained that E travels over the channel, so it goes after it, and D first only works as a walking skeleton. Agreed order: A -> B -> D -> E -> C. The maintainer explained back why A, D and E must not know the channel: "por que es una sola logica".
- L2: "ok puede hacerlo tu es decir tu implemantas y lo revisamos juntos como me dijeste pero tu lo implemtas ya que no tengo tiempo": the mentor implements and explains; the maintainer reviews. zod 4.6.7 became the first runtime dependency (`f73d415`) with `THIRD_PARTY_LICENSES.md` and a test that lists every runtime dependency there. T1 in `4b8f895`: RED on the missing module, then 19 tests (four kinds of message, parse and invalid-request errors, the 1 MiB limit counted in UTF-8 bytes and checked before parsing, no error repeats its input).
- L3: T2 in three commits: `3fb581c` (newline-delimited framing; `encodeMessage` also refuses a message that is not JSON-RPC, T1 review R3), `8904317` (the channel port, S8, and the runtime folder: `GOOP_RUNTIME_DIR`, else `$XDG_RUNTIME_DIR/goop`, a 107-byte socket path limit, and the owner and mode check) and `1af1067` (the Linux adapter on `Bun.listen`/`Bun.connect` with `unix`). RED before each step: 6 encode tests that did not throw, then the missing `encodeFrame`, `ChannelError` and `unixSocketChannel` exports. 15 integration tests against a real socket under `.temp/tests/`: round trip, notification, two messages in one chunk and one split inside "ñ", invalid input delivered as `ok:false` with no echo, a frame over 1 MiB closes the connection, folder 0700 and socket 0600, a 0750 folder and a symbolic link refused and left unchanged, a stale socket from a SIGKILLed daemon replaced, a second daemon refused, a non-socket `goop.sock` refused, 107 bytes bound and 108 refused, the socket removed on close. Another owner is checked in the pure model (no root). Mutations (no chmod, no oversize close, no running check, no folder check, no partial-write queue) each failed a test. Suite: 582 pass. Open: `scripts/dev-env/run.ts` creates `.temp/run/` with the default 0755, which this adapter refuses; T3 must create it 0700.
- L4: T2 native review (tier high; risk, resilience, reliability) needed two bounded corrections, both test-first with a real RED: `371d31b` (two daemons starting at once after a crash both listened, `["ok","ok"]`; now an exclusive `flock` on `goop.lock` lets only one claim the socket) and `b14538d` (a runtime-folder symlink spelled `run/` passed the symlink check; trailing separators are stripped first). The targeted validation was stuck on a Pi facade defect until Gentle Shell 4.7.0 (Pi 1.5.2); then it approved. Advisories for later: `close` drops a frame still pending, and the send queue has no bound (`unix-socket-channel.ts:60-64`). Open for T3: `scripts/dev-env/run.ts` creates `.temp/run/` 0755, which the adapter refuses.
