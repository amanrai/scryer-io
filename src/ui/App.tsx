import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faArrowDown,
	faArrowUp,
	faBolt,
	faChevronRight,
	faCircleNodes,
	faClone,
	faEraser,
	faFloppyDisk,
	faGear,
	faPlay,
	faPlus,
	faRobot,
	faRotateRight,
	faStop,
	faTrash,
	faXmark,
} from "@fortawesome/free-solid-svg-icons";

type CellKind = "markdown" | "code" | "mermaid";

type RichOutput =
	| { kind: "stream"; name: "stdout" | "stderr"; text: string }
	| { kind: "execute_result" | "display_data"; data: Record<string, unknown>; metadata?: Record<string, unknown> }
	| { kind: "error"; ename: string; evalue: string; traceback: string[] }
	| { kind: "status"; executionState: string }
	| { kind: "unknown"; messageType: string; content: unknown };

type NotebookCell = {
	id: string;
	kind: CellKind;
	title: string;
	content: string;
	cellOpen?: boolean;
	codeOpen?: boolean;
	agentOpen: boolean;
	outputOpen?: boolean;
	lastRun?: string;
	elapsedMs?: number;
	outputs?: RichOutput[];
};

type KernelSpec = { name: string; displayName: string; language?: string; isDefault: boolean };
type RuntimeSession = { id: string; path: string; kernelName?: string; providerId: string };
type SavedProvider = { id: string; label: string; baseUrl: string; defaultKernelName?: string; token?: string };
type IpynbCell = {
	cell_type: "code" | "markdown" | "raw";
	source?: string | string[];
	metadata?: Record<string, any>;
	outputs?: any[];
	execution_count?: number | null;
};
type IpynbNotebook = { nbformat: 4; nbformat_minor: number; metadata: Record<string, any>; cells: IpynbCell[] };

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

function lineNumbers(text: string): number[] {
	return Array.from({ length: Math.max(1, text.split("\n").length) }, (_, index) => index + 1);
}

