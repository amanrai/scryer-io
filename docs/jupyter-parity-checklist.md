# Jupyter Parity — Execution Checklist

Tracks the 8 approved features from PM ticket **Features Required** (`124ffd6e-e3bc-4787-a97a-6ad180c30a78`, project Scryer Io). Build order: **Plumbing → 2 → 1 → 3 → 8 → 4 → 5 → 6 → 7**. Every user-facing entry point is a Cmd+K palette command (`paletteCommands` in `src/ui/App.tsx`) and/or a `NotebookToolbar` button.

**Status (2026-06-19):** ✅ Phase 0 plumbing · ✅ Feature 1 (completion, verified vs live kernel) · ✅ Feature 3 (run-all + queue) · ✅ Feature 4 (DataFrame viewer, parser verified) · ✅ Feature 5 (interactive plots) · ✅ Feature 6 (lint/format, verified vs ruff) · ✅ Feature 7 (HTML/PDF/py export) · ✅ Feature 8 (output mgmt) · ⏳ **Feature 2 only remaining** — tqdm `\r` slice done; live ipywidgets manager outstanding (needs an ipywidgets kernel to verify).

Key files: `src/jupyter-runtime.ts` (kernel), `src/server/index.ts` (routes), `src/ui/App.tsx` (state/commands), `src/ui/components/{OutputView,CodeEditor,CommandPalette,NotebookToolbar,Sidebar}.tsx`, `src/ui/types.ts`, `src/ui/ipynb.ts`.

---

## Phase 0 — Shared plumbing (prereq for 1 & 2)

Today `runtime.execute()` is one-shot and `outputFromMessage` drops comm/display-lifecycle messages. Widgets and completion need a persistent, bidirectional channel.

- [ ] **Surface dropped IOPub messages** in `outputFromMessage` (`jupyter-runtime.ts:51`): handle `comm_open`, `comm_msg`, `comm_close`, `update_display_data`, `clear_output`, and `display_id` from message metadata. Extend the `CellOutput`/`RichOutput` union in `src/ui/types.ts:5` accordingly (`{ kind: "clear_output"; wait: boolean }`, `{ kind: "update_display_data"; ... }`, `{ kind: "comm"; ... }`).
- [ ] **Add a live session channel.** New WS endpoint `GET /api/runtime/providers/:id/sessions/:sid/channel` in `server/index.ts` that subscribes to the persistent `Session.ISessionConnection.iopubMessage` signal and forwards every IOPub message; accepts inbound `comm_msg` / `input_reply` from the browser and relays via `kernel.sendShellMessage` / comm API. Reuse the session map already held in `JupyterRuntime.sessions`.
- [ ] **Runtime helpers** on `JupyterRuntime`: `requestComplete(sessionId, code, cursorPos)`, `requestInspect(sessionId, code, cursorPos, detail)`, `openComm`/`sendCommMsg`, and an `onIOPub(sessionId, cb)` subscription used by the WS endpoint.
- [ ] **Client transport** `src/ui/kernel-channel.ts`: open the WS on session connect, demux messages by `msg_type` and `comm_id`/`display_id`, expose `subscribe(cellId, handler)` and `sendComm(commId, data)`. Wire open/close into `App.tsx` session lifecycle (`setActiveSession`).
- [ ] **`clear_output` / `update_display_data` handling** in `appendRichOutput` (`src/ui/ipynb.ts`): `clear_output{wait}` truncates the cell's output list (deferred if `wait`); `update_display_data` replaces the output sharing the same `display_id`.
- [ ] Verify: existing one-shot `execute/stream` path still works unchanged for plain cells.

---

## Phase 1 — Feature 2: Interactive widgets & live progress bars  *(build first)*

- [ ] **tqdm / `\r` handling** in stream rendering: collapse carriage returns so progress bars render as a single updating line (`OutputView.tsx` `AnsiPre`, and the stream-append path in `ipynb.ts`). Cheap win, ship even before full widgets.
- [ ] **Adopt `@jupyter-widgets/html-manager`** (+ `base`/`controls`): add dependency, instantiate a per-notebook `WidgetManager` bound to the kernel comm channel from Phase 0.
- [ ] **Widget mime renderer** in `OutputView.tsx`: detect `application/vnd.jupyter.widget-view+json`, resolve the model via the manager, mount the view into the output node; tear down on cell clear/unmount.
- [ ] **Model state persistence**: handle `application/vnd.jupyter.widget-state+json` so reopened notebooks rehydrate widget state from ipynb metadata (`notebookFromCells`/`cellsFromNotebook` in `ipynb.ts`).
- [ ] **Comm lifecycle**: route `comm_open`/`comm_msg`/`comm_close` to the manager; send widget interaction `comm_msg` back through the WS.
- [ ] Verify: `tqdm` loop animates in place; `ipywidgets.IntSlider` renders, drags, and updates a dependent cell; restart kernel cleanly disposes widgets.

