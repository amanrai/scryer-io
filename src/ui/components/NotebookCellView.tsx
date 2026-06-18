import type { KeyboardEvent, MouseEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronRight, faEraser, faRobot } from "@fortawesome/free-solid-svg-icons";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor.js";
import { OutputView, MermaidView } from "./OutputView.js";
import { renderMarkdown } from "../markdown.js";
import type { CellKind, NotebookCell, ThemeName } from "../types.js";

type NotebookCellViewProps = {
	cell: NotebookCell;
	index: number;
	theme: ThemeName;
	selected: boolean;
	multiSelected: boolean;
	running: boolean;
	editing: boolean;
	dragOver: boolean;
	dirty: boolean;
	execCount?: number;
	registerCell: (id: string, node: HTMLElement | null) => void;
	registerEditor: (id: string, handle: CodeEditorHandle | null) => void;
	onCellClick: (event: MouseEvent, cell: NotebookCell, index: number) => void;
	onCellKeyDown: (event: KeyboardEvent, cell: NotebookCell) => void;
	onCellKeyDownCapture: (event: KeyboardEvent, cell: NotebookCell) => void;
	onDragStart: (id: string) => void;
	onDragOver: (event: React.DragEvent, id: string) => void;
	onDrop: (event: React.DragEvent, id: string) => void;
	onDragEnd: () => void;
	onPatch: (id: string, patch: Partial<NotebookCell>) => void;
	onSelect: (id: string) => void;
	onClearOutput: (id: string) => void;
	onRun: (cell: NotebookCell) => void;
	onRunAdvance: (cell: NotebookCell) => void;
	onSave: () => void;
	onFocusCell: (id: string) => void;
	onEditorFocus: (id: string) => void;
	onEditorBlur: (id: string) => void;
};

