# goop TUI design system

The visual rules every goop screen follows. There are no code design sources yet (no theme file, no
component library), so this system is **derived from the approved artboards** below. Every value
here is copied from them; nothing is invented. When code gets a theme module, it must match these
tokens or this file must be synced again.

| Key       | Source path                                     | What it shows                                                |
| --------- | ----------------------------------------------- | ------------------------------------------------------------ |
| `04`      | `design/tui-main/04-opencode-session.html`      | Session: chat, offers sidebar, composer states, status lines |
| `05`      | `design/tui-main/05-home.html`                  | Home screen and first-run steps                              |
| `06`      | `design/tui-main/06-session-idle.html`          | Session with nothing running (no Agents section)             |
| `M2`      | `design/tui-offer-detail/01-full-screen.html`   | Offer detail, full screen; inline ask                        |
| `M3`      | `design/tui-full-text/01-full-screen.html`      | Full offer text; search matches, toast                       |
| `M4`      | `design/tui-sessions/01-full-screen.html`       | Sessions list; rename row                                    |
| `M5`      | `design/tui-rules/01-full-screen.html`          | Rules with the decision card                                 |
| `M6`      | `design/tui-settings/01-full-screen.html`       | Settings; form rows                                          |
| `M7`      | `design/tui-sources/01-full-screen.html`        | Sources; full-screen layout, tabs, heartbeat                 |
| `M8`      | `design/tui-models/01-full-screen.html`         | Models; problem banner, memory map                           |
| `M9`      | `design/tui-profile/01-full-screen.html`        | Profile; source-line marker                                  |
| `M10`     | `design/tui-security-alert/01-full-screen.html` | Security alert                                               |
| `M11`     | `design/tui-confirm/01-dialog.html`             | Confirmations; bordered box, toast                           |
| `M12`     | `design/tui-help/01-full-screen.html`           | Help; version in the status line                             |
| `M13`     | `design/tui-privacy/01-full-screen.html`        | Privacy; problems first, M11 box                             |
| `M14`     | `design/tui-agents/01-full-screen.html`         | Agents tree                                                  |
| `palette` | `design/tui-command-palette/01-dialog.html`     | ctrl+p command palette                                       |
| `W0`      | `design/tui-onboarding/03-w0-welcome.html`      | Setup: welcome                                               |
| `W1`      | `design/tui-onboarding/01-w1-system-check.html` | Setup frame, step list, warning and error banners            |
| `W2`      | `design/tui-onboarding/02-w2-models.html`       | Setup: models; fit badges, download in zone 3                |
| `W3`      | `design/tui-onboarding/04-w3-download.html`     | Setup: download; block meter, paused state                   |
| `W4`      | `design/tui-onboarding/05-w4-benchmark.html`    | Setup: benchmark                                             |
| `W5`      | `design/tui-onboarding/06-w5-security.html`     | Setup: security; secret shown once, blocked primary key      |
| `W6`      | `design/tui-onboarding/07-w6-cv-profile.html`   | Setup: CV and profile                                        |
| `W7`      | `design/tui-onboarding/08-w7-preferences.html`  | Setup: preferences; `n` next step, skipped step              |
| `W8`      | `design/tui-onboarding/09-w8-schedule.html`     | Setup: schedule; install disclosure block                    |
| `W9`      | `design/tui-onboarding/10-w9-done.html`         | Setup: done; live state in zone 3                            |
| `logo.ts` | `src/shared/brand/model/logo.ts`                | Logo palette and pixel grid                                  |

**Terminal:** one monospace cell grid; the app cannot choose the font, the terminal does. The CSS
font stack in the artboards (`--mono: ui-monospace, "Cascadia Code", "JetBrains Mono", Menlo,
Consolas, monospace`) is only a stand-in for the terminal font. Pixel sizes, paddings and widths
in the artboards are approximations of cells; in code they become rows and columns.

The rendered reference is [`system.html`](system.html).

## Color tokens

Components use only these semantic tokens (opencode roles). Sources: `04` and `06` define all
16; `05` defines the subset it uses with the same values.

