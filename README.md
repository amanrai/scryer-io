# Scryer Io

The purpose of this project is to remove the ceremony behind getting started with various notebook providers. The interface is being rebuilt to explicitly support local agents (even if the local agents use remote models), and remote execution (a local jupyter server is just another 'remote' jupyter endpoint.)

Scryer Io is an agent-augmented notebook workbench.

The goal is to provide a fresh local-first notebook interface backed by real execution kernels, starting with Jupyter-compatible runtimes. Notebooks should be able to connect to different execution providers such as local machines, tailnet hosts, Vast instances, and eventually Colab-like environments.

Core ideas:

- notebook cells as focused units of work
- agents that can operate on specific cells
- swappable execution targets
- reconnectable kernel sessions
- outputs and artifacts that can later attach to Scryer/Kanbaner work items
- project-level configuration for common services such as W&B, datasets, checkpoints, and remote machines

This repo will start standalone. Kanbaner/Scryer integration can come after the notebook and execution model are proven.

## First abstraction

Scryer Io treats local and remote Jupyter the same way: both are just Jupyter server endpoints.

A provider profile describes a server:

```ts
const profile = {
  id: "local",
  kind: "jupyter",
  label: "Local Jupyter",
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

Local Jupyter, tailnet machines, Vast instances, and Colab-like environments should eventually all reduce to provider profiles plus adapters.

## Development

```bash
npm install
npm run typecheck
npm run build
```
