# Scryer Io current implementation state

_Last reviewed: 2026-06-16 07:26 IST_

This document records the current local code state after the recent notebook/backend/Vast/UI changes. It is intentionally implementation-focused so the next pass can resume without rediscovering what changed.

## High-level direction

Scryer Io has moved from a small notebook shell into a local-first notebook workbench with:

- Jupyter-compatible execution providers.
- A richer notebook UI with CodeMirror editing, markdown/math rendering, ANSI output support, and execution streaming.
- Local file browsing/editing/running.
- Jupyter terminal support via WebSocket proxying.
- Vast.ai provisioning and connection scaffolding.
- Startup script and requirements editing for launched Vast machines.

The important architectural line is still: **execution normalizes to a Jupyter provider once connected**. Vast is a provisioning/connection path, not a separate execution runtime.

## Repository changes observed

Modified files:

- `README.md`
- `package.json`
- `package-lock.json`
- `src/jupyter-runtime.ts`
- `src/server/index.ts`
- `src/ui/App.tsx`
- `src/ui/styles.css`
- `vite.config.ts`

New files/directories:

- `src/ui/components/CodeEditor.tsx`
- `src/ui/components/TerminalPane.tsx`
- `src/ui/components/VastWizard.tsx`
- `.claude/` local/worktree files
- `Untitled-1781495609248.ipynb`

## Dependencies added

`package.json` now includes:

- CodeMirror packages:
  - `codemirror`
  - `@codemirror/commands`
  - `@codemirror/lang-markdown`
  - `@codemirror/lang-python`
  - `@codemirror/state`
  - `@codemirror/theme-one-dark`
  - `@codemirror/view`
- Terminal packages:
  - `@xterm/xterm`
  - `@xterm/addon-fit`
  - `ws`
  - `@types/ws`
- Markdown math:
  - `katex`
  - `@types/katex`

`vite.config.ts` now enables WebSocket proxying for `/api`:

```ts
"/api": { target: "http://127.0.0.1:54322", ws: true }
```

## Runtime changes: `src/jupyter-runtime.ts`

Added terminal and kernel status support on top of the existing Jupyter session/execution runtime.

New capabilities:

- `authHeaders()` builds token auth headers for Jupyter REST calls.
- `authToken` exposes the provider token for WebSocket URL construction.
- `createTerminal()` calls Jupyter Server `POST /api/terminals`.
- `terminalChannelsUrl(name)` builds the Jupyter terminal WebSocket URL.
- `getKernelStatus(sessionId?)` returns `{ status, kernelId? }` for the active session/kernel.

Existing execution and session management remain in place.

## Backend changes: `src/server/index.ts`

The API server now creates an explicit HTTP server so it can handle WebSocket upgrades for terminal proxying.

### Existing notebook/provider endpoints retained

- `GET /api/healthz`
- `GET /api/notebook`
- `PUT /api/notebook`
- `POST /api/notebook/open`
- `POST /api/notebook/new`
- `POST /api/notebook/close`
- `GET /api/runtime/providers`
- `POST /api/runtime/providers`
- `DELETE /api/runtime/providers/:providerId`
- `GET /api/runtime/providers/:providerId/kernelspecs`
- `GET /api/runtime/providers/:providerId/sessions`
- `POST /api/runtime/providers/:providerId/sessions`
- `POST /api/runtime/providers/:providerId/restart`
- `POST /api/runtime/providers/:providerId/interrupt`
- `POST /api/runtime/providers/:providerId/execute`
- `POST /api/runtime/providers/:providerId/execute/stream`

### New Jupyter runtime endpoints

- `GET /api/runtime/providers/:providerId/kernel-status`
  - Returns current kernel status for active/provided session.
- `POST /api/runtime/providers/:providerId/shutdown`
  - Shuts down the current session and clears `activeSession` if it matches.
- `POST /api/runtime/providers/:providerId/variables`
  - Executes a Python locals-inspection snippet and returns variable rows.
- `POST /api/runtime/providers/:providerId/terminals`
  - Creates a Jupyter terminal.
- WebSocket upgrade:
  - `/api/runtime/providers/:providerId/terminals/:terminalName`
  - Proxies browser terminal frames to Jupyter terminal WebSocket.