| Token                  | Value     | Usage                                                                                   |
| ---------------------- | --------- | --------------------------------------------------------------------------------------- |
| `--background`         | `#14110f` | Screen background; text color inside filled chips (`.chip.warn`, `.chip.err`, `.alert`) |
| `--background-panel`   | `#1b1714` | Sidebar, composer, thought block, highlighted popup row                                 |
| `--background-element` | `#251e19` | User turn, popup, selected row, mini meters, chat scrollbar track                       |
| `--text`               | `#f4ede6` | Body text, names, bold keys, streaming caret                                            |
| `--text-muted`         | `#a89c91` | Meta, hints, counts, thinking text, idle/queued state, sidebar scrollbar thumb          |
| `--primary`            | `#ff7a2e` | goop: flame marker, model name, wordmark, selection edge, first-run markers             |
| `--accent`             | `#ffc24a` | Reasoning level, `NEW` badge, items to act on (`1 to review`), tip dot                  |
| `--secondary`          | `#7cc4ff` | Focus dot of the offers pane and every full screen; tiles for search and sources        |
| `--user`               | `#b9a6ff` | You: user turn edge and `›`, composer edge, prompt, cursor, popup edge, chat focus dot  |
| `--success`            | `#8fd694` | Apply score, `✓` done, tool result count, context meter, sources ok                     |
| `--warning`            | `#ffc24a` | Maybe score, `◐` busy, live speed, warn chip, busy focus dot                            |
| `--error`              | `#ff5f7a` | Low score (check/skip), error chip, status line alert                                   |
| `--info`               | `#7cc4ff` | Defined; no component in the artboards uses it yet                                      |
| `--border`             | `#3a302a` | Sidebar edge, thought and tool card edges, blurred composer edge, tree branches, `│`    |
| `--border-active`      | `#ff7a2e` | Chat scrollbar thumb (opacity .55)                                                      |
| `--border-subtle`      | `#2a231f` | Separators: top strip, Agents section, sidebar foot, status line top edge               |

Logo palette (source `logo.ts`, also inlined in `05`). Only the logo uses it; it shares hues with
the tokens above.

| Name     | Value     | Matches token                  |
| -------- | --------- | ------------------------------ |
| `pink`   | `#ff5f7a` | `--error`                      |
| `orange` | `#ff7a2e` | `--primary`, `--border-active` |
| `yellow` | `#ffc24a` | `--accent`, `--warning`        |
| `eye`    | `#fffaf3` | none (logo only)               |
| `pupil`  | `#1a1412` | none (logo only)               |

Artboard frame only, never in the app: page `#000`, notes panel `#0c0a09` with text `#b3a79c` and
`#f4ede6`, notes font `system-ui` (`04`, `05`, `06`).

## Color semantics

| Color    | Token(s)                       | Means                                                              | Source           |
| -------- | ------------------------------ | ------------------------------------------------------------------ | ---------------- |
| Orange   | `--primary`, `--border-active` | goop and the brand; selection (inset left edge); model name        | `04`, `05`       |
| Lavender | `--user`                       | You: your turns, composer edge, prompt `›`, cursor, chat focus dot | `04`, `05`, `M4` |
| Green    | `--success`                    | Apply, ok, done                                                    | `04`, `06`       |
| Yellow   | `--warning`, `--accent`        | Maybe, new, busy/running, reasoning level, things to review        | `04`, `05`       |
| Pink     | `--error`                      | Errors and alerts; low scores (check, skip)                        | `04`             |
| Blue     | `--secondary`                  | Offers and full-screen focus (status line dot); search, sources    | `04`, `M7`       |
| Gray     | `--text-muted`                 | Muted text, queued, idle, waiting, think off                       | `04`, `05`, `06` |

## Typography

Monospace only. A terminal has one font size, so the artboard sizes are roles, not sizes.

| Role   | Artboard size | Line height | Terminal rendering          | Used for                                                         | Source     |
| ------ | ------------- | ----------- | --------------------------- | ---------------------------------------------------------------- | ---------- |
| normal | 15px          | 1.5         | Cell size, `--text`         | Chat text, offer titles, composer input                          | `04`, `05` |
| normal | 14px          | 1.5         | Cell size                   | Popup rows, home recent activity, tip                            | `04`, `05` |
| dim    | 13px          | 1.5         | Cell size, `--text-muted`   | Meta, thought, tool cards, speed line, counts, status line, `h2` | `04`, `05` |
| small  | 12px          | 1.5         | Cell size, bold or muted    | `NEW` badge, sidebar foot                                        | `04`       |
| brand  | 28px, 800     | 1.5         | Cell size, bold `--primary` | `goop` wordmark on home                                          | `05`       |

| Style           | Rule                                                                                                  | Source           |
| --------------- | ----------------------------------------------------------------------------------------------------- | ---------------- |
| Bold (600)      | Keys (`enter`, `?`), names, numbers in the speed line                                                 | `04`, `05`       |
| Key color       | Bold `--text` everywhere, inside content too (toasts, asks, tab hints, inline keys); never `--accent` | `04`, `M7`, `M8` |
| Bold (700)      | Prompt `›`, scores, `NEW`                                                                             | `04`             |
| Section headers | Uppercase, `letter-spacing: .08em`, 13px, 600, `--text-muted`                                         | `04`, `05`       |
| Italic          | Thinking text only (`.think`); its "… N lines hidden" line is not italic                              | `04`             |
| Strikethrough   | Completed first-run steps                                                                             | `05`             |

