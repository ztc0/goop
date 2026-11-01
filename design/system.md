# goop TUI design system

The visual rules every goop screen follows. There are no code design sources yet (no theme file, no
component library), so this system is **derived from the approved artboards** below. Every value
here is copied from them; nothing is invented. When code gets a theme module, it must match these
tokens or this file must be synced again.

| Key       | Source path                                | What it shows                                                |
| --------- | ------------------------------------------ | ------------------------------------------------------------ |
| `04`      | `design/tui-main/04-opencode-session.html` | Session: chat, offers sidebar, composer states, status lines |
| `05`      | `design/tui-main/05-home.html`             | Home screen and first-run steps                              |
| `06`      | `design/tui-main/06-session-idle.html`     | Session with nothing running (no Agents section)             |
| `logo.ts` | `src/shared/model/logo.ts`                 | Logo palette and pixel grid                                  |

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
| `--secondary`          | `#7cc4ff` | Offers focus dot in the status line                                                     |
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
| Lavender | `--user`                       | You: your turns, composer edge, prompt `›`, cursor, chat focus dot | `04`, `05`       |
| Green    | `--success`                    | Apply, ok, done                                                    | `04`, `06`       |
| Yellow   | `--warning`, `--accent`        | Maybe, new, busy/running, reasoning level, things to review        | `04`, `05`       |
| Pink     | `--error`                      | Errors and alerts; low scores (check, skip)                        | `04`             |
| Blue     | `--secondary`                  | Offers focus (status line dot)                                     | `04`             |
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

| Style           | Rule                                                                     | Source     |
| --------------- | ------------------------------------------------------------------------ | ---------- |
| Bold (600)      | Keys in hints (`enter`, `?`), names, numbers in the speed line           | `04`, `05` |
| Bold (700)      | Prompt `›`, scores, `NEW`                                                | `04`       |
| Section headers | Uppercase, `letter-spacing: .08em`, 13px, 600, `--text-muted`            | `04`, `05` |
| Italic          | Thinking text only (`.think`); its "… N lines hidden" line is not italic | `04`       |
| Strikethrough   | Completed first-run steps                                                | `05`       |

## Glyphs

| Glyph               | Meaning                                                               | Color                                              | Source     |
| ------------------- | --------------------------------------------------------------------- | -------------------------------------------------- | ---------- |
| `›`                 | Prompt and user turn marker                                           | `--user`                                           | `04`, `05` |
| `●`                 | Ok / sources up; focus label dot; tip dot; flame fallback             | per meaning                                        | `04`, `05` |
| `◐`                 | Running, busy, writing                                                | `--warning`                                        | `04`       |
| `○`                 | Queued, waiting, idle, next search                                    | `--text-muted`                                     | `04`, `06` |
| `✓`                 | Tool call or agent done                                               | `--success`                                        | `04`       |
| `✔`                 | Offer verdict "apply"                                                 | inherits row sub text                              | `04`       |
| `~`                 | Offer verdict "maybe"                                                 | inherits row sub text                              | `04`       |
| `✕`                 | Offer verdict "skip"                                                  | inherits row sub text                              | `04`       |
| `⚠`                 | Suspicious text, secret removed, model not responding                 | per chip                                           | `04`       |
| `▾` / `▸`           | Open / folded section or thought; `▸` also marks recent-activity rows | `--text-muted` (`--primary` selected)              | `04`, `05` |
| `├` `└`             | Agents tree branches                                                  | `--border`                                         | `04`       |
| `│`                 | Separator between right-zone items in the status line                 | `--border`                                         | `04`, `05` |
| `·`                 | Separator inside a line                                               | inherits                                           | all        |
| `→`                 | Tool result                                                           | `--text-muted`                                     | `04`       |
| `◇` `◈` `◆`         | Reasoning level low / medium / high; `think off` text when off        | `--accent` (off: `--text-muted`)                   | `04`, `05` |
| `↓`                 | Download or update in progress                                        | `--text-muted` (percent in `--text`)               | `M8`       |
| `—`                 | Not applicable (e.g. no reasoning level, no speed)                    | `--text-muted`                                     | `M8`       |
| `▮`                 | Heartbeat cell: one past run (ok / slow / failed / not run)           | `--success` / `--warning` / `--error` / `--border` | `M7`       |
| `✎`                 | Profile: corrected by you (your correction wins over the CV)          | `--user`                                           | `M9`       |
| `✓` `~` (profile)   | Profile: read from the CV and confirmed / goop is not sure            | `--success` / `--accent`                           | `M9`       |
| U+F06D (nf-fa-fire) | goop turn marker; falls back to `●` without a Nerd Font               | `--primary`                                        | `04`       |
| Scrollbar thumb     | One cell on the right edge                                            | see Scrollbars                                     | `04`       |

## Layout and spacing

Values at a 1440 × 900 artboard.