---

## Phase 2 — Feature 1: Code intelligence (Tab complete + Shift+Tab)

- [ ] **Server routes**: `POST /complete` and `POST /inspect` on the provider, calling the new runtime helpers (`complete_request` / `inspect_request`). Request/reply only — no WS needed.
- [ ] **Completion source** for CodeMirror (`@codemirror/autocomplete`): async source in `CodeEditor.tsx` that calls `/complete` with code + cursor offset, maps `matches`/`cursor_start`/`cursor_end` to `CompletionResult`. Add the `autocompletion()` extension to the editor's extension list (`CodeEditor.tsx:50`).
- [ ] **Debounce + cancel** in-flight completion requests; gate on an active session (no-op when disconnected).
- [ ] **Signature/doc popover (Shift+Tab)**: keymap entry in `CodeEditor.tsx:40` that calls `/inspect`, renders the `text/plain` (ANSI-stripped) reply in a hover/tooltip panel; Esc dismisses.
- [ ] **Pass session context** into `CodeEditor` (new props `providerId`, `sessionId`) from `App.tsx` cell render (`NotebookCellView` → editor).
- [ ] Verify: `np.<Tab>` lists attributes; `pd.read_csv(<Shift+Tab>)` shows the signature; works in both code cells and the file editor.

---

## Phase 3 — Feature 3: Full-notebook execution

- [ ] **Execution queue model** in `App.tsx`: replace ad-hoc `executeCells` loop (`App.tsx:513`) with a queue (`queued` / `running` / `done` / `error` per cell id) and a `stopOnError` flag (default true → halt remaining on first `error` output).
- [ ] **Per-cell queued state**: add `queued` indicator to `NotebookCellView` (alongside existing `running`); show position/badge.
- [ ] **Palette commands** (`paletteCommands`, `App.tsx:959`): `Run all`, `Run all above`, `Run all below`, `Restart & run all`. Group `run`.
- [ ] **Toolbar**: add Run-All control to `NotebookToolbar` next to existing run-to/from-here.
- [ ] **Interrupt clears queue**: `interruptKernel` drains pending queue and resets states.
- [ ] Verify: Run All executes top→bottom in order; an error mid-notebook halts the rest (and a toggle lets it continue); interrupt empties the queue.

---

## Phase 4 — Feature 8: Output management

- [ ] **Collapse/scroll tall outputs**: in `OutputView.tsx`, wrap outputs over a height threshold in a scroll container with an expand/collapse toggle; persist collapsed state per cell (`NotebookCell` flag in `types.ts`).
- [ ] **Per-output actions**: copy-to-clipboard (text/plain or rendered text) and save-to-file (download blob; for images use the base64 data) buttons on each output block.
- [ ] **"Scroll outputs" cell toggle** mirroring Jupyter; default threshold configurable in Settings.
- [ ] **Clear single output** already exists (`clearCellOutput`, `App.tsx:240`) — surface a per-output clear too.
- [ ] Verify: a 10k-line stdout is scroll-boxed and collapsible; copy yields exact text; save writes the file; state survives save/reopen.

---

## Phase 5 — Feature 4: DataFrame viewer

- [ ] **Detect DataFrame outputs**: prefer a structured mime. Add a lightweight kernel-side formatter (opt-in `onstart` hook or auto-registered `text/html` class sniff) that tags pandas output, or parse the existing `text/html` table. Prefer emitting `application/vnd.scryer.dataframe+json` (columns, dtypes, rows page) via a display formatter installed at session start.
- [ ] **Server paging endpoint** (optional, for big frames): `POST /dataframe` that runs a snippet to slice `df.iloc[start:stop]` by variable name + returns JSON page; backed by the `variables` snippet pattern (`server/index.ts:318`).
- [ ] **`DataFrameView` component**: sortable headers, sticky header, virtualized/paged rows, dtype row, shape caption.
- [ ] **CSV export** action (client-side from loaded page, or server `df.to_csv` for full frame).
- [ ] **Renderer hook** in `OutputView.tsx` for the new mime, fallback to current HTML repr when absent.
- [ ] Verify: a 1M-row DataFrame renders a paged, sortable table without freezing; CSV export matches; falls back gracefully when formatter not installed.