## Glyphs

| Glyph               | Meaning                                                               | Color                                              | Source           |
| ------------------- | --------------------------------------------------------------------- | -------------------------------------------------- | ---------------- |
| `›`                 | Prompt and user turn marker                                           | `--user`                                           | `04`, `05`       |
| `●`                 | Ok / sources up; focus label dot; tip dot; flame fallback             | per meaning                                        | `04`, `05`       |
| `◐`                 | Running, busy, writing; current setup step                            | `--warning`                                        | `04`, `W1`       |
| `○`                 | Queued, waiting, idle, next search; setup step to do; paused download | `--text-muted`                                     | `04`, `06`, `W3` |
| `✓`                 | Tool call or agent done; setup step, check or file done               | `--success`                                        | `04`, `W1`       |
| `✔`                 | Offer verdict "apply"                                                 | inherits row sub text                              | `04`             |
| `~`                 | Offer verdict "maybe"                                                 | inherits row sub text                              | `04`             |
| `✕`                 | Offer verdict "skip"                                                  | inherits row sub text                              | `04`             |
| `✕`                 | Failed check or file (setup)                                          | `--error`                                          | `W1`, `W3`       |
| `⚠`                 | Suspicious text, secret removed, model not responding                 | per chip                                           | `04`             |
| `⚠`                 | Problem banner: warning / error                                       | `--warning` / `--error`                            | `W1`, `M8`       |
| `↵`                 | Enter key in key hints (setup, palette, confirmations)                | bold `--text`, like every key                      | `W1`, `palette`  |
| `▾` / `▸`           | Open / folded section or thought; `▸` also marks recent-activity rows | `--text-muted` (`--primary` selected)              | `04`, `05`       |
| `├` `└`             | Agents tree branches                                                  | `--border`                                         | `04`             |
| `│`                 | Separator between right-zone items in the status line                 | `--border`                                         | `04`, `05`       |
| `·`                 | Separator inside a line                                               | inherits                                           | all              |
| `→`                 | Tool result                                                           | `--text-muted`                                     | `04`             |
| `◇` `◈` `◆`         | Reasoning level low / medium / high; `think off` text when off        | `--accent` (off: `--text-muted`)                   | `04`, `05`       |
| `↓`                 | Download or update in progress                                        | `--text-muted` (percent in `--text`)               | `M8`             |
| `—`                 | Not applicable (e.g. no reasoning level, no speed)                    | `--text-muted`                                     | `M8`             |
| `—`                 | Skipped setup step, with a muted `skipped` tag                        | `--text-muted`                                     | `W7`, `W9`       |
| `█` `░`             | Block meter: done / remaining cells                                   | `--warning` (paused `--text-muted`) / `--border`   | `W3`             |
| `▮`                 | Heartbeat cell: one past run (ok / slow / failed / not run)           | `--success` / `--warning` / `--error` / `--border` | `M7`             |
| `✎`                 | Profile: corrected by you (your correction wins over the CV)          | `--user`                                           | `M9`             |
| `✓` `~` (profile)   | Profile: read from the CV and confirmed / goop is not sure            | `--success` / `--accent`                           | `M9`             |
| U+F06D (nf-fa-fire) | goop turn marker; falls back to `●` without a Nerd Font               | `--primary`                                        | `04`             |
| Scrollbar thumb     | One cell on the right edge                                            | see Scrollbars                                     | `04`             |

## Layout and spacing

Values at a 1440 × 900 artboard.

