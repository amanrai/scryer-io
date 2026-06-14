import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faArrowDown,
	faArrowUp,
	faBolt,
	faChevronRight,
	faCircleNodes,
	faEraser,
	faGear,
	faPlay,
	faPlus,
	faRobot,
	faRotateRight,
	faXmark,
} from "@fortawesome/free-solid-svg-icons";

type CellKind = "markdown" | "code";

type NotebookCell = {
	id: string;
	kind: CellKind;
	title: string;
	content: string;
	agentOpen: boolean;
	lastRun?: string;
	output?: string;
};

type KernelSpec = {
	name: string;
	displayName: string;
	language?: string;
	isDefault: boolean;
};

type RuntimeSession = {
	id: string;
	path: string;
	kernelName?: string;
	providerId: string;
};

type SavedProvider = {
	id: string;
	label: string;
	baseUrl: string;
	defaultKernelName?: string;
	token?: string;
};

const initialCells: NotebookCell[] = [
	{
		id: "cell-1",
		kind: "markdown",
		title: "Problem frame",
		content: "# Sub-50M Chess GM\n\nUse this notebook to sketch experiments, execute small probes, and keep outputs attached to the work.",
		agentOpen: false,
	},
	{
		id: "cell-2",
		kind: "code",
		title: "Runtime smoke test",
		content: "budget = 50_000_000\ntarget = 'jupyter-provider'\n{'budget': budget, 'target': target}",
		agentOpen: true,
	},
	{
		id: "cell-3",
		kind: "code",
		title: "Notebook provider config",
		content: "import sys\nimport numpy as np\nimport pandas as pd\n\n{'python': sys.version.split()[0], 'numpy': np.__version__, 'pandas': pd.__version__}",
		agentOpen: false,
	},
];

function lineNumbers(text: string): number[] {
	return Array.from({ length: Math.max(1, text.split("\n").length) }, (_, index) => index + 1);
}