### New local file endpoints

These currently operate on local filesystem paths resolved from `~` or absolute/relative input.

- `GET /api/files?path=...`
  - Lists directory contents.
- `GET /api/files/read?path=...`
  - Reads text file content.
- `PUT /api/files/write`
  - Writes file content, creating parent directories.
- `POST /api/files/mkdir`
  - Creates directory recursively.

### Startup configuration endpoints

Backed by:

- `data/requirements.txt`
- `data/onstart.sh`

Endpoints:

- `GET /api/startup`
  - Returns `{ requirements, onstart }`.
- `PUT /api/startup`
  - Saves requirements and onstart script.

Default `onstart` installs JupyterLab, optionally installs `$REQUIREMENTS`, then starts JupyterLab on port `8080` with `$JUPYTER_TOKEN`.

### Vast.ai backend additions

Secrets are read from `data/secrets.json` using `vastApiKey`.

New helper behavior:

- Reads Vast API key with `readSecrets()`.
- Fetches marketplace offers with `fetchBundlesPages()`.
- Warms/caches known GPU names with `warmGpuNames()`.
- Adds `tcpPing()`/`pingOffers()` to measure port 22 latency per offer.
- Infers Jupyter endpoint from Vast instance metadata using `jupyter_url`, public IP, and mapped ports.

Vast endpoints:

- `GET /api/vast/instances`
  - Lists account instances via Vast.
- `GET /api/vast/instances/:id`
  - Fetches one Vast instance.
- `GET /api/vast/offers?filter=...`
  - Searches/filters rentable Vast offers.
  - Returns raw offers plus cached GPU names.
  - Sorts by `dph_total` and annotates latency.
- `POST /api/vast/instances`
  - Creates a new Vast instance from an offer.
  - Uses default image `pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime` unless overridden.
  - Generates a Jupyter token.
  - Sends requirements and onstart in env.
  - Uses `runtype: "args"`.
- `DELETE /api/vast/instances/:id`
  - Destroys a Vast instance.
- `POST /api/vast/connect/:id`
  - Fetches instance metadata, infers or accepts Jupyter URL/token, creates a normal Scryer Jupyter provider profile (`vast-<id>`), and returns kernel specs/cost.

Important cost note: there is creation/destruction support, but no automatic idle shutdown loop is implemented in this observed code state.

## UI changes: `src/ui/App.tsx`

The UI has expanded substantially.

### Rendering/output improvements

- Markdown rendering now supports KaTeX math:
  - block `$$...$$`
  - inline `$...$`
- Output rendering now:
  - sanitizes HTML/SVG outputs with DOMPurify
  - supports PNG image outputs
  - renders ANSI color/style escapes in stream/error/plain text outputs
  - preserves progress-output merging behavior

### Editor changes

- Textareas have been replaced by `CodeEditor`/CodeMirror for code, markdown, and mermaid cells.
- Keyboard support includes:
  - `Mod-Enter` run cell
  - `Shift-Enter` run and advance
  - `Mod-S` save
  - `Escape` focus/cell mode
  - tab indentation through CodeMirror

### Notebook state/UI additions

New state/behavior includes:

- Multi-cell selection (`selectedIds`).
- Kernel status (`idle`, `busy`, `dead`, `unknown`).
- Execution counts by cell.
- Running/editing cell tracking.
- Find/replace state.
- Left panel modes: table of contents, files, variables.
- App modes: explorer, notebook, file, terminal.
- Terminal session name tracking.
- Local file state and file execution outputs.
- Cost tracking for connected Vast-backed sessions.
- Drag/drop cell reordering.

### Notebook features added

- Table of contents generated from markdown headings.
- Find/replace across cell titles/content.
- Cell drag-and-drop reordering.
- Run selection / run multiple selected cells.
- Run-and-advance behavior.
- Clear individual cell output.
- Kernel switching.
- Kernel kill/shutdown, restart, interrupt.
- Export notebook code to `.py`.

### File mode

The UI can now browse, open, edit, save, and run local files via the new backend file APIs.

Current file-related functions:

- `loadFiles(path)`
- `openFile(entry)`
- `saveFile()`
- `runFile()`
- `closeFile()`

### Variables panel