| Element            | Rule                                                                                                  | Source      |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ----------- |
| Session grid       | `grid-template-columns: 1fr 420px`, rows `1fr auto` (status line)                                     | `04`, `06`  |
| Session column     | Padding `20px 28px 12px`; title margin-bottom 18px                                                    | `04`        |
| Chat history       | Gap 16px between turns; padding-right 14px (scrollbar room)                                           | `04`        |
| goop turn          | Grid `2ch 1fr` (marker column), row gap 6px                                                           | `04`        |
| Sidebar            | Padding `20px 20px 12px`, gap 14px between sections; 1px `--border` left edge                         | `04`        |
| Sidebar section    | Gap 6px; offer row padding `6px 8px`, grid `3ch 1fr auto`, column gap 10px                            | `04`        |
| Top status strip   | Gap 8px, padding-bottom 12px; line gap 12px; mini meter 70 × 6px                                      | `04`        |
| Agents tree        | Grid `2ch 1.5ch 9ch 1fr auto`, gap 6px, row gap 2px; padding-top 10px                                 | `04`        |
| Status line        | Height 28px (`line-height: 28px`); grid `auto 1fr auto`, gap 14px; 28px side insets                   | `04`, `05`  |
| Composer (session) | Padding `10px 16px`; info line margin-top 6px                                                         | `04`        |
| Toast              | Padding `6px 12px`, gap 12px; one line (`white-space: nowrap`)                                        | `M3`, `M11` |
| Problem banner     | Margin `0 28px 14px`, padding `6px 14px`, gap 24px; 14px text, 13px muted hint                        | `M8`        |
| Setup frame        | Panes `360px 1fr`, padding `0 28px 12px`                                                              | `W1`        |
| Setup panes        | Step list padding-right 20px, 1px `--border` right edge; body padding-left 24px, gap 14px             | `W1`        |
| Popup              | Width 460px, 4px above the composer, padding `6px 0`, rows `2px 14px`, grid `14ch 1fr`                | `04`        |
| Home column        | Centered, gap 22px; composer, recent and tip 720px wide                                               | `05`        |
| Home composer      | Padding `14px 18px`                                                                                   | `05`        |
| Recent activity    | Rows `3px 10px`, grid `2ch 1fr auto`, gap 2px                                                         | `05`        |
| First-run panel    | Two columns, padding `22px 28px`                                                                      | `05`        |
| Edges              | User turn 3px; composer and popup 2px; thought, tool card, sidebar 1px; selection and toast inset 2px | `04`, `M3`  |

No rounded corners and no shadows except inset edges (selection, toast).

## Component rules

**User turn** (`04`). Filled `--background-element` block, 3px `--user` left edge, padding
`8px 14px`. Text starts with a bold lavender `› `. Meta line below: `you · 10:42`, dim.

**goop turn** (`04`). Plain text in a `2ch 1fr` grid, opened by the flame marker in `--primary`
(Nerd Font U+F06D, `●` fallback). Nested in order:
- Thought head: `▾ Thought for 2.4s · ◆ high · ctrl+t` (dim, `Thought` bold); `▸` when folded.
  It names the reasoning level used.
- Thought block: `--background-panel`, 1px `--border` left edge, italic dim text; shows the last
  lines while streaming and `… N lines hidden`.
- Tool card: 1px `--border` left edge, dim; head `✓ name · 0.3s` with `ctrl+o` on the right,
  then arguments and `→ <b>8 matches</b>` (count in `--success`).
- Reply text; while streaming, a `--text` block caret ends it.
- Speed line: `model · prefill N tok/s · output N tok/s · in → out tok · time`, dim with bold
  numbers. While writing: `◐ writing` and the live number in `--warning`, plus `esc stop`.

**Composer** (`04`, `05`). No box: `--background-panel` with a 2px `--user` left edge; grows from
1 to ~6 lines. Line: bold `›`, input, lavender block cursor (blinks; static under
`prefers-reduced-motion`). Info line below, dim and split left/right:
- Left: `model · reasoning · device · state`, model in bold `--primary`, reasoning in `--accent`
  (`think off` muted).
- Right: hints for the state, including `ctrl+r reasoning` (cycles the level).

| State               | Input line                                 | Info line                                                                      |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------------------ |
| Empty               | cursor + muted placeholder                 | `gpt-oss-20b · ◈ medium · CPU · ready`                                         |
| Typing              | typed text + cursor                        | `… · ready` · `ctrl+r reasoning · enter send · esc close`                      |
| Popup / suggestions | `/r` typed; popup above                    | as typing                                                                      |
| Answering           | muted `goop is answering…`                 | `… · answering` · `esc stop`                                                   |
| Secret removed      | text with `[SECRET_1]`                     | `.chip.warn` `⚠ 1 secret removed` · `never sent to a model`                    |
| CPU busy            | typed text                                 | `Qwen3.5 · think off · GPU ·` `.chip.busy` `CPU busy, using Qwen3.5`           |
| Blur                | muted `›`, `tab to write`; `--border` edge | `focus is on the offers`                                                       |
| Model error         | placeholder                                | `.chip.err` `⚠ Qwen3.5 not responding · /models` · `chat still on gpt-oss-20b` |

Popup (`04`): `--background-element`, 2px `--user` edge, 460px; rows `command  description`; the
highlighted row has `--background-panel` and a lavender command.

