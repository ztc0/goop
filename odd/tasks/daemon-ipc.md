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

| ID  | Specs      | Task                                                                                       | Route  | Commit  |
| --- | ---------- | ------------------------------------------------------------------------------------------ | ------ | ------- |
| T1  | S2, S4     | A: JSON-RPC 2.0 messages: types, zod schemas, a maximum size, parse and build (pure)       | inline | 4b8f895 |
| T2  | S5, S8     | B: the channel port and the Linux adapter (socket in a 0700 folder)                        | inline | -       |
| T3  | S1, S3     | D: `goop` and `goop daemon`, talking over the channel on Linux                             | inline | -       |
| T4  | S7         | E: unlocking the vault from the TUI through the daemon                                     | inline | -       |
| T5  | S5, S6, S8 | C: the Windows adapter (FFI pipe, owner-only DACL, server owner check), real run in the VM | inline | -       |

## Log

- L1: "podemos seguir para delantar trabajo", then "antes de continuar usa la skill de maestro juinor". In mentor mode the maintainer chose the order "d,a,e,b,c"; the mentor explained that E travels over the channel, so it goes after it, and D first only works as a walking skeleton. Agreed order: A -> B -> D -> E -> C. The maintainer explained back why A, D and E must not know the channel: "por que es una sola logica".
- L2: "ok puede hacerlo tu es decir tu implemantas y lo revisamos juntos como me dijeste pero tu lo implemtas ya que no tengo tiempo": the mentor implements and explains; the maintainer reviews. zod 4.6.7 became the first runtime dependency (`f73d415`) with `THIRD_PARTY_LICENSES.md` and a test that lists every runtime dependency there. T1 in `4b8f895`: RED on the missing module, then 19 tests (four kinds of message, parse and invalid-request errors, the 1 MiB limit counted in UTF-8 bytes and checked before parsing, no error repeats its input).
