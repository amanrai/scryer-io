import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faArrowDown,
	faArrowUp,
	faBolt,
	faChevronRight,
	faCircleNodes,
	faPlay,
	faPlus,
	faRotateRight,
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
		content: "const budget = 50_000_000;\nconst target = 'jupyter-provider';\n({ budget, target });",
		agentOpen: true,
		output: "Agent accordion placeholder. Execution wiring comes next.",
	},
	{
		id: "cell-3",
		kind: "code",
		title: "Notebook provider config",
		content: "const provider = {\n  label: 'Local Jupyter',\n  baseUrl: 'http://127.0.0.1:8888',\n  kernel: 'python3'\n};\nprovider;",
		agentOpen: false,
	},
];

function lineNumbers(text: string): number[] {
	return Array.from({ length: Math.max(1, text.split("\n").length) }, (_, index) => index + 1);
}

function nowLabel(): string {
	return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function App() {
	const [cells, setCells] = useState<NotebookCell[]>(initialCells);
	const [selectedId, setSelectedId] = useState(initialCells[1]?.id ?? initialCells[0].id);
	const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">("checking");
	const selectedIndex = cells.findIndex((cell) => cell.id === selectedId);
	const selectedCell = cells[selectedIndex] ?? cells[0];

	const notebookStats = useMemo(() => {
		const code = cells.filter((cell) => cell.kind === "code").length;
		return `${cells.length} cells · ${code} code · provider not connected`;
	}, [cells]);

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

	function markExecuted(ids: string[], label: string) {
		const stamp = nowLabel();
		setCells((current) => current.map((cell) => ids.includes(cell.id)
			? {
				...cell,
				lastRun: stamp,
				output: `${label} queued for ${cell.title} at ${stamp}. Runtime execution will attach here.`,
			}
			: cell));
	}

	function executeSelected() {
		if (!selectedCell) return;
		markExecuted([selectedCell.id], "Execute cell");
	}

	function executeUpToHere() {
		if (selectedIndex < 0) return;
		markExecuted(cells.slice(0, selectedIndex + 1).map((cell) => cell.id), "Execute up to here");
	}

	function executeFromHere() {
		if (selectedIndex < 0) return;
		markExecuted(cells.slice(selectedIndex).map((cell) => cell.id), "Execute from here");
	}

	function addCell() {
		const id = `cell-${Date.now()}`;
		const cell: NotebookCell = {
			id,
			kind: "code",
			title: "Untitled code cell",
			content: "",
			agentOpen: false,
		};
		setCells((current) => {
			const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : current.length;
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
					<strong>Jupyter disconnected</strong>
				</div>
			</header>

			<section className="toolbar" aria-label="Notebook actions">
				<button className="ghost-button" onClick={() => moveSelected(-1)} disabled={selectedIndex <= 0}>
					<FontAwesomeIcon icon={faArrowUp} /> Move cell up
				</button>
				<button className="ghost-button" onClick={() => moveSelected(1)} disabled={selectedIndex < 0 || selectedIndex >= cells.length - 1}>
					<FontAwesomeIcon icon={faArrowDown} /> Move cell down
				</button>
				<div className="toolbar-divider" />
				<button className="primary-button" onClick={executeSelected}>
					<FontAwesomeIcon icon={faPlay} /> Execute cell
				</button>
				<button className="ghost-button" onClick={executeUpToHere}>
					<FontAwesomeIcon icon={faBolt} /> Execute all up to here
				</button>
				<button className="ghost-button" onClick={executeFromHere}>
					<FontAwesomeIcon icon={faRotateRight} /> Execute all from here
				</button>
				<div className="toolbar-spacer" />
				<button className="success-button" onClick={addCell}>
					<FontAwesomeIcon icon={faPlus} /> Add cell
				</button>
			</section>

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
										<span>Cell agent</span>
										<small>placeholder</small>
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