**Sidebar** (`04`, `06`). `--background-panel`, sections ordered from the job search to goop's
internals:
- Top status strip: `ctx 2.1K/6K`, context mini meter (`--success`), search state (`◐ search 25%`
  busy or `○ next search 09:00` idle), `● 5 sources` ok; `--border-subtle` line below.
- Sections Offers → Rules → Search → Profile. Head: uppercase `h2` with `▾`/`▸` and a dim count on
  the right; a count that needs action uses `--accent` (`1 to review · /rules`).
- The offer list takes only the rows it needs, up to the free height; spare rows fall to the
  bottom. Below it: `8 of 8 · enter to open the list`.
- Folded sections show only the head and the count.
- Agents tree, last, only while something runs (gone entirely in `06`, no title, no separator):
  run line `◐ Daily search · 09:00  4m 12s`, then `├`/`└` children with state glyph, name, what,
  time; `enter · /agents` in the head.
- Foot: `local · encrypted` and `ctrl+x b hide`, 12px, `--border-subtle` line above.

**Offer row** (`04`). Grid `3ch 1fr auto`: bold right-aligned score, title, optional `NEW`
(`--accent`, 12px, bold). Sub line, dim: `company · place · verdict`. Score color by verdict:
`--success` apply (`✔ apply`), `--warning` maybe (`~ maybe`), `--error` check/skip
(`⚠ suspicious text`, `✕ skip`).

**Status line** (`04`, `05`, `06`, `M7`, `M8`, `M11`, `M12`). 28px high, `--border-subtle` top
edge, one line (`white-space: nowrap`), three zones:
1. Focus label: `● word`, bold lowercase; dot `--user` chat/home, `--secondary` offers and every
   full screen, `--warning` answering, `--error` alert/confirm (`M10`, `M11`).
2. Keys of the focused pane only: bold `--text` key, muted action, `·` between; the primary
   action key may be `--success`. This is the only key line on any screen: no key-hint row under
   a header or title and no `ctrl+p all actions` hint (`M7`, `M8`, `M14`).
3. Background state, then help (`│` in `--border`). By default `○ next search 09:00 │ ? help`,
   never `○ next 09:00`. A live busy state replaces `○ next search 09:00` in the first slot:
   `◐ searching 25%` (`04`), `◐ 1 running` (`M14`), `◐ first search starting` (`W9`). Help shows
   the version instead of `? help`: `○ next search 09:00 │ v0.1.0` (`M12`); home shows it in
   addition: `○ next search 09:00 │ v0.1.0 │ ? help` (`05`). During setup no search is scheduled
   yet, so zone 3 is only `? help`, or the download while it runs:
   `↓ 13.4 of 31.8 GB · 18 MB/s · 17m │ ? help` (paused: `↓ paused · 13.4 of 31.8 GB`) (`W1`–`W9`).
   Error: `.alert` chip (`--error` background, `--background` text, bold, padding `0 8px`),
   `⚠ Qwen3.5-9B not responding · /models`.

**Chips** (`04`). Inline, padding `0 6px`. `warn`: `--warning` background, `--background` text.
`err`: `--error` background, `--background` text. `busy`: text only in `--warning`.

**Scrollbars** (`04`). One cell on the right edge (4px in the artboard). Chat history: track
`--background-element` and thumb `--border-active` at opacity .55. Sidebar: thumb only
(`--text-muted`, opacity .4, inset 3px), and only while its content overflows.

**Home** (`05`). Centered column: logo (24 × 29 pixel grid from `logo.ts`, half blocks in the
terminal), `goop` wordmark in `--primary`, tagline `your local job search agent` (muted), composer
(720px, rotating placeholder), recent activity list (`▸` rows with `enter`; arrows move;
new items in `--accent`), one rotating tip (`● Tip …` with `--accent` dot). Status line: `home`,
`enter open · ↑↓ move · / commands · ctrl+p commands`, `○ next search 09:00 │ v0.1.0 │ ? help`.
First run replaces recent activity with numbered steps (markers `--primary`; done struck
through and muted; current in `--text` with `← now`; later muted) until a CV and a search exist.

**Focus and selection** (`04`, `05`). The selected row gets `--background-element` and an inset
2px `--primary` left edge (`box-shadow: inset 2px 0 var(--primary)`): offer rows, agents tree,
recent activity (its `▸` turns `--primary`). Typing focus is lavender (composer edge); without
focus the composer edge is `--border`.