function nowLabel(): string {
	return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function isCommand(event: KeyboardEvent, code: string): boolean {
	return event.code === code && (event.metaKey || event.ctrlKey);
}

function renderMarkdown(md: string): string {
	return DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
}

function normalizeSource(source: unknown): string {
	if (Array.isArray(source)) return source.join("");
	if (typeof source === "string") return source;
	return "";
}

function ipynbOutputToRich(output: any): RichOutput | undefined {
	if (!output) return undefined;
	if (output.kind) return output as RichOutput;
	if (output.output_type === "stream") return { kind: "stream", name: output.name === "stderr" ? "stderr" : "stdout", text: normalizeSource(output.text) };
	if (output.output_type === "error") return { kind: "error", ename: String(output.ename ?? "Error"), evalue: String(output.evalue ?? ""), traceback: Array.isArray(output.traceback) ? output.traceback : [] };
	if (output.output_type === "execute_result") return { kind: "execute_result", data: output.data ?? {}, metadata: output.metadata ?? {} };
	if (output.output_type === "display_data") return { kind: "display_data", data: output.data ?? {}, metadata: output.metadata ?? {} };
	return { kind: "unknown", messageType: String(output.output_type ?? "unknown"), content: output };
}

function richOutputToIpynb(output: RichOutput): any | undefined {
	if (output.kind === "status") return undefined;
	if (output.kind === "stream") return { output_type: "stream", name: output.name, text: output.text };
	if (output.kind === "error") return { output_type: "error", ename: output.ename, evalue: output.evalue, traceback: output.traceback };
	if (output.kind === "execute_result") return { output_type: "execute_result", execution_count: null, data: output.data, metadata: output.metadata ?? {} };
	if (output.kind === "display_data") return { output_type: "display_data", data: output.data, metadata: output.metadata ?? {} };
	return { output_type: "display_data", data: { "text/plain": plainTextData(output.content) }, metadata: {} };
}

function cellsFromNotebook(notebook: any): NotebookCell[] {
	if (Array.isArray(notebook?.cells) && notebook.nbformat !== 4) return notebook.cells as NotebookCell[];
	return (notebook?.cells ?? []).map((cell: IpynbCell, index: number) => {
		const scryer = cell.metadata?.scryer ?? {};
		const ui = scryer.ui ?? {};
		const kind = (scryer.kind === "mermaid" || scryer.kind === "markdown" || scryer.kind === "code") ? scryer.kind : cell.cell_type === "code" ? "code" : "markdown";
		return {
			id: String(scryer.id ?? `cell-${index + 1}`),
			kind,
			title: String(scryer.title ?? "Untitled"),
			content: normalizeSource(cell.source),
			cellOpen: ui.cellOpen ?? true,
			codeOpen: ui.codeOpen ?? true,
			outputOpen: ui.outputOpen ?? kind !== "code",
			agentOpen: ui.agentOpen ?? false,
			lastRun: scryer.lastRun,
			elapsedMs: scryer.elapsedMs,
			outputs: cell.outputs?.map(ipynbOutputToRich).filter(Boolean) as RichOutput[] | undefined,
		};
	});
}

function notebookFromCells(cells: NotebookCell[]): IpynbNotebook {
	return {
		nbformat: 4,
		nbformat_minor: 5,
		metadata: { scryer: { app: "scryer-io", version: 1 } },
		cells: cells.map((cell) => ({
			cell_type: cell.kind === "code" ? "code" : "markdown",
			source: cell.content,
			metadata: {
				scryer: {
					id: cell.id,
					kind: cell.kind,
					title: cell.title,
					lastRun: cell.lastRun,
					elapsedMs: cell.elapsedMs,
					ui: { cellOpen: cell.cellOpen, codeOpen: cell.codeOpen, outputOpen: cell.outputOpen, agentOpen: cell.agentOpen },
				},
			},
			...(cell.kind === "code" ? { execution_count: null, outputs: cell.outputs?.map(richOutputToIpynb).filter(Boolean) ?? [] } : {}),
		})),
	};
}

function plainTextData(value: unknown): string {
	if (Array.isArray(value)) return value.join("");
	if (typeof value === "string") return value;
	return JSON.stringify(value, null, 2);
}

let mermaidInitialized = false;

async function renderMermaid(source: string, id: string): Promise<string> {
	const mermaid = (await import("mermaid")).default;
	if (!mermaidInitialized) {
		mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
		mermaidInitialized = true;
	}
	const result = await mermaid.render(`mermaid-${id}-${Date.now()}`, source);
	return DOMPurify.sanitize(result.svg);
}

function MermaidView({ source, id }: { source: string; id: string }) {
	const [svg, setSvg] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		let cancelled = false;
		async function render() {
			if (!source.trim()) { setSvg(""); setError(""); setLoading(false); return; }
			setLoading(true);
			try {
				const nextSvg = await renderMermaid(source, id);
				if (!cancelled) { setSvg(nextSvg); setError(""); }
			} catch (err) {
				if (!cancelled) { setSvg(""); setError(err instanceof Error ? err.message : String(err)); }
			} finally {
				if (!cancelled) setLoading(false);
			}
		}
		render();
		return () => { cancelled = true; };
	}, [id, source]);

	if (error) return <pre className="cell-output error">{error}</pre>;
	if (loading && !svg) return <div className="empty-output">Rendering diagram…</div>;
	if (!svg) return <div className="empty-output">No diagram rendered.</div>;
	return <div className="mermaid-output" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function OutputView({ output }: { output: RichOutput }) {
	if (output.kind === "status") return null;
	if (output.kind === "stream") return <pre className={`cell-output ${output.name}`}>{output.text}</pre>;
	if (output.kind === "error") return <pre className="cell-output error">{[output.ename, output.evalue, ...output.traceback].join("\n")}</pre>;
	if (output.kind === "execute_result" || output.kind === "display_data") {
		const html = output.data["text/html"];
		const png = output.data["image/png"];
		const svg = output.data["image/svg+xml"];
		const json = output.data["application/json"];
		if (typeof html === "string") return <div className="rich-output" dangerouslySetInnerHTML={{ __html: html }} />;
		if (Array.isArray(html)) return <div className="rich-output" dangerouslySetInnerHTML={{ __html: html.join("") }} />;
		if (typeof png === "string") return <div className="rich-output"><img src={`data:image/png;base64,${png}`} alt="cell output" /></div>;
		if (typeof svg === "string") return <div className="rich-output" dangerouslySetInnerHTML={{ __html: svg }} />;
		if (json) return <pre className="cell-output">{plainTextData(json)}</pre>;
		return <pre className="cell-output">{plainTextData(output.data["text/plain"] ?? output.data)}</pre>;
	}
	return <pre className="cell-output">{plainTextData(output.content)}</pre>;
}