| Element            | Rule                                                                                        | Source     |
| ------------------ | ------------------------------------------------------------------------------------------- | ---------- |
| Session grid       | `grid-template-columns: 1fr 420px`, rows `1fr auto` (status line)                           | `04`, `06` |
| Session column     | Padding `20px 28px 12px`; title margin-bottom 18px                                          | `04`       |
| Chat history       | Gap 16px between turns; padding-right 14px (scrollbar room)                                 | `04`       |
| goop turn          | Grid `2ch 1fr` (marker column), row gap 6px                                                 | `04`       |
| Sidebar            | Padding `20px 20px 12px`, gap 14px between sections; 1px `--border` left edge               | `04`       |
| Sidebar section    | Gap 6px; offer row padding `6px 8px`, grid `3ch 1fr auto`, column gap 10px                  | `04`       |
| Top status strip   | Gap 8px, padding-bottom 12px; line gap 12px; mini meter 70 × 6px                            | `04`       |
| Agents tree        | Grid `2ch 1.5ch 9ch 1fr auto`, gap 6px, row gap 2px; padding-top 10px                       | `04`       |
| Status line        | Height 28px (`line-height: 28px`); grid `auto 1fr auto`, gap 14px; 28px side insets         | `04`, `05` |
| Composer (session) | Padding `10px 16px`; info line margin-top 6px                                               | `04`       |
| Popup              | Width 460px, 4px above the composer, padding `6px 0`, rows `2px 14px`, grid `14ch 1fr`      | `04`       |
| Home column        | Centered, gap 22px; composer, recent and tip 720px wide                                     | `05`       |
| Home composer      | Padding `14px 18px`                                                                         | `05`       |
| Recent activity    | Rows `3px 10px`, grid `2ch 1fr auto`, gap 2px                                               | `05`       |
| First-run panel    | Two columns, padding `22px 28px`                                                            | `05`       |
| Edges              | User turn 3px; composer and popup 2px; thought, tool card, sidebar 1px; selection inset 2px | `04`       |

No rounded corners and no shadows: the only `box-shadow` is the inset selection edge.

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

| State               | Input line                                 | Info line                                                               |
| ------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| Empty               | cursor + muted placeholder                 | `gpt-oss-20b · ◈ medium · CPU · ready`                                  |
| Typing              | typed text + cursor                        | `… · ready` · `ctrl+r reasoning · enter send · esc close`               |
| Popup / suggestions | `/r` typed; popup above                    | as typing                                                               |
| Answering           | muted `goop is answering…`                 | `… · answering` · `esc stop`                                            |
| Secret removed      | text with `[SECRET_1]`                     | `.chip.warn` `⚠ 1 secret removed` · `never sent to a model`             |
| CPU busy            | typed text                                 | `qwen · think off · GPU ·` `.chip.busy` `CPU busy, using qwen`          |
| Blur                | muted `›`, `tab to write`; `--border` edge | `focus is on the offers`                                                |
| Model error         | placeholder                                | `.chip.err` `⚠ qwen not responding · /models` · `chat still on gpt-oss` |

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

**Status line** (`04`, `05`, `06`). 28px high, `--border-subtle` top edge, three zones:
1. Focus label: `● word`, bold lowercase; dot `--user` chat/home, `--secondary` offers,
   `--warning` answering.
2. Key hints for the focused pane: bold key, dim action, `·` between.
3. Background state, then `│` (`--border`), then `? help`; home also shows the version.
   Error: `.alert` chip (`--error` background, `--background` text, bold, padding `0 8px`),
   `⚠ qwen not responding · /models`.

**Chips** (`04`). Inline, padding `0 6px`. `warn`: `--warning` background, `--background` text.
`err`: `--error` background, `--background` text. `busy`: text only in `--warning`.

**Scrollbars** (`04`). One cell on the right edge (4px in the artboard). Chat history: track
`--background-element` and thumb `--border-active` at opacity .55. Sidebar: thumb only
(`--text-muted`, opacity .4, inset 3px), and only while its content overflows.

**Home** (`05`). Centered column: logo (24 × 29 pixel grid from `logo.ts`, half blocks in the
terminal), `goop` wordmark in `--primary`, tagline `your local job search agent` (muted), composer
(720px, rotating placeholder), recent activity list (`▸` rows with `enter`; arrows move;
new items in `--accent`), one rotating tip (`● Tip …` with `--accent` dot). Status line: `home`,
`enter open · ↑↓ move · / commands · ctrl+p all`, `○ next search 09:00 │ v0.1.0 │ ? help`.
First run replaces recent activity with numbered steps (markers `--primary`; done struck
through and muted; current in `--text` with `← now`; later muted) until a CV and a search exist.

**Focus and selection** (`04`, `05`). The selected row gets `--background-element` and an inset
2px `--primary` left edge (`box-shadow: inset 2px 0 var(--primary)`): offer rows, agents tree,
recent activity (its `▸` turns `--primary`). Typing focus is lavender (composer edge); without
focus the composer edge is `--border`.

## Self-check for future artboards

Before finishing an artboard while this file exists:
- [ ] Every color is one of the 16 tokens (or the logo palette inside the logo); list them and
  compare. Frame colors (`#000`, notes panel) stay outside the screen.
- [ ] Only the `--mono` stack inside the screen; no other font family.
- [ ] Sizes are only the roles above (15/14 normal, 13 dim, 12 small, 28 wordmark).
- [ ] Orange means goop or selection; lavender means you; no color reused for another meaning.
- [ ] Selection is the inset 2px orange edge on `--background-element`; no rounded corners, no
  shadows.
- [ ] Glyphs come from the table above; the flame has its `●` fallback.
- [ ] The status line keeps three zones and 28px.
- [ ] Sections that only exist while something runs (Agents) are absent when idle.
- [ ] Motion respects `prefers-reduced-motion`.

## Tabs

One line of tab names separated by `·`, each with its count; the active tab is bold `--text` and underlined, the others `--text-muted`; `[` and `]` switch tabs. Source: `M7` (`design/tui-sources/01-full-screen.html`).

## Source-line marker

When an item comes from untrusted text shown beside it (the CV, an offer), the lines it came from get a 2px `--accent` left marker in the `│` gutter view. It is not a selection: the orange inset edge stays reserved for the selected row. Source: `M9` (`design/tui-profile/01-full-screen.html`).
