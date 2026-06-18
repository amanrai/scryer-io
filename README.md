# Scryer Io

The purpose of this project is to remove the ceremony behind getting started with various notebook providers. The interface is being rebuilt to explicitly support local agents (even if the local agents use remote models), and remote execution (a local jupyter server is just another 'remote' jupyter endpoint.)

Scryer Io is an agent-augmented notebook workbench.

The goal is to provide a fresh local-first notebook interface backed by real execution kernels, starting with Jupyter-compatible runtimes. Notebooks should be able to connect to different execution providers such as local machines, tailnet hosts, Vast instances, SageMaker notebooks, and eventually Colab-like environments.

Core ideas:

- notebook cells as focused units of work
- agents that can operate on specific cells
- swappable execution targets
- reconnectable kernel sessions
- outputs and artifacts that can later attach to Scryer/Kanbaner work items
- project-level configuration for common services such as W&B, datasets, checkpoints, and remote machines

This repo will start standalone. Kanbaner/Scryer integration can come after the notebook and execution model are proven.

## First abstraction

Scryer Io treats every Jupyter backend as a remote endpoint. A local Jupyter server is just the nearest remote.

A provider profile describes a server:

```ts
const profile = {
  id: "remote",
  kind: "jupyter",
  label: "Remote Jupyter",
  baseUrl: "http://127.0.0.1:8888/",
  auth: { kind: "token", token: "..." },
  defaultKernelName: "python3",
} as const;
```

The runtime client can:

- list kernel specs
- list sessions
- start/connect sessions
- execute code
- interrupt/restart/shutdown kernels

Plain remote Jupyter, tailnet machines, Vast instances, SageMaker notebooks, and Colab-like environments should eventually all reduce to provider profiles plus adapters.

## Development

Install dependencies:

```bash
npm install
```

Run the full local dev stack with one command:

```bash
npm run dev
```

This starts:

- frontend: `http://127.0.0.1:54321`
- backend API server: `http://127.0.0.1:54322`

The Vite frontend proxies every `/api/*` request to the backend server on `54322`. The frontend should not talk directly to provider APIs; browser calls go through the local Scryer Io API server.

Useful checks:

```bash
npm run typecheck
npm run build
```

## Current implementation notes

See `docs/current-state.md` for the current local implementation state, including notebook UI changes, backend endpoints, terminal support, Vast.ai flow, and known caveats.

## Port decisions

- `54321` — Scryer Io frontend dev/preview port
- `54322` — Scryer Io backend API port

The backend port can be overridden with:

```bash
SCRYER_IO_API_PORT=54322 npm run dev:api
```

The default development path is still `npm run dev`, which runs both frontend and backend together.