type SettingsPage = "provider" | "theme";
type ThemeName = "dark" | "light";

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
	const [isConnecting, setIsConnecting] = useState(false);
	const [isExecuting, setIsExecuting] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsPage, setSettingsPage] = useState<SettingsPage>("provider");
	const [themeName, setThemeName] = useState<ThemeName>(() => (localStorage.getItem("scryer-io:theme") as ThemeName) || "dark");
	const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
	const [dirtyCellIds, setDirtyCellIds] = useState<Set<string>>(new Set());
	const cellRefs = useRef(new Map<string, HTMLElement>());
	const editorRefs = useRef(new Map<string, HTMLTextAreaElement>());
	const selectedIndex = cells.findIndex((cell) => cell.id === selectedId);
	const selectedCell = cells[selectedIndex] ?? cells[0];

	useEffect(() => {
		localStorage.setItem("scryer-io:theme", themeName);
	}, [themeName]);

	useEffect(() => {
		const handleKey = (event: globalThis.KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.code === "KeyS") {
				event.preventDefault();
				saveNotebook();
			}
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [cells]);

	useEffect(() => {
		fetch("/api/healthz").then((res) => setApiStatus(res.ok ? "online" : "offline")).catch(() => setApiStatus("offline"));
		fetch("/api/notebook").then((res) => res.json()).then((json) => {
			const loadedCells = cellsFromNotebook(json);
			if (loadedCells.length) {
				setCells(loadedCells);
				setSelectedId(loadedCells[0].id);
				setDirtyCellIds(new Set());
				setSaveState("saved");
			}
		}).catch(() => undefined);
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

	function markDirty(id?: string) {
		setSaveState("dirty");
		if (id) setDirtyCellIds((current) => new Set(current).add(id));
	}

	function patchCell(id: string, patch: Partial<NotebookCell>) {
		markDirty(id);
		setCells((current) => current.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell)));
	}

	async function saveNotebook() {
		setSaveState("saving");
		await fetch("/api/notebook", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(notebookFromCells(cells)),
		});
		setDirtyCellIds(new Set());
		setSaveState("saved");
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
		} catch (err) {
			setProviderId(undefined);
			setKernelSpecs([]);
			console.error(err);
		} finally {
			setIsConnecting(false);
		}
	}

	async function disconnectProvider() {
		if (!providerId) return;
		setIsConnecting(true);
		try { await fetch(`/api/runtime/providers/${providerId}`, { method: "DELETE" }); }
		finally {
			setProviderId(undefined);
			setKernelSpecs([]);
			setActiveSession(undefined);
			setIsConnecting(false);
		}
	}

	function toggleProviderConnection() {
		if (providerId) disconnectProvider();
		else connectProvider();
	}

	async function executeCell(cell: NotebookCell) {
		if (cell.kind !== "code") {
			patchCell(cell.id, { outputOpen: true, lastRun: nowLabel(), elapsedMs: 0 });
			return;
		}
		if (!providerId) {
			patchCell(cell.id, { outputOpen: true, outputs: [{ kind: "stream", name: "stderr", text: "Connect a Jupyter provider before executing code." }] });
			return;
		}
		patchCell(cell.id, { outputOpen: true, outputs: [{ kind: "stream", name: "stdout", text: "Running…" }] });
		const stamp = nowLabel();
		const res = await fetch(`/api/runtime/providers/${providerId}/execute`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code: cell.content, sessionId: activeSession?.id, kernelName: kernelName || undefined }),
		});
		const json = await res.json();
		if (!res.ok) throw new Error(json.error ?? "Execution failed");
		setActiveSession(json.session);
		patchCell(cell.id, { lastRun: stamp, elapsedMs: json.elapsedMs, outputOpen: true, outputs: json.outputs?.filter((o: RichOutput) => o.kind !== "status") ?? [] });
	}

	async function executeCells(targetCells: NotebookCell[]) {
		setIsExecuting(true);
		try { for (const cell of targetCells) await executeCell(cell); }
		catch (err: any) { if (selectedCell) patchCell(selectedCell.id, { outputOpen: true, outputs: [{ kind: "stream", name: "stderr", text: err?.message ?? String(err) }] }); }
		finally { setIsExecuting(false); }
	}

	async function restartKernel() {
		if (!providerId || !activeSession) return;
		setIsExecuting(true);
		try {
			const res = await fetch(`/api/runtime/providers/${providerId}/restart`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: activeSession.id }),
			});
			const json = await res.json();
			if (!res.ok) throw new Error(json.error ?? "Restart failed");
		} catch (err) { console.error(err); }
		finally { setIsExecuting(false); }
	}

	async function interruptKernel() {
		if (!providerId || !activeSession) return;
		try {
			await fetch(`/api/runtime/providers/${providerId}/interrupt`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: activeSession.id }),
			});
		} finally { setIsExecuting(false); }
	}

	function clearOutputs() {
		markDirty();
		setDirtyCellIds(new Set(cells.map((cell) => cell.id)));
		setCells((current) => current.map((cell) => ({ ...cell, outputs: undefined, outputOpen: false, lastRun: undefined, elapsedMs: undefined })));
	}

	function addCell(position: "above" | "below" = "below", anchorId = selectedId) {
		const id = `cell-${Date.now()}`;
		const cell: NotebookCell = { id, kind: "code", title: "Untitled", content: "", cellOpen: true, codeOpen: true, agentOpen: false, outputOpen: false };
		markDirty(id);
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

	function deleteSelected() {
		if (cells.length <= 1 || selectedIndex < 0) return;
		markDirty();
		setCells((current) => current.filter((cell) => cell.id !== selectedId));
		setSelectedId(cells[Math.max(0, selectedIndex - 1)]?.id ?? cells[0].id);
	}

	function duplicateSelected() {
		if (!selectedCell) return;
		const id = `cell-${Date.now()}`;
		const clone = { ...selectedCell, id, title: `${selectedCell.title} copy` };
		markDirty(id);
		setCells((current) => {
			const next = [...current];
			next.splice(selectedIndex + 1, 0, clone);
			return next;
		});
		setSelectedId(id);
	}

	function focusCell(id: string) {
		setSelectedId(id);
		requestAnimationFrame(() => cellRefs.current.get(id)?.focus());
	}

	function focusEditor(id: string) {
		patchCell(id, { cellOpen: true, codeOpen: true });
		requestAnimationFrame(() => editorRefs.current.get(id)?.focus());
	}

	function collapseCellFully(cell: NotebookCell) {
		patchCell(cell.id, { cellOpen: false, codeOpen: false, outputOpen: false, agentOpen: false });
		focusCell(cell.id);
	}

	function handleCellKeyCapture(event: KeyboardEvent, cell: NotebookCell) {
		if (isCommand(event, "Escape")) { event.preventDefault(); event.stopPropagation(); collapseCellFully(cell); }
		else if (isCommand(event, "KeyS")) { event.preventDefault(); event.stopPropagation(); saveNotebook(); }
	}

	function handleCellKey(event: KeyboardEvent, cell: NotebookCell) {
		const target = event.target as HTMLElement;
		const isFormTarget = ["TEXTAREA", "INPUT", "SELECT"].includes(target.tagName);
		if (isCommand(event, "Enter")) { event.preventDefault(); event.stopPropagation(); setSelectedId(cell.id); executeCells([cell]); }
		else if (isCommand(event, "KeyS")) { event.preventDefault(); event.stopPropagation(); saveNotebook(); }
		else if (isCommand(event, "KeyA")) { event.preventDefault(); event.stopPropagation(); addCell("above", cell.id); }
		else if (isCommand(event, "KeyB")) { event.preventDefault(); event.stopPropagation(); addCell("below", cell.id); }
		else if (!isFormTarget && event.code === "ArrowUp") { event.preventDefault(); const prev = cells[Math.max(0, cells.findIndex((item) => item.id === cell.id) - 1)]; if (prev) focusCell(prev.id); }
		else if (!isFormTarget && event.code === "ArrowDown") { event.preventDefault(); const next = cells[Math.min(cells.length - 1, cells.findIndex((item) => item.id === cell.id) + 1)]; if (next) focusCell(next.id); }
		else if (!isFormTarget && event.code === "Enter") { event.preventDefault(); focusEditor(cell.id); }
	}

	function handleEditorKey(event: KeyboardEvent, cell: NotebookCell) {
		if (event.code === "Escape" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); event.stopPropagation(); focusCell(cell.id); }
		else handleCellKey(event, cell);
	}

	return (
		<div className="app-shell" data-theme={themeName}>
			<header className="topbar">
				<div className="brand-block"><div className="eyebrow">Scryer Io</div><h1>Notebook workbench</h1></div>
				<div className="provider-pill"><FontAwesomeIcon icon={faCircleNodes} /><span>API {apiStatus}</span><strong>{providerId ? `Jupyter ${providerId}` : "Jupyter disconnected"}</strong></div>
			</header>

			<section className="toolbar" aria-label="Notebook actions">
				<button className="ghost-button icon-button" title="Move cell up" aria-label="Move cell up" onClick={() => moveSelected(-1)} disabled={selectedIndex <= 0 || isExecuting}><FontAwesomeIcon icon={faArrowUp} /></button>
				<button className="ghost-button icon-button" title="Move cell down" aria-label="Move cell down" onClick={() => moveSelected(1)} disabled={selectedIndex < 0 || selectedIndex >= cells.length - 1 || isExecuting}><FontAwesomeIcon icon={faArrowDown} /></button>
				<button className="ghost-button icon-button" title="Duplicate cell" aria-label="Duplicate cell" onClick={duplicateSelected} disabled={isExecuting}><FontAwesomeIcon icon={faClone} /></button>
				<button className="ghost-button icon-button" title="Delete cell" aria-label="Delete cell" onClick={deleteSelected} disabled={isExecuting || cells.length <= 1}><FontAwesomeIcon icon={faTrash} /></button>
				<div className="toolbar-divider" />
				<button className="primary-button icon-button" title="Execute cell" aria-label="Execute cell" onClick={() => selectedCell && executeCells([selectedCell])} disabled={isExecuting}><FontAwesomeIcon icon={faPlay} /></button>
				<button className="ghost-button icon-button" title="Execute all up to here" aria-label="Execute all up to here" onClick={() => executeCells(cells.slice(0, selectedIndex + 1))} disabled={isExecuting}><FontAwesomeIcon icon={faBolt} /></button>
				<button className="ghost-button icon-button" title="Execute all from here" aria-label="Execute all from here" onClick={() => executeCells(cells.slice(selectedIndex))} disabled={isExecuting}><FontAwesomeIcon icon={faRotateRight} /></button>
				<button className="ghost-button icon-button" title="Interrupt kernel" aria-label="Interrupt kernel" onClick={interruptKernel} disabled={!activeSession}><FontAwesomeIcon icon={faStop} /></button>
				<div className="toolbar-divider" />
				<button className="ghost-button icon-button" title="Restart kernel" aria-label="Restart kernel" onClick={restartKernel} disabled={isExecuting || !activeSession}><FontAwesomeIcon icon={faRotateRight} /></button>
				<button className="ghost-button icon-button" title="Clear outputs" aria-label="Clear outputs" onClick={clearOutputs} disabled={isExecuting}><FontAwesomeIcon icon={faEraser} /></button>
				<button className="ghost-button icon-button" title="Save notebook" aria-label="Save notebook" onClick={saveNotebook} disabled={saveState === "saving"}><FontAwesomeIcon icon={faFloppyDisk} /></button>
				<div className="toolbar-spacer" />
				<button className="ghost-button icon-button" title="Settings" aria-label="Settings" onClick={() => setSettingsOpen(true)}><FontAwesomeIcon icon={faGear} /></button>
				<button className="success-button icon-button" title="Add cell below" aria-label="Add cell below" onClick={() => addCell("below")}><FontAwesomeIcon icon={faPlus} /></button>
			</section>

			{settingsOpen && (
				<div className="settings-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
					<section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
						<header className="settings-header"><div><div className="eyebrow">Settings</div><h2 id="settings-title">{settingsPage === "provider" ? "Provider" : "Theme"}</h2></div><button className="ghost-button icon-button" title="Close settings" aria-label="Close settings" onClick={() => setSettingsOpen(false)}><FontAwesomeIcon icon={faXmark} /></button></header>
						<div className="settings-body">
							<nav className="settings-nav" aria-label="Settings pages"><button className={settingsPage === "provider" ? "active" : ""} type="button" onClick={() => setSettingsPage("provider")}>Provider</button><button className={settingsPage === "theme" ? "active" : ""} type="button" onClick={() => setSettingsPage("theme")}>Theme</button></nav>
							{settingsPage === "provider" ? <div className="settings-page">
								<p className="settings-copy">Connect this Scryer Io server to a Jupyter endpoint. Values are saved on the backend for every browser using this server.</p>
								<label><span>Jupyter URL</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://127.0.0.1:8888/" /></label>
								<label><span>Token</span><input value={token} onChange={(event) => setToken(event.target.value)} placeholder="paste token" type="password" /></label>
								<label><span>Kernel</span><input value={kernelName} onChange={(event) => setKernelName(event.target.value)} list="kernel-specs" placeholder="python3" /><datalist id="kernel-specs">{kernelSpecs.map((spec) => <option key={spec.name} value={spec.name}>{spec.displayName}</option>)}</datalist></label>
								<div className="settings-actions"><button className={providerId ? "success-button" : "primary-button"} onClick={toggleProviderConnection} disabled={isConnecting || apiStatus !== "online"}><FontAwesomeIcon icon={faCircleNodes} /> {isConnecting ? "Working…" : providerId ? "Connected" : "Connect"}</button></div>
							</div> : <div className="settings-page">
								<p className="settings-copy">Choose the Scryer Io interface theme. This preference is stored in this browser.</p>
								<div className="theme-options"><button className={themeName === "dark" ? "theme-option active" : "theme-option"} onClick={() => setThemeName("dark")}>One dark</button><button className={themeName === "light" ? "theme-option active" : "theme-option"} onClick={() => setThemeName("light")}>One light</button></div>
							</div>}
						</div>
					</section>
				</div>
			)}

			<main className="notebook-layout">
				<section className="notebook-panel" aria-label="Notebook cells">
					<div className="cell-stack">
						{cells.map((cell, index) => (
							<article key={cell.id} ref={(node) => { if (node) cellRefs.current.set(cell.id, node); else cellRefs.current.delete(cell.id); }} className={`cell-card ${cell.id === selectedId ? "selected" : ""}`} tabIndex={0} onKeyDownCapture={(event) => handleCellKeyCapture(event, cell)} onKeyDown={(event) => handleCellKey(event, cell)} onClick={() => setSelectedId(cell.id)}>
								{dirtyCellIds.has(cell.id) && <span className="dirty-dot cell-dirty-dot" title="Changed since last save" />}
								<div className="cell-header">
									<button className="cell-toggle" type="button" aria-label="Toggle cell" aria-expanded={cell.cellOpen !== false} onClick={(event) => { event.stopPropagation(); setSelectedId(cell.id); patchCell(cell.id, { cellOpen: cell.cellOpen === false }); }}><FontAwesomeIcon icon={faChevronRight} className={cell.cellOpen !== false ? "open" : ""} /></button>
									<div className="cell-heading" onClick={(event) => event.stopPropagation()}><div className="cell-title-row"><span>{index + 1}.</span><input className="cell-title-input" value={cell.title || "Untitled"} onChange={(event) => patchCell(cell.id, { title: event.target.value || "Untitled" })} /></div></div>
									<select value={cell.kind} onClick={(event) => event.stopPropagation()} onChange={(event) => patchCell(cell.id, { kind: event.target.value as CellKind, outputOpen: event.target.value !== "code" ? true : cell.outputOpen })} aria-label="Cell type"><option value="code">Code</option><option value="markdown">Markdown</option><option value="mermaid">Mermaid</option></select>
								</div>
								<div className={`cell-body ${cell.cellOpen !== false ? "open" : ""}`}><div>
									<div className="agent-accordion"><button type="button" aria-expanded={cell.codeOpen !== false} onClick={(event) => { event.stopPropagation(); patchCell(cell.id, { codeOpen: cell.codeOpen === false }); }}><FontAwesomeIcon icon={faChevronRight} className={cell.codeOpen !== false ? "open" : ""} /><span>{cell.kind === "markdown" ? "Markdown" : cell.kind === "mermaid" ? "Mermaid" : "Code"}</span></button><div className={`agent-panel ${cell.codeOpen !== false ? "open" : ""}`}><div><div className="editor-shell"><div className="line-gutter" aria-hidden="true">{lineNumbers(cell.content).map((line) => <span key={line}>{line}</span>)}</div><textarea ref={(node) => { if (node) editorRefs.current.set(cell.id, node); else editorRefs.current.delete(cell.id); }} value={cell.content} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => handleEditorKey(event, cell)} onChange={(event) => patchCell(cell.id, { content: event.target.value })} spellCheck={false} aria-label={`${cell.title} source`} /></div></div></div></div>
									{(cell.kind !== "code" || Boolean(cell.outputs?.length)) && <div className="agent-accordion"><button type="button" aria-expanded={Boolean(cell.outputOpen)} onClick={(event) => { event.stopPropagation(); patchCell(cell.id, { outputOpen: !cell.outputOpen }); }}><FontAwesomeIcon icon={faChevronRight} className={cell.outputOpen ? "open" : ""} /><span>Output</span>{cell.elapsedMs !== undefined && <small>{cell.elapsedMs}ms</small>}</button><div className={`agent-panel ${cell.outputOpen ? "open" : ""}`}><div>{cell.kind === "markdown" ? <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(cell.content) }} /> : cell.kind === "mermaid" ? <MermaidView source={cell.content} id={cell.id} /> : cell.outputs?.map((output, outputIndex) => <OutputView key={outputIndex} output={output} />)}</div></div></div>}
									<div className="agent-accordion"><button type="button" aria-expanded={cell.agentOpen} onClick={(event) => { event.stopPropagation(); patchCell(cell.id, { agentOpen: !cell.agentOpen }); }}><FontAwesomeIcon icon={faChevronRight} className={cell.agentOpen ? "open" : ""} /><FontAwesomeIcon icon={faRobot} className="agent-bot-icon" aria-label="Cell agent" /></button><div className={`agent-panel ${cell.agentOpen ? "open" : ""}`}><div><p>Agent design lives here later. For now this is the reserved per-cell steering surface.</p><div className="agent-input-placeholder">Ask the cell agent…</div></div></div></div>
								</div></div>
							</article>
						))}
					</div>
				</section>
			</main>
		</div>
	);
}