---

## Phase 6 — Feature 5: Interactive JS plots

- [ ] **Plotly**: render `application/vnd.plotly.v1+json` via `plotly.js` (dynamic `import()` to keep bundle lean) into the output node.
- [ ] **Vega/Altair**: render `application/vnd.vegalite.v5+json` and `application/vnd.vega.v5+json` via `vega-embed`.
- [ ] **Bokeh**: render `application/vnd.bokehjs_exec.v0+json` / load script — confirm feasibility; document if punted (Bokeh requires its JS + exec scripts).
- [ ] **Renderer registry**: refactor `OutputView.tsx` mime branching (`OutputView.tsx:83`) into an ordered `mimeRenderers` map so plots/dataframes/widgets register uniformly; richest mime wins.
- [ ] **Theme + resize**: charts respect light/dark and reflow on container resize; dispose on unmount.
- [ ] Verify: `px.scatter(...)` zooms/hovers; an Altair chart renders interactively; serialize/reopen keeps the figure (static image fallback acceptable on reopen if JSON absent).

---

## Phase 7 — Feature 6: Inline linting + formatting

- [ ] **Lint endpoint**: `POST /lint` in `server/index.ts` running `ruff check --output-format json -` over cell source (spawn `ruff`; degrade gracefully if not installed). Return diagnostics (line, col, code, message, severity).
- [ ] **CodeMirror diagnostics**: `@codemirror/lint` `linter()` extension in `CodeEditor.tsx` mapping results to squiggles; debounce on edit.
- [ ] **Format endpoint**: `POST /format` running `ruff format -` (or `black -`) on source; return formatted text.
- [ ] **Palette commands**: `Format cell`, `Format notebook` (`paletteCommands`); apply via `patchCell` and mark dirty.
- [ ] **Config**: linter/formatter choice + enable toggle in `SettingsModal`.
- [ ] Verify: unused import shows a squiggle; Format cell rewrites to ruff style; Format notebook reformats all code cells; absent `ruff` → friendly status, no crash.

---

## Phase 8 — Feature 7: Export to HTML / PDF

- [ ] **HTML export**: server route `POST /api/notebook/export` (`format: "html"`) that renders cells + outputs to a self-contained HTML doc (inline CSS, embed base64 images, rendered markdown/KaTeX). Reuse `notebookFromCells` and the client markdown/output renderers, or render server-side from the ipynb.
- [ ] **PDF export**: from the HTML via headless Chromium (`puppeteer`/`playwright`) or document a "Print to PDF" fallback if we avoid a heavy dep.
- [ ] **Palette commands**: `Export as HTML`, `Export as PDF` (group `notebook`), alongside existing `exportToPy` (`App.tsx:409`); trigger download.
- [ ] **Include outputs toggle** (with/without outputs) in the export action.
- [ ] Verify: exported HTML opens standalone with images, tables, and rendered markdown/math; PDF paginates; `.py` export still works.

---

## Cross-cutting (do alongside)

- [ ] **Types**: extend `RichOutput` union + `NotebookCell` flags in `src/ui/types.ts` as each phase requires; keep `ipynb.ts` round-trip (`cellsFromNotebook`/`notebookFromCells`) lossless.
- [ ] **Palette discoverability**: every new command added to `paletteCommands` with icon + group + hint; keep groups ordered (notebook / run / view).
- [ ] **Disconnected-state guards**: all kernel-dependent commands no-op with a status message when `providerId`/`activeSession` is absent (mirror `executeCell` guard at `App.tsx:485`).
- [ ] **`npm run typecheck`** clean after each phase; **`npm run build`** before marking a feature done.
- [ ] **PM ticket updates**: as each phase completes, note it on `124ffd6e` (status currently `in_planning`); flip to `in_execution` when Phase 0 starts.
- [ ] **Manual verify** each feature against the per-phase "Verify" line using `/verify` or the `run` skill against a live Jupyter at `http://127.0.0.1:8888/`.

---

## Deferred (NOT in this checklist)
Visual debugger (debugpy) · cell tags & metadata editor · rich variable inspector (shape/dtype/preview) · help pager (`?`/`??`) + raw cell type.