export function NotebookCellView({
	cell,
	index,
	theme,
	selected,
	multiSelected,
	running,
	editing,
	dragOver,
	dirty,
	execCount,
	registerCell,
	registerEditor,
	onCellClick,
	onCellKeyDown,
	onCellKeyDownCapture,
	onDragStart,
	onDragOver,
	onDrop,
	onDragEnd,
	onPatch,
	onSelect,
	onClearOutput,
	onRun,
	onRunAdvance,
	onSave,
	onFocusCell,
	onEditorFocus,
	onEditorBlur,
}: NotebookCellViewProps) {
	const cellOpen = cell.cellOpen !== false;
	const codeOpen = cell.codeOpen !== false;
	const kindLabel = cell.kind === "markdown" ? "Markdown" : cell.kind === "mermaid" ? "Mermaid" : "Code";

	return (
		<article
			ref={(node) => registerCell(cell.id, node)}
			className={`cell-card ${selected ? "selected" : ""} ${multiSelected ? "multi-selected" : ""} ${running ? "running" : ""} ${editing ? "editing" : ""} ${dragOver ? "drag-over" : ""}`}
			tabIndex={0}
			draggable
			onDragStart={() => onDragStart(cell.id)}
			onDragOver={(event) => onDragOver(event, cell.id)}
			onDrop={(event) => onDrop(event, cell.id)}
			onDragEnd={onDragEnd}
			onKeyDownCapture={(event) => onCellKeyDownCapture(event, cell)}
			onKeyDown={(event) => onCellKeyDown(event, cell)}
			onClick={(event) => onCellClick(event, cell, index)}
		>
			{dirty && <span className="dirty-dot cell-dirty-dot" title="Changed since last save" />}
			<div className="cell-header">
				<button className="cell-toggle" type="button" aria-label="Toggle cell" aria-expanded={cellOpen} onClick={(event) => { event.stopPropagation(); onSelect(cell.id); onPatch(cell.id, { cellOpen: !cellOpen }); }}>
					<FontAwesomeIcon icon={faChevronRight} className={cellOpen ? "open" : ""} />
				</button>
				<div className="cell-heading" onClick={(event) => event.stopPropagation()}>
					<div className="cell-title-row">
						<span className="cell-num">{index + 1}</span>
						{cell.kind === "code" && <span className="exec-count">[{execCount ?? " "}]</span>}
						<input className="cell-title-input" value={cell.title || "Untitled"} onChange={(event) => onPatch(cell.id, { title: event.target.value || "Untitled" })} />
					</div>
				</div>
				<div className="cell-header-actions">
					<button className="cell-clear-output" type="button" title="Clear cell output" aria-label="Clear cell output" onClick={(event) => { event.stopPropagation(); onClearOutput(cell.id); }}>
						<FontAwesomeIcon icon={faEraser} />
					</button>
					<select value={cell.kind} onClick={(event) => event.stopPropagation()} onChange={(event) => onPatch(cell.id, { kind: event.target.value as CellKind, outputOpen: event.target.value !== "code" ? true : cell.outputOpen })} aria-label="Cell type">
						<option value="code">Code</option>
						<option value="markdown">Markdown</option>
						<option value="mermaid">Mermaid</option>
					</select>
				</div>
			</div>
			<div className={`cell-body ${cellOpen ? "open" : ""}`}><div>
				<div className="agent-accordion">
					<button type="button" aria-expanded={codeOpen} onClick={(event) => { event.stopPropagation(); onPatch(cell.id, { codeOpen: !codeOpen }); }}>
						<FontAwesomeIcon icon={faChevronRight} className={codeOpen ? "open" : ""} /><span>{kindLabel}</span>
					</button>
					<div className={`agent-panel ${codeOpen ? "open" : ""}`}><div>
						<div className="editor-shell" onClick={(event) => event.stopPropagation()}>
							{codeOpen && (
								<CodeEditor
									ref={(handle) => registerEditor(cell.id, handle)}
									value={cell.content}
									language={cell.kind === "code" ? "python" : "markdown"}
									theme={theme}
									onChange={(value) => onPatch(cell.id, { content: value })}
									onRun={() => onRun(cell)}
									onRunAdvance={() => onRunAdvance(cell)}
									onSave={onSave}
									onEscape={() => onFocusCell(cell.id)}
									onFocus={() => onEditorFocus(cell.id)}
									onBlur={() => onEditorBlur(cell.id)}
								/>
							)}
						</div>
					</div></div>
				</div>
				{(cell.kind !== "code" || Boolean(cell.outputs?.length)) && (
					<div className="agent-accordion">
						<button type="button" aria-expanded={Boolean(cell.outputOpen)} onClick={(event) => { event.stopPropagation(); onPatch(cell.id, { outputOpen: !cell.outputOpen }); }}>
							<FontAwesomeIcon icon={faChevronRight} className={cell.outputOpen ? "open" : ""} /><span>Output</span>{cell.elapsedMs !== undefined && <small>{cell.elapsedMs}ms</small>}
						</button>
						<div className={`agent-panel ${cell.outputOpen ? "open" : ""}`}><div>
							<div className="output-scroll">
								{cell.kind === "markdown"
									? <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(cell.content) }} />
									: cell.kind === "mermaid"
										? <MermaidView source={cell.content} id={cell.id} />
										: cell.outputs?.map((output, outputIndex) => <OutputView key={outputIndex} output={output} />)}
							</div>
						</div></div>
					</div>
				)}
				<div className="agent-accordion">
					<button type="button" aria-expanded={cell.agentOpen} onClick={(event) => { event.stopPropagation(); onPatch(cell.id, { agentOpen: !cell.agentOpen }); }}>
						<FontAwesomeIcon icon={faChevronRight} className={cell.agentOpen ? "open" : ""} /><FontAwesomeIcon icon={faRobot} className="agent-bot-icon" /><span>Agent</span>
					</button>
					<div className={`agent-panel ${cell.agentOpen ? "open" : ""}`}><div>
						<p>Agent design lives here later. For now this is the reserved per-cell steering surface.</p>
						<div className="agent-input-placeholder">Ask the cell agent…</div>
					</div></div>
				</div>
			</div></div>
		</article>
	);
}