**Lavender scope** (`04`, `M4`). `--user` is only for you typing or your own content (turns,
composer, cursor, `✎` corrections, the value you edit). A row being renamed or edited looks like
the composer (`--background-panel`, 2px `--user` left edge, lavender cursor); a selection is never
lavender, it stays the orange inset edge.

**Toast** (`M3`, `M11`). One line after a done action: `--background-panel`, inset 2px
`--success` left edge (`box-shadow: inset 2px 0 var(--success)`), `display: flex;
justify-content: space-between; white-space: nowrap`. Left `✓ text` (`✓` in `--success`), right
`ctrl+z undo · 4s` or `ctrl+z undo`, key bold `--text`. Undo is always `ctrl+z`, never `u`; when
the action cannot be undone (copy, open, export, a confirmed delete) the right side shows only
the timer (`4s`).

**Ask** (`M2`, `M6`, `M11`). One inline line for reversible actions only:
`--background-panel` fill, 2px `--accent` left edge (never `--primary`), question bold `--text`,
options `y yes · n no`, or verbs that name the outcome (`y cancel · n keep`), or numbered choices,
with bold `--text` keys. Irreversible actions (delete,
cannot be undone) never use it: they open the M11 bordered box.

**Confirmation levels** (`M11`). Reversible → the inline Ask (or no ask and an undo toast);
costly → the small bordered box with the items that change and `y`/`n` (M11 level 2, `--accent`
tile, `n keep` default); irreversible → the M11 box with what goes, what stays and a
type-to-confirm line (`--error` tile).

**Problem banner** (`M8`, `M13`, `M7`, `W1`, `W3`, `W8`). Problems first: a failing item shows one
banner above the panes, right under the title: `--background-panel`, 2px left edge, `⚠`, then
what failed · what still works; the action key on the right, muted with a bold `--text` key
(`r restart`). One line (`white-space: nowrap`). Two variants:
- Warning: 2px `--warning` edge and a yellow `⚠`, when goop already fixed it or chose a safe
  fallback and nothing blocks you (`Vulkan lists the 780M iGPU first · goop will use the RX 7700S
  (device 1)` with `↵ ok`, `W1`; slow connection, `W3`; no TPM2 → passphrase, `W5`).
- Error: 2px `--error` edge and a pink `⚠`, when something failed: a blocking failure (RAM too
  small, `↵ next` blocked, `W1`) or a stopped part (disk full `W2`, hash mismatch `W3`, model not
  responding `M8`, database changed outside goop `M13`, no systemd user session `W8`).

**Two actions on one key** (`W1`, `W5`, `W7`, `W8`). ↵ is the step's primary key (`↵ next`,
`↵ install timer`) in `--success`. On form steps ↵ edits the selected row (`↵ edit`), so "next
step" moves to `n` (`n next step`, `--success`) (`W7`). A blocked primary key stays in place,
muted and not bold (`↵ next` plain `--text-muted`): until a failing check is resolved (`W1`) or
until the typed group matches (`W5`); then it turns green.

**Setup step list** (`W0`–`W9`). The left pane of every setup step (360px, pane head `Steps` with
a count `1 of 10 done`, or `8 of 10 done · 1 skipped`; foot `you can leave and come back; nothing
is lost`). One row per step, grid `2ch 1fr auto`, column gap 8px, padding `4px 8px`, 14px muted:
- Glyphs: `✓` done (`--success`), `◐` current or running (`--warning`), `○` to do (muted), `—`
  skipped (muted, with a `skipped` tag).
- Tags on the right, 13px muted: `required` / `optional`, plus the live `↓ 42%` (percent bold
  `--text`) on Download while it runs in the background; paused it is `○` with `paused 42%`.
- The current row has only the `--background-element` fill and bold `--text` (tag stays regular),
  no orange edge: the list is progress, not a menu, and never takes focus (↵ next and shift+tab
  back move between steps). The orange inset edge goes to the focused row in the right pane.

**Fit badges** (`W2`). Text in the state color, no fill, 13px, on the right of a model row:
`Fits` `--success` · `May be slow` `--warning` · `Won't fit` `--error`; `· on demand` muted after
the badge.

**Block meter** (`W3`). Per-file download progress drawn with block cells: ten cells, done `█` in
`--warning` while running, rest `░` in `--border`, then the bold percent (`████████░░ 78%`). The
compact `↓` with a percent stays for small places (step tags, zone 3, `M8` lists). Paused: the row
glyph turns `○`, the note says `paused`, the done cells turn `--text-muted`, and the step tag reads
`paused 42%`.

