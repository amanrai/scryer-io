# Scryer Io

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