`loadVariables()` calls `POST /api/runtime/providers/:providerId/variables` and displays Python locals from the active session.

### Terminal mode

Terminal UI uses `TerminalPane`, which creates or reuses a Jupyter terminal and connects via the backend WebSocket proxy.

### Vast flow integration

The main app now opens `VastWizard` and handles `onConnected` by:

- setting provider ID
- refreshing kernel specs
- recording cost per hour
- marking connection time
- entering notebook mode

## New component: `CodeEditor.tsx`

A React wrapper around CodeMirror 6.

Features:

- Python or markdown language mode. Mermaid currently falls through to markdown mode.
- One Dark theme for dark mode.
- Custom keybindings for run, run-and-advance, save, escape.
- ResizeObserver to force CodeMirror remeasure when accordion/container opens.
- Imperative `focus()` handle for parent focus management.

## New component: `TerminalPane.tsx`

A React wrapper around xterm.js.

Behavior:

- Creates a Jupyter terminal if no terminal name is provided.
- Opens a browser WebSocket to `/api/runtime/providers/:providerId/terminals/:name`.
- Parses Jupyter terminal JSON frames:
  - `stdout`
  - `stderr`
- Sends input as `['stdin', data]` frames.
- Uses `FitAddon` and ResizeObserver for responsive sizing.
- Theme adapts to Scryer dark/light theme.

## New component: `VastWizard.tsx`

A modal wizard for paid Vast.ai backend handling.

Steps:

- `loading`
- `instances`
- `offers`
- `confirm-connect`
- `confirm-start`
- `starting`
- `connecting`

Behavior:

- Lists running and non-running Vast instances.
- Allows connecting an existing running instance.
- Can load offers, filter by GPU name, sort by:
  - price
  - MLPerf
  - MLPerf/$
  - latency
- Shows offer cost and hardware metadata.
- Requires confirm step before starting an instance.
- Starts a Vast instance through backend `POST /api/vast/instances`.
- Polls instance status until running, then moves to connect step.
- Warns that billing continues until stopped/destroyed on Vast.

## Styling changes: `src/ui/styles.css`

The stylesheet has been heavily expanded. Major areas now styled:

- Larger app shell/workbench layout.
- Topbar provider/status/cost controls.
- Toolbar and app mode controls.
- Settings/startup/Vast wizard modals.
- Left sidebar panels for TOC/files/variables.
- Notebook cells, selected/multi-selected/drag-over/running states.
- CodeMirror editor shell.
- Output rendering, rich outputs, markdown preview, mermaid output.
- Find/replace UI.
- File browser/editor mode.
- Terminal pane/xterm container.
- Vast wizard rows, costs, errors, empty states.

## README updates

The README now explicitly names SageMaker notebooks as a target provider class and reframes the first abstraction as treating every Jupyter backend as a remote endpoint.

## Current caveats / things to verify next

1. **Vast API paths and semantics**
   - Current code uses both newer/older Vast patterns around `/api/v0/bundles/`, `/api/v0/asks/:id/`, and `/api/v0/instances`.
   - Verify live API behavior before trusting launch/destroy paths.

2. **Vast auto-shutdown**
   - UI/planning discussed auto-shutdown, but this code state does not show an implemented idle shutdown scheduler.

3. **Vast startup/runtime**
   - `runtype: "args"` with an `onstart` script may need validation against Vast behavior. Earlier design had considered `jupyter_direct`; current implementation starts Jupyter via custom script.

4. **Terminal support**
   - Terminal path depends on Jupyter Server terminals being enabled and reachable through the provider endpoint.
   - Vast instances started by current onstart should run JupyterLab, but terminal availability should be tested.

5. **File APIs security**
   - Local file endpoints can read/write arbitrary resolved paths accessible to the server process. This is acceptable for local-only dev, but should be gated/sandboxed before broader exposure.

6. **Untracked `.claude/` worktree**
   - `.claude/` contains a full worktree and local settings. Decide whether it should be ignored rather than committed.

7. **Generated notebook**
   - `Untitled-1781495609248.ipynb` is untracked. Decide whether it is sample data or should be removed/ignored.

8. **Typecheck/build**
   - Run `npm run typecheck` and `npm run build` after the UI edits settle.