**Secret shown once** (`W5`). A `--background-element` block (padding `10px 16px`) with the secret
in bold (700) `--text`, separators muted and regular, and the part you will type underlined
(`text-underline-offset: 4px`, decoration `--text-muted`). Under it a dim line on why it matters
(`it is shown only during this step`). The status line offers `↵ I saved it` and `c copy key`. `↵` hides the
secret (masked groups, muted, regular weight) before the type-to-confirm line in the composer look
opens (`› type the last group from your copy:` with `group 6 of 6` muted on the right, never the
expected value; `✓ recovery key confirmed` when it matches, `doesn't match · check the last group`
in `--error` when not), so the confirm proves a kept copy, not a read screen. `shift+tab show key
again` replaces `c copy key` while it is hidden.

**Install disclosure** (`W8`). Before a reversible change to your system, a plain block names every
file and command: `--background-panel`, 1px `--border` left edge, padding `10px 14px`, gap 6px,
14px. Head `What it installs on this system` with `nothing changes until you press ↵` on the right;
one line per file and command; the other OS as one muted line; last a 13px muted line over a
`--border-subtle` rule: `nothing runs as root · remove it anytime in /settings or with goop schedule
off`. It is not an ask (↵ in the status line is the answer) and not the M11 box (it is reversible).

**Form rows** (`M6`). Three columns: label, value, muted note. The value being edited is lavender,
because you type it (composer look: `--background-panel`, 2px `--user` edge, lavender cursor).

**Breadcrumb** (`M7`, `M8`). The title line of a full screen:
`Area › <b>current</b> · facts · esc back to <place>`; area and facts muted, current bold `--text`.
No key-hint line below it.

**Pane head** (`M7`, `M13`, `M14`). Uppercase `h2` (13px, `letter-spacing: .08em`, 600,
`--text-muted`) with a short noun; details go in the muted count on the right.

**`● current` tag** (`M6`, `M8`). The tag that marks the item in use is `--text-muted`, dot
included; never green or orange.

**Search matches** (`M3`, `M12`). Matches in text are goop results, so they use `--accent`: bold
`--accent` text; the current match is filled `--accent` with `--background` text. Never lavender,
which is only your query in the search line.

## Self-check for future artboards

Before finishing an artboard while this file exists:
- [ ] Every color is one of the 16 tokens (or the logo palette inside the logo); list them and
  compare. Frame colors (`#000`, notes panel) stay outside the screen.
- [ ] Only the `--mono` stack inside the screen; no other font family.
- [ ] Sizes are only the roles above (15/14 normal, 13 dim, 12 small, 28 wordmark).
- [ ] Orange means goop or selection; lavender means you; no color reused for another meaning.
- [ ] Selection is the inset 2px orange edge on `--background-element` (the command palette
  uses a bold `--primary` label instead, see Command palette); no rounded corners, no shadows
  except inset edges (selection, toast).
- [ ] Glyphs come from the table above; the flame has its `●` fallback. Emoji tiles use only the
  Icon modes mapping (Command palette), with a neutral `--background-element` tile.
- [ ] The status line keeps three zones and 28px.
- [ ] No key-hint line under a header, title or breadcrumb; keys live only in status line zone 2.
- [ ] Keys are bold `--text` everywhere, content included (never `--accent`); only the primary
  action key may be `--success`.
- [ ] The right zone reads `○ next search 09:00 │ ? help` (Help: `│ v0.1.0` instead of
  `? help`; home adds `v0.1.0`), never `○ next 09:00`; a live busy state (`◐ …`) may take the
  first slot; during setup it is `? help` or the download line `↓ … · speed · ETA │ ? help`.
- [ ] A problem banner is warning (`--warning` edge, yellow `⚠`) only when goop fixed it or fell
  back and nothing blocks you; any failure uses the `--error` edge and a pink `⚠`.
- [ ] Setup step list: `✓` `◐` `○` `—` glyphs, `required` / `optional` / `skipped` tags, and the
  current row has a fill and bold text but no orange edge; a blocked primary key is muted, not bold.
- [ ] Lavender only for your typing and your content; no lavender selection edge, no lavender
  search match.
- [ ] Model names follow the naming table; never lowercase `qwen`.
- [ ] Sections that only exist while something runs (Agents) are absent when idle.
- [ ] Motion respects `prefers-reduced-motion`.

## Tabs

One line of tab names separated by `·`, with a count only on list tabs (`Log 48`, `Companies 248`; none on Details, Info or Protection); the active tab is bold `--text` and underlined, the others `--text-muted`; `[` and `]` switch tabs. Source: `M7` (`design/tui-sources/01-full-screen.html`).

## Model and role naming

Screens name models by these exact strings; never lowercase `qwen`. Sources: `M8`, `M14`.

