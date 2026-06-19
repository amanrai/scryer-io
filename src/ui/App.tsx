import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import "katex/dist/katex.min.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faAnglesDown,
	faAnglesUp,
	faEraser,
	faFile,
	faFileExport,
	faFloppyDisk,
	faFolderOpen,
	faForwardStep,
	faGear,
	faLayerGroup,
	faMagnifyingGlass,
	faMoon,
	faPlay,
	faPlus,
	faRotateRight,
	faSun,
	faTerminal,
	faWandMagicSparkles,
	faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { type CodeEditorHandle } from "./components/CodeEditor.js";
import { TerminalPane } from "./components/TerminalPane.js";
import { VastWizard } from "./components/VastWizard.js";
import { CommandPalette, type PaletteCommand } from "./components/CommandPalette.js";
import { SnippetsScreen } from "./components/SnippetsScreen.js";
import { NotebookCellView } from "./components/NotebookCellView.js";
import { SettingsModal, type SettingsPage } from "./components/SettingsModal.js";
import { Sidebar } from "./components/Sidebar.js";
import { FindBar } from "./components/FindBar.js";
import { ExplorerPane } from "./components/ExplorerPane.js";
import { FileEditorPane } from "./components/FileEditorPane.js";
import { NotebookToolbar } from "./components/NotebookToolbar.js";
import { StatusBar } from "./components/StatusBar.js";
import { listSnippets, createSnippet, type Snippet } from "./snippets.js";
import { KernelChannel } from "./kernel-channel.js";
import { WidgetManager } from "./widgets/manager.js";
import { WidgetManagerContext } from "./widgets/context.js";
import { notebookToHtml, downloadHtml, printHtml } from "./export.js";
import { appendRichOutput, cellsFromNotebook, countOccurrences, notebookFromCells, tableOfContents } from "./ipynb.js";
import { isCommand, nowLabel, type AppMode, type FileEntry, type KernelSpec, type KernelStatus, type LeftPanel, type NotebookCell, type RichOutput, type RuntimeSession, type SavedProvider, type ThemeName, type VariableRow } from "./types.js";

const initialCells: NotebookCell[] = [
	{
		id: "cell-1",
		kind: "markdown",
		title: "Problem frame",
		content: "# Sub-50M Chess GM\n\nUse this notebook to sketch experiments, execute small probes, and keep outputs attached to the work.",
		cellOpen: true,
		codeOpen: true,
		agentOpen: false,
	},
	{
		id: "cell-2",
		kind: "code",
		title: "Runtime smoke test",
		content: "budget = 50_000_000\ntarget = 'jupyter-provider'\n{'budget': budget, 'target': target}",
		cellOpen: true,
		codeOpen: true,
		agentOpen: true,
	},
	{
		id: "cell-3",
		kind: "code",
		title: "Library smoke test",
		content: "import sys\nimport numpy as np\nimport pandas as pd\n\n{'python': sys.version.split()[0], 'numpy': np.__version__, 'pandas': pd.__version__}",
		cellOpen: true,
		codeOpen: true,
		agentOpen: false,
	},
];