function nowLabel(): string {
	return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function isCommand(event: KeyboardEvent, code: string): boolean {
	return event.code === code && (event.metaKey || event.ctrlKey);
}

export function App() {
	const [cells, setCells] = useState<NotebookCell[]>(initialCells);
	const [selectedId, setSelectedId] = useState(initialCells[1]?.id ?? initialCells[0].id);
	const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">("checking");
	const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8888/");
	const [token, setToken] = useState("");
	const [kernelName, setKernelName] = useState("localjupyter");
	const [providerId, setProviderId] = useState<string>();
	const [kernelSpecs, setKernelSpecs] = useState<KernelSpec[]>([]);
	const [activeSession, setActiveSession] = useState<RuntimeSession>();
	const [connectionMessage, setConnectionMessage] = useState("No provider connected");
	const [isConnecting, setIsConnecting] = useState(false);
	const [isExecuting, setIsExecuting] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const selectedIndex = cells.findIndex((cell) => cell.id === selectedId);
	const selectedCell = cells[selectedIndex] ?? cells[0];

	const notebookStats = useMemo(() => {
		const code = cells.filter((cell) => cell.kind === "code").length;
		const provider = providerId ? `${providerId} · ${activeSession?.kernelName ?? kernelName}` : "provider not connected";
		return `${cells.length} cells · ${code} code · ${provider}`;
	}, [activeSession?.kernelName, cells, kernelName, providerId]);

	useEffect(() => {
		let cancelled = false;
		fetch("/api/healthz")
			.then((res) => {
				if (!res.ok) throw new Error("API offline");
				if (!cancelled) setApiStatus("online");
			})
			.catch(() => {
				if (!cancelled) setApiStatus("offline");
			});
		return () => { cancelled = true; };
	}, []);

	useEffect(() => {
		let cancelled = false;
		fetch("/api/runtime/providers")
			.then((res) => res.json())
			.then((json) => {
				if (cancelled) return;
				const provider = (json.providers ?? [])[0] as SavedProvider | undefined;
				if (!provider) return;
				setProviderId(provider.id);
				setBaseUrl(provider.baseUrl);
				setToken(provider.token ?? "");
				setKernelName(provider.defaultKernelName ?? "localjupyter");
				setActiveSession(json.activeSession);
				setConnectionMessage(`Loaded ${provider.label}`);
				fetch(`/api/runtime/providers/${provider.id}/kernelspecs`)
					.then((res) => res.ok ? res.json() : undefined)
					.then((specs) => { if (!cancelled && specs?.kernelSpecs) setKernelSpecs(specs.kernelSpecs); })
					.catch(() => undefined);
			})
			.catch(() => undefined);
		return () => { cancelled = true; };
	}, []);

	function patchCell(id: string, patch: Partial<NotebookCell>) {
		setCells((current) => current.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell)));
	}

	function moveSelected(delta: -1 | 1) {
		if (selectedIndex < 0) return;
		const nextIndex = selectedIndex + delta;
		if (nextIndex < 0 || nextIndex >= cells.length) return;
		setCells((current) => {
			const next = [...current];
			const [cell] = next.splice(selectedIndex, 1);
			next.splice(nextIndex, 0, cell);
			return next;
		});
	}

	async function connectProvider() {
		setIsConnecting(true);
		setConnectionMessage("Connecting to Jupyter…");
		try {
			const res = await fetch("/api/runtime/providers", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: "local", label: "Local Jupyter", baseUrl, token, defaultKernelName: kernelName || undefined }),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to connect provider");
			setProviderId(json.provider.id);
			setKernelSpecs(json.kernelSpecs ?? []);
			const defaultSpec = (json.kernelSpecs ?? []).find((spec: KernelSpec) => spec.isDefault)?.name;
			if (!kernelName && defaultSpec) setKernelName(defaultSpec);
			setConnectionMessage(`Connected to ${json.provider.label}`);
		} catch (err: any) {
			setProviderId(undefined);
			setKernelSpecs([]);
			setConnectionMessage(err?.message ?? String(err));
		} finally {
			setIsConnecting(false);
		}
	}

	async function executeCell(cell: NotebookCell) {
		if (cell.kind !== "code") return;
		if (!providerId) {
			patchCell(cell.id, { output: "Connect a Jupyter provider before executing code." });
			return;
		}
		patchCell(cell.id, { output: "Running…" });
		const stamp = nowLabel();
		const res = await fetch(`/api/runtime/providers/${providerId}/execute`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: cell.content, sessionId: activeSession?.id, kernelName: kernelName || undefined }),
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error ?? "Execution failed");
		setActiveSession(json.session);
		patchCell(cell.id, {
			lastRun: stamp,
			output: json.text || (json.ok ? "✓ executed" : "Execution finished without text output"),
		});
	}

	async function executeCells(targetCells: NotebookCell[]) {
		setIsExecuting(true);
		try {
			for (const cell of targetCells) await executeCell(cell);
		} catch (err: any) {
			if (selectedCell) patchCell(selectedCell.id, { output: err?.message ?? String(err) });
		} finally {
			setIsExecuting(false);
		}
	}

	function executeSelected() {
		if (!selectedCell) return;
		executeCells([selectedCell]);
	}

	async function restartKernel() {
		if (!providerId || !activeSession) {
			setConnectionMessage("No active Jupyter session to restart");
			return;
		}
		setIsExecuting(true);
		try {
			const res = await fetch(`/api/runtime/providers/${providerId}/restart`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: activeSession.id }),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Restart failed");
			setConnectionMessage(`Restarted kernel for session ${activeSession.id.slice(0, 8)}`);
		} catch (err: any) {
			setConnectionMessage(err?.message ?? String(err));
		} finally {
			setIsExecuting(false);
		}
	}

	function clearOutputs() {
		setCells((current) => current.map((cell) => ({ ...cell, output: undefined, lastRun: undefined })));
	}

	function executeUpToHere() {
		if (selectedIndex < 0) return;
		executeCells(cells.slice(0, selectedIndex + 1));
	}

	function executeFromHere() {
		if (selectedIndex < 0) return;
		executeCells(cells.slice(selectedIndex));
	}

	function addCell(position: "above" | "below" = "below", anchorId = selectedId) {
		const id = `cell-${Date.now()}`;
		const cell: NotebookCell = {
			id,
			kind: "code",
			title: "Untitled code cell",
			content: "",
			agentOpen: false,
		};
		setCells((current) => {
			const anchorIndex = current.findIndex((item) => item.id === anchorId);
			const fallback = position === "above" ? 0 : current.length;
			const insertAt = anchorIndex >= 0 ? anchorIndex + (position === "below" ? 1 : 0) : fallback;
			const next = [...current];
			next.splice(insertAt, 0, cell);
			return next;
		});
		setSelectedId(id);
	}

	return (
		<div className="app-shell">
			<header className="topbar">
				<div className="brand-block">
					<div className="eyebrow">Scryer Io</div>
					<h1>Notebook workbench</h1>
				</div>
				<div className="provider-pill">
					<FontAwesomeIcon icon={faCircleNodes} />
					<span>API {apiStatus}</span>
					<strong>{providerId ? `Jupyter ${providerId}` : "Jupyter disconnected"}</strong>
				</div>
			</header>

			<section className="toolbar" aria-label="Notebook actions">
				<button className="ghost-button icon-button" title="Move cell up" aria-label="Move cell up" onClick={() => moveSelected(-1)} disabled={selectedIndex <= 0 || isExecuting}>
					<FontAwesomeIcon icon={faArrowUp} />
				</button>
				<button className="ghost-button icon-button" title="Move cell down" aria-label="Move cell down" onClick={() => moveSelected(1)} disabled={selectedIndex < 0 || selectedIndex >= cells.length - 1 || isExecuting}>
					<FontAwesomeIcon icon={faArrowDown} />
				</button>
				<div className="toolbar-divider" />
				<button className="primary-button icon-button" title="Execute cell" aria-label="Execute cell" onClick={executeSelected} disabled={isExecuting}>
					<FontAwesomeIcon icon={faPlay} />
				</button>
				<button className="ghost-button icon-button" title="Execute all up to here" aria-label="Execute all up to here" onClick={executeUpToHere} disabled={isExecuting}>
					<FontAwesomeIcon icon={faBolt} />
				</button>
				<button className="ghost-button icon-button" title="Execute all from here" aria-label="Execute all from here" onClick={executeFromHere} disabled={isExecuting}>
					<FontAwesomeIcon icon={faRotateRight} />
				</button>
				<div className="toolbar-divider" />
				<button className="ghost-button icon-button" title="Restart kernel" aria-label="Restart kernel" onClick={restartKernel} disabled={isExecuting || !activeSession}>
					<FontAwesomeIcon icon={faRotateRight} />
				</button>
				<button className="ghost-button icon-button" title="Clear outputs" aria-label="Clear outputs" onClick={clearOutputs} disabled={isExecuting}>
					<FontAwesomeIcon icon={faEraser} />
				</button>
				<div className="toolbar-spacer" />
				<button className="ghost-button icon-button" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
					<FontAwesomeIcon icon={faGear} />
				</button>
				<button className="success-button icon-button" title="Add cell below" aria-label="Add cell below" onClick={() => addCell("below")}>
					<FontAwesomeIcon icon={faPlus} />
				</button>
			</section>

			{settingsOpen && (
				<div className="settings-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
					<section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
						<header className="settings-header">
							<div>
								<div className="eyebrow">Settings</div>
								<h2 id="settings-title">Provider</h2>
							</div>
							<button className="ghost-button icon-button" title="Close settings" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>
								<FontAwesomeIcon icon={faXmark} />
							</button>
						</header>
						<div className="settings-body">
							<nav className="settings-nav" aria-label="Settings pages">
								<button className="active" type="button">Provider</button>
							</nav>
							<div className="settings-page">
								<p className="settings-copy">Connect this Scryer Io server to a Jupyter endpoint. These values are saved on the backend, so any browser using this server can see and reuse them.</p>
								<label>
									<span>Jupyter URL</span>
									<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:8888/" />
								</label>
								<label>
									<span>Token</span>
									<input value={token} onChange={(event) => setToken(event.target.value)} placeholder="paste token" type="password" />
								</label>
								<label>
									<span>Kernel</span>
									<input value={kernelName} onChange={(event) => setKernelName(event.target.value)} list="kernel-specs" placeholder="python3" />
									<datalist id="kernel-specs">
										{kernelSpecs.map((spec) => <option key={spec.name} value={spec.name}>{spec.displayName}</option>)}
									</datalist>
								</label>
								<div className="settings-actions">
									<button className="primary-button" onClick={connectProvider} disabled={isConnecting || apiStatus !== "online"}>
										<FontAwesomeIcon icon={faCircleNodes} /> {isConnecting ? "Connecting…" : "Connect"}
									</button>
									<span>{connectionMessage}{activeSession ? ` · session ${activeSession.id.slice(0, 8)}` : ""}</span>
								</div>
							</div>
						</div>
					</section>
				</div>
			)}

			<main className="notebook-layout">
				<section className="notebook-panel" aria-label="Notebook cells">
					<div className="notebook-meta">
						<span>{notebookStats}</span>
						<span>{selectedCell ? `Selected: ${selectedCell.title}` : "No cell selected"}</span>
					</div>

					<div className="cell-stack">
						{cells.map((cell, index) => (
							<article
								key={cell.id}
								className={`cell-card ${cell.id === selectedId ? "selected" : ""}`}
								onClick={() => setSelectedId(cell.id)}
							>
								<div className="cell-header">
									<div>
										<div className="cell-title">{index + 1}. {cell.title}</div>
										<div className="cell-subtitle">{cell.kind} cell{cell.lastRun ? ` · last run ${cell.lastRun}` : ""}</div>
									</div>
									<select
										value={cell.kind}
										onClick={(event) => event.stopPropagation()}
										onChange={(event) => patchCell(cell.id, { kind: event.target.value as CellKind })}
										aria-label="Cell type"
									>
										<option value="code">Code</option>
										<option value="markdown">Markdown</option>
									</select>
								</div>

								<div className="editor-shell">
									<div className="line-gutter" aria-hidden="true">
										{lineNumbers(cell.content).map((line) => <span key={line}>{line}</span>)}
									</div>
									<textarea
										value={cell.content}
										onClick={(event) => event.stopPropagation()}
										onKeyDown={(event) => {
											if (isCommand(event, "Enter")) {
												event.preventDefault();
												setSelectedId(cell.id);
												executeCells([cell]);
											} else if (isCommand(event, "KeyA")) {
												event.preventDefault();
												addCell("above", cell.id);
											} else if (isCommand(event, "KeyB")) {
												event.preventDefault();
												addCell("below", cell.id);
											}
										}}
										onChange={(event) => patchCell(cell.id, { content: event.target.value })}
										spellCheck={false}
										aria-label={`${cell.title} source`}
									/>
								</div>

								{cell.output && <pre className="cell-output">{cell.output}</pre>}

								<div className="agent-accordion">
									<button
										type="button"
										aria-expanded={cell.agentOpen}
										onClick={(event) => {
											event.stopPropagation();
											patchCell(cell.id, { agentOpen: !cell.agentOpen });
										}}
									>
										<FontAwesomeIcon icon={faChevronRight} className={cell.agentOpen ? "open" : ""} />
										<FontAwesomeIcon icon={faRobot} className="agent-bot-icon" aria-label="Cell agent" />
									</button>
									<div className={`agent-panel ${cell.agentOpen ? "open" : ""}`}>
										<div>
											<p>Agent design lives here later. For now this is the reserved per-cell steering surface.</p>
											<div className="agent-input-placeholder">Ask the cell agent…</div>
										</div>
									</div>
								</div>
							</article>
						))}
					</div>
				</section>
			</main>
		</div>
	);
}