| Role                  | Model                                                    |
| --------------------- | -------------------------------------------------------- |
| Chat and Learner      | gpt-oss-20b                                              |
| Profiler and Analytic | Qwen3.5-9B (`Qwen3.5` allowed in the composer info line) |
| Reranker              | Qwen3-Reranker                                           |
| Security              | gpt-oss-safeguard-20b                                    |

## Source-line marker

When an item comes from untrusted text shown beside it (the CV, an offer), the lines it came from get a 2px `--accent` left marker in the `│` gutter view. It is not a selection: the orange inset edge stays reserved for the selected row. Source: `M9` (`design/tui-profile/01-full-screen.html`).

## Command palette

The ctrl+p palette is a centered box (~600px) on `--background-panel` with a 1px `--text-muted` border on all four sides, no radius and no shadow; modal boxes (the palette and the M11 confirmations) are the only bordered boxes in goop. Inside there is only the search line (lavender cursor, muted placeholder) and a flat list of rows about two lines high. Each row is a 2-cell icon tile, two spaces, then the label. With `icons: nerd` the tile is filled with the color of what the command touches and holds a Nerd Font glyph in `--background`:

| Tile color     | Commands                         |
| -------------- | -------------------------------- |
| `--success`    | Offers                           |
| `--secondary`  | Search, Sources                  |
| `--accent`     | Rules, Profile                   |
| `--primary`    | Agents, Models                   |
| `--text-muted` | Session, Settings, Privacy, Help |
| `--error`      | Quit                             |

Tiles are never lavender.

**Icon modes.** Emoji width depends on the terminal font: goop only uses `Emoji_Presentation=Yes` code points to minimise breakage, but it cannot guarantee 2 cells everywhere. The `icons` setting (Settings, `M6`, Appearance category) picks how every tile is drawn; the tile keeps its place and its 2-cell size in all three, so rows always align:

| Mode              | Tile                                                                                | For                        |
| ----------------- | ----------------------------------------------------------------------------------- | -------------------------- |
| `emoji` (default) | Neutral `--background-element` fill, one emoji centered; no semantic color          | Most terminals             |
| `nerd`            | Filled with the tile color above, Nerd Font glyph in `--background`                 | Terminals with a Nerd Font |
| `letters`         | Filled with the tile color above, the label's first letter, bold, in `--background` | Old terminals, SSH         |

Emoji bring their own colors, so in emoji mode the tile color goes away; label colors stay (pink for destructive). Only code points with `Emoji_Presentation=Yes` (2 cells wide by default, East Asian Width `W`); no VS16 (U+FE0F) sequences, no ZWJ sequences, no skin tones, no flags (so no gear U+2699, wastebasket U+1F5D1 or pencil U+270F, which need VS16). One emoji per command or store, the same in every screen:

| Item                  | Emoji | Code point |
| --------------------- | ----- | ---------- |
| Search now            | 🔍    | U+1F50D    |
| Offers list           | 💼    | U+1F4BC    |
| Saved offers          | 📌    | U+1F4CC    |
| Rules                 | 📋    | U+1F4CB    |
| New / Resume session  | 💬    | U+1F4AC    |
| Agents                | 🤖    | U+1F916    |
| Models                | 🧠    | U+1F9E0    |
| Sources               | 📡    | U+1F4E1    |
| Settings              | 🔧    | U+1F527    |
| Profile and CV        | 👤    | U+1F464    |
| Privacy               | 🔒    | U+1F512    |
| Help                  | ❓    | U+2753     |
| Quit                  | 🚪    | U+1F6AA    |
| Search index          | 📚    | U+1F4DA    |
| Logs                  | 📜    | U+1F4DC    |
| Encrypted database    | 🔐    | U+1F510    |
| Delete / irreversible | ⛔    | U+26D4     |
| Costly / unfollow     | 🔕    | U+1F515    |
| Companies             | 🏢    | U+1F3E2    |

The main frames are drawn with `icons: nerd`; each strip shows an emoji excerpt (palette (c), `M11`, `M13`, `M4`) and the palette also shows `letters` (d).

The selected row has no fill and no edge: its label turns bold `--primary`, and only that row shows its keybind or slash command, right-aligned and muted. The palette has no hint row; its hints live in the status line (`commands` with a `--secondary` dot, `↵ run · ↑↓ move · esc close`). Source: `design/tui-command-palette/01-dialog.html`. Confirmation dialogs (M11, `design/tui-confirm/01-dialog.html`) reuse the same bordered box, tiles and rows, with an `--error` tile for irreversible actions and an `--accent` tile for costly ones.