export function App() {
	const [cells, setCells] = useState<NotebookCell[]>(initialCells);
	const [selectedId, setSelectedId] = useState(initialCells[1]?.id ?? initialCells[0].id);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">("checking");
	const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:8888/");
	const [token, setToken] = useState("");
	const [kernelName, setKernelName] = useState("localjupyter");
	const [providerId, setProviderId] = useState<string>();
	const [kernelSpecs, setKernelSpecs] = useState<KernelSpec[]>([]);
	const [activeSession, setActiveSession] = useState<RuntimeSession>();
	const [isConnecting, setIsConnecting] = useState(false);
	const [isExecuting, setIsExecuting] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsPage, setSettingsPage] = useState<SettingsPage>("provider");
	const [vastWizardOpen, setVastWizardOpen] = useState(false);
	const [startupRequirements, setStartupRequirements] = useState("");
	const [startupOnstart, setStartupOnstart] = useState("");
	const [startupSaveState, setStartupSaveState] = useState<"saved" | "saving" | "dirty">("saved");
	const [costPerHour, setCostPerHour] = useState<number | null>(null);
	const [sessionConnectedAt, setSessionConnectedAt] = useState<number | null>(null);
	const [costTick, setCostTick] = useState(0);
	const [dragSrcId, setDragSrcId] = useState<string | null>(null);
	const [dragOverId, setDragOverId] = useState<string | null>(null);
	const [themeName, setThemeName] = useState<ThemeName>(() => (localStorage.getItem("scryer-io:theme") as ThemeName) || "dark");
	const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
	const [statusMessage, setStatusMessage] = useState("Ready");
	const [notebookPath, setNotebookPath] = useState("");
	const [dirtyCellIds, setDirtyCellIds] = useState<Set<string>>(new Set());

	const [kernelStatus, setKernelStatus] = useState<KernelStatus>("unknown");
	const [execCounts, setExecCounts] = useState<Map<string, number>>(new Map());
	const [runningCellId, setRunningCellId] = useState<string>();
	const [queuedCellIds, setQueuedCellIds] = useState<Set<string>>(new Set());
	const [editingCellId, setEditingCellId] = useState<string>();

	const [findOpen, setFindOpen] = useState(false);
	const [findQuery, setFindQuery] = useState("");
	const [replaceQuery, setReplaceQuery] = useState("");
	const [matchIndex, setMatchIndex] = useState(0);

	const [leftPanel, setLeftPanel] = useState<LeftPanel>(null);
	const [appMode, setAppMode] = useState<AppMode>("explorer");
	const [terminalName, setTerminalName] = useState<string>();

	const [snippets, setSnippets] = useState<Snippet[]>([]);
	const [paletteOpen, setPaletteOpen] = useState(false);

	const [variables, setVariables] = useState<VariableRow[]>([]);
	const [variablesLoading, setVariablesLoading] = useState(false);

	const [currentFilePath, setCurrentFilePath] = useState<string>();
	const [fileContent, setFileContent] = useState("");
	const [fileDirty, setFileDirty] = useState(false);
	const [fileTree, setFileTree] = useState<FileEntry[]>([]);
	const [fileDir, setFileDir] = useState("~");
	const [fileOutputs, setFileOutputs] = useState<RichOutput[]>([]);

	const cellRefs = useRef(new Map<string, HTMLElement>());
	const editorRefs = useRef(new Map<string, CodeEditorHandle>());
	const kernelChannelRef = useRef<KernelChannel | null>(null);
	const [widgetManager, setWidgetManager] = useState<WidgetManager | null>(null);
	const selectedIndex = cells.findIndex((cell) => cell.id === selectedId);
	const selectedCell = cells[selectedIndex] ?? cells[0];
	const notebookName = notebookPath ? (notebookPath.split(/[\\/]/).pop() ?? "notebook.ipynb").replace(/\.ipynb$/i, "") || "Untitled" : null;

	useEffect(() => {
		document.title = notebookName ? `Scryer IO · ${notebookName}` : "Scryer IO";
	}, [notebookName]);

	const toc = useMemo(() => tableOfContents(cells), [cells]);
	const matchingCellIds = useMemo(() => {
		if (!findQuery) return [] as string[];
		const target = findQuery.toLowerCase();
		return cells.filter((cell) => cell.content.toLowerCase().includes(target) || cell.title.toLowerCase().includes(target)).map((cell) => cell.id);
	}, [cells, findQuery]);
	const matchCount = useMemo(() => {
		if (!findQuery) return 0;
		return cells.reduce((sum, cell) => sum + countOccurrences(cell.content, findQuery) + countOccurrences(cell.title, findQuery), 0);
	}, [cells, findQuery]);

	useEffect(() => {
		localStorage.setItem("scryer-io:theme", themeName);
	}, [themeName]);

	// Keyboard shortcuts (global)
	useEffect(() => {
		const handleKey = (event: globalThis.KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.code === "KeyK") {
				event.preventDefault();
				setPaletteOpen((open) => !open);
			} else if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "KeyR") {
				event.preventDefault();
				restartKernelAndClearOutputs();
			} else if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "KeyK") {
				event.preventDefault();
				killKernel();
			} else if ((event.metaKey || event.ctrlKey) && event.code === "KeyF") {
				event.preventDefault();
				setFindOpen(true);
			} else if ((event.metaKey || event.ctrlKey) && event.code === "KeyS") {
				event.preventDefault();
				saveNotebook();
			} else if (event.code === "Escape" && findOpen) {
				setFindOpen(false);
			}
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [cells, providerId, activeSession, findOpen]);

	// Initial load
	useEffect(() => {
		fetch("/api/startup").then((r) => r.json()).then((d) => {
			setStartupRequirements(d.requirements ?? "");
			setStartupOnstart(d.onstart ?? "");
		}).catch(() => undefined);
		fetch("/api/healthz").then((res) => setApiStatus(res.ok ? "online" : "offline")).catch(() => setApiStatus("offline"));
		refreshSnippets();
		loadFiles(".");
		fetch("/api/runtime/providers").then((res) => res.json()).then((json) => {
			const provider = (json.providers ?? [])[0] as SavedProvider | undefined;
			if (!provider) return;
			setProviderId(provider.id);
			setBaseUrl(provider.baseUrl);
			setToken(provider.token ?? "");
			setKernelName(provider.defaultKernelName ?? "localjupyter");
			setActiveSession(json.activeSession);
			fetch(`/api/runtime/providers/${provider.id}/kernelspecs`)
				.then((res) => res.ok ? res.json() : undefined)
				.then((specs) => { if (specs?.kernelSpecs) setKernelSpecs(specs.kernelSpecs); })
				.catch(() => undefined);
		}).catch(() => undefined);
	}, []);

	// Autosave every 30s when dirty
	const autosaveRef = useRef(() => {});
	autosaveRef.current = () => { if (saveState === "dirty") saveNotebook(); };
	useEffect(() => {
		const timer = setInterval(() => autosaveRef.current(), 30000);
		return () => clearInterval(timer);
	}, []);

	// Live session channel + widget manager: live while a kernel session is
	// active. The manager rides the channel for all ipywidgets comm traffic.
	useEffect(() => {
		if (!providerId || !activeSession) { kernelChannelRef.current = null; setWidgetManager(null); return; }
		const channel = new KernelChannel(providerId, activeSession.id);
		kernelChannelRef.current = channel;
		const manager = new WidgetManager(channel);
		setWidgetManager(manager);
		return () => { manager.dispose(); channel.close(); kernelChannelRef.current = null; setWidgetManager(null); };
	}, [providerId, activeSession?.id]);

	// Kernel status polling every 2s
	useEffect(() => {
		if (!providerId || !activeSession) { setKernelStatus("unknown"); return; }
		let cancelled = false;
		const poll = () => {
			fetch(`/api/runtime/providers/${providerId}/kernel-status?sessionId=${encodeURIComponent(activeSession.id)}`)
				.then((res) => res.ok ? res.json() : undefined)
				.then((json) => {
					if (cancelled || !json) return;
					const status = json.status as string;
					setKernelStatus(status === "idle" || status === "busy" || status === "dead" ? status : "unknown");
				})
				.catch(() => undefined);
		};
		poll();
		const timer = setInterval(poll, 2000);
		return () => { cancelled = true; clearInterval(timer); };
	}, [providerId, activeSession, isExecuting]);

	function setStatus(message: string) {
		setStatusMessage(message);
	}

	function markDirty(id?: string) {
		setSaveState("dirty");
		if (id) setDirtyCellIds((current) => new Set(current).add(id));
	}

	function patchCell(id: string, patch: Partial<NotebookCell>) {
		markDirty(id);
		setCells((current) => current.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell)));
	}

	function clearCellOutput(cellId: string) {
		patchCell(cellId, { outputs: undefined, outputOpen: false, lastRun: undefined, elapsedMs: undefined });
		setExecCounts((current) => { const next = new Map(current); next.delete(cellId); return next; });
		setStatus("Cleared cell output");
	}

	async function saveNotebook() {
		setSaveState("saving");
		setStatus("Saving notebook…");
		await fetch("/api/notebook", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(notebookFromCells(cells)),
		});
		setDirtyCellIds(new Set());
		setSaveState("saved");
		setStatus("Notebook saved");
	}

	async function openNotebook(path: string) {
		if (dirtyCellIds.size && !window.confirm("Discard unsaved changes?")) return;
		setStatus("Opening notebook…");
		const res = await fetch("/api/notebook/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
		const json = await res.json();
		if (!res.ok) { setStatus("Open failed: " + (json.error ?? "unknown error")); return; }
		const loadedCells = cellsFromNotebook(json);
		setNotebookPath(json.metadata?.scryer?.path ?? path);
		setCells(loadedCells.length ? loadedCells : initialCells);
		setSelectedId((loadedCells[0] ?? initialCells[0]).id);
		setDirtyCellIds(new Set());
		setSaveState("saved");
		setStatus(`Opened ${path}`);
		setAppMode("notebook");
	}

	async function newNotebook() {
		if (dirtyCellIds.size && !window.confirm("Discard unsaved changes?")) return;
		const base = fileDir === "." ? "" : fileDir + "/";
		const path = `${base}Untitled-${Date.now()}.ipynb`;
		setStatus("Creating notebook…");
		const res = await fetch("/api/notebook/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
		const json = await res.json();
		if (!res.ok) { setStatus("Create failed: " + (json.error ?? "unknown error")); return; }
		setNotebookPath(json.metadata?.scryer?.path ?? path);
		setCells(initialCells);
		setSelectedId(initialCells[0].id);
		setDirtyCellIds(new Set(initialCells.map((cell) => cell.id)));
		setSaveState("dirty");
		setStatus(`Created ${path}`);
		setAppMode("notebook");
	}

	async function closeNotebook() {
		if (dirtyCellIds.size && !window.confirm("Discard unsaved changes?")) return;
		await fetch("/api/notebook/close", { method: "POST" });
		setNotebookPath("");
		setCells(initialCells);
		setSelectedId(initialCells[0].id);
		setDirtyCellIds(new Set());
		setSaveState("saved");
		setStatus("Notebook closed");
		setAppMode("explorer");
		loadFiles(fileDir);
	}

	function closeFile() {
		if (fileDirty && !window.confirm("Discard unsaved file changes?")) return;
		setCurrentFilePath(undefined);
		setFileContent("");
		setFileDirty(false);
		setFileOutputs([]);
		setAppMode("explorer");
		loadFiles(fileDir);
	}

	function moveSelected(delta: -1 | 1) {
		if (selectedIndex < 0) return;
		const nextIndex = selectedIndex + delta;
		if (nextIndex < 0 || nextIndex >= cells.length) return;
		markDirty(selectedId);
		setCells((current) => {
			const next = [...current];
			const [cell] = next.splice(selectedIndex, 1);
			next.splice(nextIndex, 0, cell);
			return next;
		});
	}

	async function connectProvider() {
		setIsConnecting(true);
		setStatus("Connecting provider…");
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
			setStatus(`Connected to ${json.provider.label ?? json.provider.id}`);
		} catch (err: any) {
			setProviderId(undefined);
			setKernelSpecs([]);
			setStatus(err?.message ?? "Provider connection failed");
			console.error(err);
		} finally {
			setIsConnecting(false);
		}
	}

	async function disconnectProvider() {
		if (!providerId) return;
		setIsConnecting(true);
		setStatus("Disconnecting provider…");
		try { await fetch(`/api/runtime/providers/${providerId}`, { method: "DELETE" }); }
		finally {
			setProviderId(undefined);
			setKernelSpecs([]);
			setActiveSession(undefined);
			setIsConnecting(false);
			setStatus("Provider disconnected");
		}
	}

	function toggleProviderConnection() {
		if (providerId) disconnectProvider();
		else connectProvider();
	}

	async function handleVastConnected(newProviderId: string, label: string, cost?: number) {
		setProviderId(newProviderId);
		setStatus(`Connected to ${label}`);
		if (cost) { setCostPerHour(cost); setSessionConnectedAt(Date.now()); }
		try {
			const r = await fetch(`/api/runtime/providers/${newProviderId}/kernelspecs`);
			const d = await r.json();
			if (r.ok && Array.isArray(d.kernelSpecs)) setKernelSpecs(d.kernelSpecs);
		} catch { /* best-effort */ }
	}

	useEffect(() => {
		if (!costPerHour) return;
		const id = setInterval(() => setCostTick((t) => t + 1), 1000);
		return () => clearInterval(id);
	}, [costPerHour]);

	function handleDragStart(cellId: string) { setDragSrcId(cellId); }
	function handleDragOver(e: React.DragEvent, cellId: string) { e.preventDefault(); setDragOverId(cellId); }
	function handleDragEnd() { setDragSrcId(null); setDragOverId(null); }
	function handleDrop(e: React.DragEvent, targetId: string) {
		e.preventDefault();
		if (dragSrcId && dragSrcId !== targetId) {
			setCells((prev) => {
				const next = [...prev];
				const si = next.findIndex((c) => c.id === dragSrcId);
				const ti = next.findIndex((c) => c.id === targetId);
				const [cell] = next.splice(si, 1);
				next.splice(ti, 0, cell);
				return next;
			});
		}
		setDragSrcId(null);
		setDragOverId(null);
	}

	function exportToPy() {
		const lines: string[] = [];
		for (const cell of cells) {
			if (cell.kind === "code") {
				lines.push(`# %% ${cell.title || "Cell"}`);
				lines.push(cell.content);
				lines.push("");
			} else if (cell.kind === "markdown") {
				lines.push("# %% [markdown]");
				lines.push(...cell.content.split("\n").map((l) => `# ${l}`));
				lines.push("");
			}
		}
		const blob = new Blob([lines.join("\n")], { type: "text/x-python" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = (notebookPath.split("/").pop() ?? "notebook").replace(/\.ipynb$/i, "") + ".py";
		a.click();
		URL.revokeObjectURL(url);
	}

	function exportToHtml() {
		const title = notebookName ?? "notebook";
		downloadHtml(notebookToHtml(cells, execCounts, { title, includeOutputs: true }), `${title}.html`);
		setStatus("Exported notebook as HTML");
	}

	function exportToPdf() {
		const title = notebookName ?? "notebook";
		printHtml(notebookToHtml(cells, execCounts, { title, includeOutputs: true }));
		setStatus("Opened print view — choose “Save as PDF”");
	}

	async function switchKernel(name: string) {
		setKernelName(name);
		if (!providerId) return;
		setStatus(`Switching kernel to ${name}…`);
		try {
			const res = await fetch(`/api/runtime/providers/${providerId}/sessions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: `scryer-io-${Date.now()}.ipynb`, kernelName: name }),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to switch kernel");
			setActiveSession(json.session);
			setStatus(`Started ${name} kernel`);
		} catch (err: any) {
			setStatus(err?.message ?? "Kernel switch failed");
		}
	}

	async function streamExecute(code: string, onOutput: (output: RichOutput) => void, onDone: (event: any) => void) {
		const res = await fetch(`/api/runtime/providers/${providerId}/execute/stream`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code, sessionId: activeSession?.id, kernelName: kernelName || undefined }),
		});
		if (!res.ok || !res.body) {
			const json = await res.json().catch(() => undefined);
			throw new Error(json?.error ?? "Execution failed");
		}
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		const handleEvent = (event: any) => {
			if (event.type === "output") onOutput(event.output as RichOutput);
			else if (event.type === "done") onDone(event);
			else if (event.type === "error") throw new Error(event.error ?? "Execution failed");
		};
		while (true) {
			const { value, done } = await reader.read();
			buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) if (line.trim()) handleEvent(JSON.parse(line));
			if (done) break;
		}
		if (buffer.trim()) handleEvent(JSON.parse(buffer));
	}

	/** Returns true when the cell ran without producing an error output. */
	async function executeCell(cell: NotebookCell): Promise<boolean> {
		if (cell.kind !== "code") {
			setStatus(`Rendered ${cell.title || "cell"}`);
			patchCell(cell.id, { outputOpen: true, lastRun: nowLabel(), elapsedMs: 0 });
			return true;
		}
		if (!providerId) {
			setStatus("Connect a Jupyter provider before executing code");
			patchCell(cell.id, { outputOpen: true, outputs: [{ kind: "stream", name: "stderr", text: "Connect a Jupyter provider before executing code." }] });
			return false;
		}
		setStatus(`Running ${cell.title || "cell"}…`);
		setRunningCellId(cell.id);
		setQueuedCellIds((current) => { const next = new Set(current); next.delete(cell.id); return next; });
		markDirty(cell.id);
		setCells((current) => current.map((item) => item.id === cell.id ? { ...item, outputOpen: true, outputs: [] } : item));
		const stamp = nowLabel();
		let errored = false;
		try {
			await streamExecute(
				cell.content,
				(output) => {
					if (output.kind === "error") errored = true;
					setCells((current) => current.map((item) => item.id === cell.id ? { ...item, outputs: appendRichOutput(item.outputs ?? [], output) } : item));
				},
				(event) => {
					setActiveSession(event.session);
					setCells((current) => current.map((item) => item.id === cell.id ? { ...item, lastRun: stamp, elapsedMs: event.elapsedMs, outputOpen: true } : item));
					if (typeof event.executionCount === "number") {
						setExecCounts((current) => new Map(current).set(cell.id, event.executionCount));
					}
					setStatus(`Finished ${cell.title || "cell"} in ${event.elapsedMs}ms`);
				},
			);
		} finally {
			setRunningCellId(undefined);
		}
		return !errored;
	}

	async function executeCells(targetCells: NotebookCell[], stopOnError = true) {
		setIsExecuting(true);
		// Code cells beyond the first are queued so the UI shows what's pending.
		setQueuedCellIds(new Set(targetCells.slice(1).filter((cell) => cell.kind === "code").map((cell) => cell.id)));
		try {
			for (const cell of targetCells) {
				const ok = await executeCell(cell);
				if (!ok && stopOnError) {
					const remaining = targetCells.length - targetCells.indexOf(cell) - 1;
					if (remaining > 0) setStatus(`Halted on error in ${cell.title || "cell"} — ${remaining} cell${remaining === 1 ? "" : "s"} skipped`);
					break;
				}
			}
		}
		catch (err: any) { setStatus(err?.message ?? "Execution failed"); if (selectedCell) patchCell(selectedCell.id, { outputOpen: true, outputs: [{ kind: "stream", name: "stderr", text: err?.message ?? String(err) }] }); }
		finally { setIsExecuting(false); setRunningCellId(undefined); setQueuedCellIds(new Set()); }
	}

	async function formatSource(code: string): Promise<string | null> {
		try {
			const res = await fetch("/api/format", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
			const json = await res.json();
			if (!res.ok) { setStatus(json.error ?? "Format failed"); return null; }
			if (!json.available) { setStatus("ruff is not installed on the server"); return null; }
			return json.formatted as string;
		} catch (err: any) { setStatus(err?.message ?? "Format failed"); return null; }
	}

	async function formatCell() {
		if (!selectedCell || selectedCell.kind !== "code") { setStatus("Select a code cell to format"); return; }
		const formatted = await formatSource(selectedCell.content);
		if (formatted != null && formatted !== selectedCell.content) { patchCell(selectedCell.id, { content: formatted }); setStatus("Formatted cell"); }
		else if (formatted != null) setStatus("Cell already formatted");
	}

	async function formatNotebook() {
		let changed = 0;
		for (const cell of cells) {
			if (cell.kind !== "code" || !cell.content.trim()) continue;
			const formatted = await formatSource(cell.content);
			if (formatted != null && formatted !== cell.content) { patchCell(cell.id, { content: formatted }); changed += 1; }
		}
		setStatus(`Formatted ${changed} cell${changed === 1 ? "" : "s"}`);
	}

	function runAll() { executeCells(cells); }
	function runAllAbove() { if (selectedIndex > 0) executeCells(cells.slice(0, selectedIndex)); }
	function runAllBelow() { if (selectedIndex >= 0) executeCells(cells.slice(selectedIndex)); }

	async function restartAndRunAll() {
		await restartKernelAndClearOutputs();
		if (providerId && activeSession) executeCells(cells);
	}

	function runSelection() {
		if (selectedIds.size > 1) {
			const ordered = cells.filter((cell) => selectedIds.has(cell.id));
			executeCells(ordered);
		} else if (selectedCell) {
			executeCells([selectedCell]);
		}
	}

	async function restartKernel() {
		if (!providerId || !activeSession) { setStatus("No active kernel to restart"); return; }
		setIsExecuting(true);
		setStatus("Restarting kernel…");
		try {
			const res = await fetch(`/api/runtime/providers/${providerId}/restart`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: activeSession.id }),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Restart failed");
			setStatus("Kernel restarted");
		} catch (err: any) { setStatus(err?.message ?? "Restart failed"); console.error(err); }
		finally { setIsExecuting(false); }
	}

	async function killKernel() {
		if (!providerId || !activeSession) { setStatus("No active kernel to shut down"); return; }
		if (!window.confirm("Shut down the kernel? Session state will be lost.")) return;
		setStatus("Shutting down kernel…");
		try {
			const res = await fetch(`/api/runtime/providers/${providerId}/shutdown`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: activeSession.id }),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Shutdown failed");
			setActiveSession(undefined);
			setKernelStatus("dead");
			setStatus("Kernel shut down");
		} catch (err: any) { setStatus(err?.message ?? "Shutdown failed"); console.error(err); }
	}

	async function interruptKernel() {
		if (!providerId || !activeSession) { setStatus("No active kernel to interrupt"); return; }
		setStatus("Interrupting kernel…");
		try {
			await fetch(`/api/runtime/providers/${providerId}/interrupt`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: activeSession.id }),
			});
			setStatus("Kernel interrupted");
		} finally { setIsExecuting(false); setQueuedCellIds(new Set()); }
	}

	async function loadVariables() {
		if (!providerId) { setStatus("Connect a provider to inspect variables"); return; }
		setVariablesLoading(true);
		setStatus("Loading variables…");
		try {
			const res = await fetch(`/api/runtime/providers/${providerId}/variables`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: activeSession?.id, kernelName: kernelName || undefined }),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to load variables");
			setVariables(json.variables ?? []);
			setStatus(`Loaded ${json.variables?.length ?? 0} variables`);
		} catch (err: any) {
			setStatus(err?.message ?? "Failed to load variables");
		} finally { setVariablesLoading(false); }
	}

	function clearOutputs() {
		markDirty();
		setDirtyCellIds(new Set(cells.map((cell) => cell.id)));
		setCells((current) => current.map((cell) => ({ ...cell, outputs: undefined, outputOpen: false, lastRun: undefined, elapsedMs: undefined })));
		setExecCounts(new Map());
		setStatus("Cleared all outputs");
	}

	async function restartKernelAndClearOutputs() {
		if (!providerId || !activeSession) { setStatus("No active kernel to restart"); return; }
		setIsExecuting(true);
		setStatus("Restarting kernel and clearing outputs…");
		try {
			const res = await fetch(`/api/runtime/providers/${providerId}/restart`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: activeSession.id }),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Restart failed");
			markDirty();
			setDirtyCellIds(new Set(cells.map((cell) => cell.id)));
			setCells((current) => current.map((cell) => ({ ...cell, outputs: undefined, outputOpen: false, lastRun: undefined, elapsedMs: undefined })));
			setExecCounts(new Map());
			setStatus("Kernel restarted; outputs cleared");
		} catch (err: any) {
			setStatus(err?.message ?? "Restart failed");
			console.error(err);
		} finally { setIsExecuting(false); }
	}

	function addCell(position: "above" | "below" = "below", anchorId = selectedId) {
		const id = `cell-${Date.now()}`;
		const cell: NotebookCell = { id, kind: "code", title: "Untitled", content: "", cellOpen: true, codeOpen: true, agentOpen: false, outputOpen: false };
		markDirty(id);
		setStatus(`Added cell ${position}`);
		setCells((current) => {
			const anchorIndex = current.findIndex((item) => item.id === anchorId);
			const fallback = position === "above" ? 0 : current.length;
			const insertAt = anchorIndex >= 0 ? anchorIndex + (position === "below" ? 1 : 0) : fallback;
			const next = [...current];
			next.splice(insertAt, 0, cell);
			return next;
		});
		focusCell(id);
	}

	function deleteSelected() {
		if (cells.length <= 1 || selectedIndex < 0) return;
		markDirty();
		setStatus("Deleted selected cell");
		setCells((current) => current.filter((cell) => cell.id !== selectedId));
		setSelectedId(cells[Math.max(0, selectedIndex - 1)]?.id ?? cells[0].id);
	}

	function duplicateSelected() {
		if (!selectedCell) return;
		const id = `cell-${Date.now()}`;
		const clone = { ...selectedCell, id, title: `${selectedCell.title} copy` };
		markDirty(id);
		setStatus("Duplicated selected cell");
		setCells((current) => {
			const next = [...current];
			next.splice(selectedIndex + 1, 0, clone);
			return next;
		});
		focusCell(id);
	}

	async function refreshSnippets() {
		try { setSnippets(await listSnippets()); }
		catch (err: any) { setStatus(err?.message ?? "Failed to load snippets"); }
	}

	async function saveCellsAsSnippet(name: string) {
		const targets = selectedIds.size > 1 ? cells.filter((cell) => selectedIds.has(cell.id)) : selectedCell ? [selectedCell] : [];
		if (!targets.length) { setStatus("No cell selected to save"); return; }
		try {
			await createSnippet({ name, cells: targets.map((cell) => ({ kind: cell.kind, title: cell.title, content: cell.content })) });
			await refreshSnippets();
			setStatus(`Saved snippet “${name}”`);
		} catch (err: any) {
			setStatus(err?.message ?? "Failed to save snippet");
		}
	}

	// The single chokepoint for snippet insertion. Today it splices `ready` cells
	// directly; once the overlay/approve machinery lands it swaps to enqueueing an
	// `insert` patch — and nothing else in the app has to change.
	function insertSnippet(snippet: Snippet, anchorId = selectedId) {
		if (!snippet.cells.length) return;
		const stamp = Date.now();
		const inserted: NotebookCell[] = snippet.cells.map((source, index) => ({
			id: `cell-${stamp}-${index}`,
			kind: source.kind,
			title: source.title || "Untitled",
			content: source.content,
			cellOpen: true,
			codeOpen: true,
			agentOpen: false,
			outputOpen: source.kind !== "code",
		}));
		setCells((current) => {
			const anchorIndex = current.findIndex((item) => item.id === anchorId);
			const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : current.length;
			const next = [...current];
			next.splice(insertAt, 0, ...inserted);
			return next;
		});
		setSaveState("dirty");
		setDirtyCellIds((ids) => { const next = new Set(ids); for (const cell of inserted) next.add(cell.id); return next; });
		setStatus(`Inserted snippet “${snippet.name}”`);
		setAppMode("notebook");
		focusCell(inserted[0].id);
	}

	function focusCell(id: string) {
		setSelectedId(id);
		setSelectedIds(new Set());
		setEditingCellId(undefined);
		requestAnimationFrame(() => {
			const el = cellRefs.current.get(id);
			el?.focus();
			el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
		});
	}

	function scrollToCell(id: string) {
		setSelectedId(id);
		requestAnimationFrame(() => cellRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
	}

	function focusEditor(id: string) {
		setEditingCellId(id);
		patchCell(id, { cellOpen: true, codeOpen: true });
		requestAnimationFrame(() => editorRefs.current.get(id)?.focus());
	}

	async function executeAndAdvance(cell: NotebookCell) {
		await executeCells([cell]);
		const idx = cells.findIndex((c) => c.id === cell.id);
		if (idx >= 0 && idx < cells.length - 1) {
			focusCell(cells[idx + 1].id);
		} else {
			addCell("below", cell.id);
		}
	}

	function collapseCellFully(cell: NotebookCell) {
		patchCell(cell.id, { cellOpen: false, codeOpen: false, outputOpen: false, agentOpen: false });
		focusCell(cell.id);
	}

	function handleCellClick(event: ReactMouseLikeEvent, cell: NotebookCell, index: number) {
		if (event.shiftKey) {
			const anchorIndex = selectedIndex >= 0 ? selectedIndex : index;
			const [lo, hi] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
			const range = new Set(cells.slice(lo, hi + 1).map((item) => item.id));
			setSelectedIds(range);
			setSelectedId(cell.id);
		} else if (event.metaKey || event.ctrlKey) {
			setSelectedIds((current) => {
				const next = new Set(current);
				if (next.has(cell.id)) next.delete(cell.id); else next.add(cell.id);
				if (selectedId) next.add(selectedId);
				return next;
			});
			setSelectedId(cell.id);
		} else {
			setSelectedIds(new Set());
			setSelectedId(cell.id);
		}
	}

	function handleCellKeyCapture(event: KeyboardEvent, cell: NotebookCell) {
		if (isCommand(event, "KeyS")) { event.preventDefault(); event.stopPropagation(); saveNotebook(); }
	}

	function handleWorkbenchKeyCapture(event: KeyboardEvent) {
		const target = event.target as HTMLElement;
		const isFormTarget = ["TEXTAREA", "INPUT", "SELECT"].includes(target.tagName);
		if (!isFormTarget && event.key === "Tab" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !settingsOpen) {
			event.preventDefault();
			event.stopPropagation();
			focusCell(selectedId || cells[0]?.id);
		}
	}

	function handleCellKey(event: KeyboardEvent, cell: NotebookCell) {
		const target = event.target as HTMLElement;
		const inEditor = Boolean(target.closest(".cm-editor"));
		const inForm = ["TEXTAREA", "INPUT", "SELECT"].includes(target.tagName);
		const inText = inEditor || inForm;

		// Bindings that fire even when editor is focused
		if (isCommand(event, "KeyS")) { event.preventDefault(); event.stopPropagation(); saveNotebook(); return; }
		// Only run from article-level if CodeMirror didn't already handle it (it calls preventDefault but not stopPropagation)
		if (isCommand(event, "Enter") && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); executeCells([cell]); return; }
		if (!inText && event.shiftKey && event.code === "Enter" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); executeAndAdvance(cell); return; }

		// Command-mode only bindings (not when editor is focused)
		if (inText) return;

		const cellIndex = cells.findIndex((c) => c.id === cell.id);

		if (event.code === "ArrowUp" || event.code === "KeyK") {
			event.preventDefault();
			if (event.shiftKey) {
				// Extend selection upward
				const lo = Math.max(0, cellIndex - 1);
				const anchor = selectedIndex >= 0 ? selectedIndex : cellIndex;
				const [a, b] = anchor < lo ? [anchor, lo] : [lo, anchor];
				setSelectedIds(new Set(cells.slice(a, b + 1).map((c) => c.id)));
				setSelectedId(cells[lo].id);
			} else {
				const prev = cells[Math.max(0, cellIndex - 1)];
				if (prev) focusCell(prev.id);
			}
			return;
		}
		if (event.code === "ArrowDown" || event.code === "KeyJ") {
			event.preventDefault();
			if (event.shiftKey) {
				const hi = Math.min(cells.length - 1, cellIndex + 1);
				const anchor = selectedIndex >= 0 ? selectedIndex : cellIndex;
				const [a, b] = anchor < hi ? [anchor, hi] : [hi, anchor];
				setSelectedIds(new Set(cells.slice(a, b + 1).map((c) => c.id)));
				setSelectedId(cells[hi].id);
			} else {
				const next = cells[Math.min(cells.length - 1, cellIndex + 1)];
				if (next) focusCell(next.id);
			}
			return;
		}
		if (event.code === "Enter") { event.preventDefault(); focusEditor(cell.id); return; }
		if (event.shiftKey && event.code === "Enter") { event.preventDefault(); executeAndAdvance(cell); return; }
		if (event.code === "Escape") { event.preventDefault(); collapseCellFully(cell); return; }
		if (event.code === "KeyA" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); addCell("above", cell.id); return; }
		if (event.code === "KeyB" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); addCell("below", cell.id); return; }
		if (event.code === "KeyM") { event.preventDefault(); patchCell(cell.id, { kind: "markdown", outputOpen: true }); return; }
		if (event.code === "KeyY") { event.preventDefault(); patchCell(cell.id, { kind: "code" }); return; }
		if (event.code === "KeyO") { event.preventDefault(); patchCell(cell.id, { outputOpen: !cell.outputOpen }); return; }
		if (event.code === "Delete" || event.code === "Backspace") { event.preventDefault(); deleteSelected(); return; }
		if ((event.metaKey || event.ctrlKey) && event.code === "KeyX") { event.preventDefault(); deleteSelected(); return; }
	}

	// Find & replace
	function gotoMatch(delta: number) {
		if (!matchingCellIds.length) return;
		const next = (matchIndex + delta + matchingCellIds.length) % matchingCellIds.length;
		setMatchIndex(next);
		scrollToCell(matchingCellIds[next]);
	}

	function replaceCurrent() {
		if (!findQuery || !matchingCellIds.length) return;
		const cellId = matchingCellIds[Math.min(matchIndex, matchingCellIds.length - 1)];
		const cell = cells.find((item) => item.id === cellId);
		if (!cell) return;
		const lower = cell.content.toLowerCase();
		const idx = lower.indexOf(findQuery.toLowerCase());
		if (idx >= 0) {
			patchCell(cellId, { content: cell.content.slice(0, idx) + replaceQuery + cell.content.slice(idx + findQuery.length) });
			setStatus("Replaced match");
		}
	}

	function replaceAll() {
		if (!findQuery) return;
		const re = new RegExp(findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
		let replaced = 0;
		setCells((current) => current.map((cell) => {
			const nextContent = cell.content.replace(re, () => { replaced += 1; return replaceQuery; });
			const nextTitle = cell.title.replace(re, replaceQuery);
			if (nextContent !== cell.content || nextTitle !== cell.title) {
				setDirtyCellIds((ids) => new Set(ids).add(cell.id));
				return { ...cell, content: nextContent, title: nextTitle };
			}
			return cell;
		}));
		setSaveState("dirty");
		setStatus(`Replaced ${replaced} occurrence${replaced === 1 ? "" : "s"}`);
	}

	function cycleLeftPanel() {
		setLeftPanel((current) => {
			const order: LeftPanel[] = ["toc", "files", "variables", null];
			const idx = order.indexOf(current);
			const next = order[(idx + 1) % order.length];
			if (next === "files") loadFiles(".");
			if (next === "variables") loadVariables();
			return next;
		});
	}

	// File browser / IDE
	async function loadFiles(path: string) {
		try {
			const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to list files");
			setFileTree(json.entries ?? []);
			setFileDir(json.path ?? path);
		} catch (err: any) {
			setStatus(err?.message ?? "Failed to list files");
		}
	}

	async function openFile(entry: FileEntry) {
		if (entry.isDir) { loadFiles(entry.path); return; }
		if (entry.path.endsWith(".ipynb")) { await openNotebook(entry.path); return; }
		if (fileDirty && !window.confirm("Discard unsaved file changes?")) return;
		try {
			const res = await fetch(`/api/files/read?path=${encodeURIComponent(entry.path)}`);
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Failed to read file");
			setCurrentFilePath(json.path);
			setFileContent(json.content ?? "");
			setFileDirty(false);
			setFileOutputs([]);
			setAppMode("file");
			setStatus(`Opened ${json.path}`);
		} catch (err: any) {
			setStatus(err?.message ?? "Failed to read file");
		}
	}

	async function saveFile() {
		if (!currentFilePath) return;
		try {
			const res = await fetch("/api/files/write", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path: currentFilePath, content: fileContent }),
			});
			if (!res.ok) { const json = await res.json().catch(() => undefined); throw new Error(json?.error ?? "Failed to save file"); }
			setFileDirty(false);
			setStatus(`Saved ${currentFilePath}`);
		} catch (err: any) {
			setStatus(err?.message ?? "Failed to save file");
		}
	}

	async function runFile() {
		if (!providerId) { setStatus("Connect a provider to run files"); return; }
		setIsExecuting(true);
		setFileOutputs([]);
		setStatus(`Running ${currentFilePath ?? "file"}…`);
		try {
			await streamExecute(
				fileContent,
				(output) => setFileOutputs((current) => appendRichOutput(current, output)),
				(event) => { setActiveSession(event.session); setStatus(`Finished file in ${event.elapsedMs}ms`); },
			);
		} catch (err: any) {
			setFileOutputs((current) => [...current, { kind: "stream", name: "stderr", text: err?.message ?? String(err) }]);
			setStatus(err?.message ?? "File execution failed");
		} finally { setIsExecuting(false); }
	}

	const fileLanguage: "python" | "markdown" = currentFilePath?.endsWith(".md") ? "markdown" : "python";
	const sidebarOpen = leftPanel !== null && appMode === "notebook";

	const paletteCommands: PaletteCommand[] = [
		// Notebook / file
		{ id: "save-notebook", label: "Save notebook", hint: "⌘S", icon: faFloppyDisk, group: "notebook", run: saveNotebook },
		{ id: "new-notebook", label: "New notebook", icon: faPlus, group: "notebook", run: newNotebook },
		{ id: "export-html", label: "Export as HTML", icon: faFileExport, group: "notebook", run: exportToHtml },
		{ id: "export-pdf", label: "Export as PDF", icon: faFileExport, group: "notebook", run: exportToPdf },
		{ id: "export-py", label: "Export as Python (.py)", icon: faFileExport, group: "notebook", run: exportToPy },
		// Execution
		{ id: "run-selection", label: "Run selected cell", hint: "⌘↵", icon: faPlay, group: "run", run: runSelection },
		{ id: "run-all", label: "Run all cells", icon: faForwardStep, group: "run", run: runAll },
		{ id: "run-all-above", label: "Run all cells above", icon: faAnglesUp, group: "run", run: runAllAbove },
		{ id: "run-all-below", label: "Run all cells below", icon: faAnglesDown, group: "run", run: runAllBelow },
		{ id: "restart-run-all", label: "Restart kernel and run all", icon: faForwardStep, group: "run", run: restartAndRunAll },
		{ id: "restart-kernel", label: "Restart kernel", icon: faRotateRight, group: "run", run: restartKernel },
		{ id: "restart-clear", label: "Restart kernel and clear outputs", hint: "⇧⌘R", icon: faRotateRight, group: "run", run: restartKernelAndClearOutputs },
		{ id: "clear-outputs", label: "Clear all outputs", icon: faEraser, group: "run", run: clearOutputs },
		// Edit
		{ id: "format-cell", label: "Format cell", icon: faWandMagicSparkles, group: "edit", run: formatCell },
		{ id: "format-notebook", label: "Format notebook", icon: faWandMagicSparkles, group: "edit", run: formatNotebook },
		// View / appearance
		{ id: "find", label: "Find & replace", hint: "⌘F", icon: faMagnifyingGlass, group: "view", run: () => setFindOpen(true) },
		{ id: "theme-light", label: "Light theme", hint: themeName === "light" ? "current" : undefined, icon: faSun, group: "view", run: () => setThemeName("light") },
		{ id: "theme-dark", label: "Dark theme", hint: themeName === "dark" ? "current" : undefined, icon: faMoon, group: "view", run: () => setThemeName("dark") },
		{ id: "settings", label: "Open settings", icon: faGear, group: "view", run: () => setSettingsOpen(true) },
	];

	return (
		<WidgetManagerContext.Provider value={widgetManager}>
		<div className="app-shell" data-theme={themeName} onKeyDownCapture={handleWorkbenchKeyCapture}>
			<header className="topbar">
				<div className="brand-block"><h1 title={notebookPath}>Scryer IO{notebookName ? ` · ${notebookName}` : ""}</h1></div>
				<div className="topbar-right">
				<button className="ghost-button icon-button theme-toggle" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}><FontAwesomeIcon icon={faGear} /></button>
				<button className="ghost-button theme-toggle" title={`Switch to ${themeName === "dark" ? "light" : "dark"} theme`} onClick={() => setThemeName(themeName === "dark" ? "light" : "dark")} aria-label="Toggle theme">{themeName === "dark" ? "☀" : "◑"}</button>
				</div>
			</header>

			<div className="app-mode-tabs" role="tablist" aria-label="Workspace mode">
				<button role="tab" aria-selected={appMode === "explorer"} className={appMode === "explorer" ? "active" : ""} onClick={() => { setAppMode("explorer"); loadFiles(fileDir); }}><FontAwesomeIcon icon={faFolderOpen} /> Explorer</button>
				{notebookName && <button role="tab" aria-selected={appMode === "notebook"} className={`app-tab ${appMode === "notebook" ? "active" : ""}`} onClick={() => setAppMode("notebook")}><FontAwesomeIcon icon={faFile} />{notebookName}<span className="tab-close-btn" onClick={(e) => { e.stopPropagation(); closeNotebook(); }}><FontAwesomeIcon icon={faXmark} /></span></button>}
				{currentFilePath && <button role="tab" aria-selected={appMode === "file"} className={`app-tab ${appMode === "file" ? "active" : ""}`} onClick={() => setAppMode("file")}><FontAwesomeIcon icon={faFile} />{currentFilePath.split("/").pop()}<span className="tab-close-btn" onClick={(e) => { e.stopPropagation(); closeFile(); }}><FontAwesomeIcon icon={faXmark} /></span></button>}
				<button role="tab" aria-selected={appMode === "snippets"} className={appMode === "snippets" ? "active" : ""} onClick={() => { setAppMode("snippets"); refreshSnippets(); }}><FontAwesomeIcon icon={faLayerGroup} /> Snippets</button>
				<button role="tab" aria-selected={appMode === "terminal"} className={appMode === "terminal" ? "active" : ""} onClick={() => setAppMode("terminal")}><FontAwesomeIcon icon={faTerminal} /> Terminal</button>
			</div>

			{appMode === "notebook" && (
				<NotebookToolbar
					saving={saveState === "saving"}
					isExecuting={isExecuting}
					hasSession={Boolean(activeSession)}
					canMoveUp={selectedIndex > 0}
					canMoveDown={selectedIndex >= 0 && selectedIndex < cells.length - 1}
					canDelete={cells.length > 1}
					runLabel={selectedIds.size > 1 ? `Execute ${selectedIds.size} selected cells` : "Execute cell"}
					onSave={saveNotebook}
					onToggleSidebar={cycleLeftPanel}
					onToggleFind={() => setFindOpen((open) => !open)}
					onRestartKernel={restartKernel}
					onRunAll={runAll}
					onExecuteToHere={() => executeCells(cells.slice(0, selectedIndex + 1))}
					onExecuteFromHere={() => executeCells(cells.slice(selectedIndex))}
					onClearOutputs={clearOutputs}
					onMoveUp={() => moveSelected(-1)}
					onMoveDown={() => moveSelected(1)}
					onDuplicate={duplicateSelected}
					onDelete={deleteSelected}
					onRun={runSelection}
					onInterrupt={interruptKernel}
					onKill={killKernel}
					onExport={exportToPy}
					onAddCell={() => addCell("below")}
				/>
			)}

			{settingsOpen && (
				<SettingsModal
					page={settingsPage}
					onPageChange={setSettingsPage}
					onClose={() => setSettingsOpen(false)}
					baseUrl={baseUrl}
					onBaseUrlChange={setBaseUrl}
					token={token}
					onTokenChange={setToken}
					kernelName={kernelName}
					onKernelNameChange={setKernelName}
					kernelSpecs={kernelSpecs}
					connected={Boolean(providerId)}
					isConnecting={isConnecting}
					canConnect={apiStatus === "online"}
					onToggleConnection={toggleProviderConnection}
					requirements={startupRequirements}
					onRequirementsChange={(value) => { setStartupRequirements(value); setStartupSaveState("dirty"); }}
					onstart={startupOnstart}
					onOnstartChange={(value) => { setStartupOnstart(value); setStartupSaveState("dirty"); }}
					startupSaveState={startupSaveState}
					onSaveStartup={async () => {
						setStartupSaveState("saving");
						await fetch("/api/startup", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirements: startupRequirements, onstart: startupOnstart }) });
						setStartupSaveState("saved");
					}}
					theme={themeName}
					onThemeChange={setThemeName}
				/>
			)}

			{vastWizardOpen && <VastWizard onClose={() => setVastWizardOpen(false)} onConnected={handleVastConnected} />}

			<CommandPalette
				open={paletteOpen}
				onClose={() => setPaletteOpen(false)}
				commands={paletteCommands}
				snippets={snippets}
				onInsertSnippet={(snippet) => insertSnippet(snippet)}
				canSaveCell={appMode === "notebook" && Boolean(selectedCell)}
				saveCellHint={selectedIds.size > 1 ? `${selectedIds.size} cells` : selectedCell?.title}
				onSaveCellAsSnippet={saveCellsAsSnippet}
				onOpenSnippetsScreen={() => { setAppMode("snippets"); refreshSnippets(); }}
			/>

			{findOpen && appMode === "notebook" && (
				<FindBar
					findQuery={findQuery}
					onFindQueryChange={(value) => { setFindQuery(value); setMatchIndex(0); }}
					replaceQuery={replaceQuery}
					onReplaceQueryChange={setReplaceQuery}
					matchCount={matchCount}
					hasMatches={matchingCellIds.length > 0}
					onPrev={() => gotoMatch(-1)}
					onNext={() => gotoMatch(1)}
					onReplace={replaceCurrent}
					onReplaceAll={replaceAll}
					onClose={() => setFindOpen(false)}
				/>
			)}

			<main className={`app-main ${appMode === "notebook" ? "" : "no-pad"}`} aria-describedby="workbench-status"><div className={`notebook-layout ${sidebarOpen ? "with-sidebar" : ""}`}>
				{sidebarOpen && (
					<Sidebar
						panel={leftPanel}
						toc={toc}
						onScrollToCell={scrollToCell}
						fileDir={fileDir}
						fileTree={fileTree}
						onLoadFiles={loadFiles}
						onOpenFile={openFile}
						variables={variables}
						variablesLoading={variablesLoading}
						onLoadVariables={loadVariables}
					/>
				)}

				{appMode === "notebook" && (
					<section className="notebook-panel" aria-label="Notebook cells">
						<div className="cell-stack">
							{cells.map((cell, index) => (
								<NotebookCellView
									key={cell.id}
									cell={cell}
									index={index}
									theme={themeName}
									providerId={providerId}
									sessionId={activeSession?.id}
									selected={cell.id === selectedId}
									multiSelected={selectedIds.has(cell.id)}
									running={runningCellId === cell.id}
									queued={queuedCellIds.has(cell.id)}
									editing={editingCellId === cell.id}
									dragOver={dragOverId === cell.id && dragSrcId !== cell.id}
									dirty={dirtyCellIds.has(cell.id)}
									execCount={execCounts.get(cell.id)}
									registerCell={(id, node) => { if (node) cellRefs.current.set(id, node); else cellRefs.current.delete(id); }}
									registerEditor={(id, handle) => { if (handle) editorRefs.current.set(id, handle); else editorRefs.current.delete(id); }}
									onCellClick={handleCellClick}
									onCellKeyDown={handleCellKey}
									onCellKeyDownCapture={handleCellKeyCapture}
									onDragStart={handleDragStart}
									onDragOver={handleDragOver}
									onDrop={handleDrop}
									onDragEnd={handleDragEnd}
									onPatch={patchCell}
									onSelect={setSelectedId}
									onClearOutput={clearCellOutput}
									onRun={(target) => { setSelectedId(target.id); executeCells([target]); }}
									onRunAdvance={(target) => { setSelectedId(target.id); executeAndAdvance(target); }}
									onSave={saveNotebook}
									onFocusCell={focusCell}
									onEditorFocus={(id) => setEditingCellId(id)}
									onEditorBlur={(id) => setEditingCellId((cur) => cur === id ? undefined : cur)}
								/>
							))}
						</div>
					</section>
				)}

				{appMode === "terminal" && (
					<section className="notebook-panel terminal-panel" aria-label="Terminal">
						{providerId ? <TerminalPane providerId={providerId} terminalName={terminalName} onReady={setTerminalName} theme={themeName} /> : <div className="empty-output">Connect a Jupyter provider to open a terminal.</div>}
					</section>
				)}

				{appMode === "snippets" && (
					<SnippetsScreen snippets={snippets} theme={themeName} onChange={refreshSnippets} onInsert={(snippet) => insertSnippet(snippet)} onStatus={setStatus} />
				)}

				{appMode === "explorer" && (
					<ExplorerPane fileDir={fileDir} fileTree={fileTree} onLoadFiles={loadFiles} onOpenFile={openFile} onNewNotebook={newNotebook} />
				)}

				{appMode === "file" && (
					<FileEditorPane
						fileDir={fileDir}
						fileTree={fileTree}
						onLoadFiles={loadFiles}
						onOpenFile={openFile}
						currentFilePath={currentFilePath}
						fileContent={fileContent}
						fileLanguage={fileLanguage}
						fileDirty={fileDirty}
						fileOutputs={fileOutputs}
						isExecuting={isExecuting}
						theme={themeName}
						providerId={providerId}
						sessionId={activeSession?.id}
						onContentChange={(value) => { setFileContent(value); setFileDirty(true); }}
						onSave={saveFile}
						onRun={runFile}
					/>
				)}
			</div></main>

			<StatusBar
				statusMessage={statusMessage}
				saveLabel={saveState === "saving" ? "Saving…" : saveState === "dirty" ? `${dirtyCellIds.size} unsaved` : "Saved"}
				cellLabel={selectedIds.size > 1 ? `${selectedIds.size} cells` : selectedCell ? `cell ${selectedIndex + 1}/${cells.length}` : "—"}
				costLabel={costPerHour != null && sessionConnectedAt != null ? (() => { void costTick; const elapsed = (Date.now() - sessionConnectedAt) / 1000; return `$${(costPerHour / 3600 * elapsed).toFixed(4)} · $${costPerHour.toFixed(4)}/hr`; })() : undefined}
				hasSession={Boolean(activeSession)}
				kernelStatus={kernelStatus}
				kernelName={kernelName}
				kernelSpecs={kernelSpecs}
				onSwitchKernel={switchKernel}
				providerLabel={providerId ? providerId.replace(/^vast-/, "Vast #") : "no provider"}
				onChooseProvider={() => setVastWizardOpen(true)}
			/>
		</div>
		</WidgetManagerContext.Provider>
	);
}

type ReactMouseLikeEvent = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };
