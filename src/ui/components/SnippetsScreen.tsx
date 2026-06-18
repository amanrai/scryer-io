import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClone, faFloppyDisk, faPlus, faTrash, faXmark } from "@fortawesome/free-solid-svg-icons";
import { CodeEditor } from "./CodeEditor.js";
import { createSnippet, deleteSnippet, updateSnippet, type Snippet, type SnippetCell } from "../snippets.js";

type SnippetsScreenProps = {
	snippets: Snippet[];
	theme: "dark" | "light";
	onChange: () => void | Promise<void>;
	onInsert: (snippet: Snippet) => void;
	onStatus: (message: string) => void;
};

type Draft = { name: string; cells: SnippetCell[] };

function emptyDraft(): Draft {
	return { name: "Untitled snippet", cells: [{ kind: "code", title: "Untitled", content: "" }] };
}

function draftFrom(snippet: Snippet): Draft {
	return { name: snippet.name, cells: snippet.cells.map((cell) => ({ ...cell })) };
}

export function SnippetsScreen({ snippets, theme, onChange, onInsert, onStatus }: SnippetsScreenProps) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [draft, setDraft] = useState<Draft | null>(null);
	const [dirty, setDirty] = useState(false);
	const [creating, setCreating] = useState(false);

	// Keep the open draft in sync when the snippet list reloads, unless mid-create or dirty.
	useEffect(() => {
		if (creating || dirty) return;
		if (selectedId) {
			const snippet = snippets.find((item) => item.id === selectedId);
			setDraft(snippet ? draftFrom(snippet) : null);
			if (!snippet) setSelectedId(null);
		}
	}, [snippets, selectedId, creating, dirty]);

	function selectSnippet(snippet: Snippet) {
		setCreating(false);
		setSelectedId(snippet.id);
		setDraft(draftFrom(snippet));
		setDirty(false);
	}

	function startCreate() {
		setCreating(true);
		setSelectedId(null);
		setDraft(emptyDraft());
		setDirty(true);
	}

	function patchDraft(patch: Partial<Draft>) {
		setDraft((current) => (current ? { ...current, ...patch } : current));
		setDirty(true);
	}

	function patchCell(index: number, patch: Partial<SnippetCell>) {
		setDraft((current) => current ? { ...current, cells: current.cells.map((cell, i) => i === index ? { ...cell, ...patch } : cell) } : current);
		setDirty(true);
	}

	function addCell() {
		setDraft((current) => current ? { ...current, cells: [...current.cells, { kind: "code", title: "Untitled", content: "" }] } : current);
		setDirty(true);
	}

	function removeCell(index: number) {
		setDraft((current) => current && current.cells.length > 1 ? { ...current, cells: current.cells.filter((_, i) => i !== index) } : current);
		setDirty(true);
	}

	async function save() {
		if (!draft) return;
		try {
			if (creating || !selectedId) {
				const created = await createSnippet({ name: draft.name, cells: draft.cells });
				setCreating(false);
				setSelectedId(created.id);
				onStatus(`Created snippet “${created.name}”`);
			} else {
				await updateSnippet(selectedId, { name: draft.name, cells: draft.cells });
				onStatus(`Saved snippet “${draft.name}”`);
			}
			setDirty(false);
			await onChange();
		} catch (err: any) {
			onStatus(err?.message ?? "Failed to save snippet");
		}
	}

	async function remove(snippet: Snippet) {
		if (!window.confirm(`Delete snippet “${snippet.name}”?`)) return;
		try {
			await deleteSnippet(snippet.id);
			if (selectedId === snippet.id) { setSelectedId(null); setDraft(null); setDirty(false); }
			onStatus(`Deleted snippet “${snippet.name}”`);
			await onChange();
		} catch (err: any) {
			onStatus(err?.message ?? "Failed to delete snippet");
		}
	}

	const selectedSnippet = selectedId ? snippets.find((item) => item.id === selectedId) : undefined;

	return (
		<section className="notebook-panel snippets-screen" aria-label="Snippet library">
			<aside className="snip-list">
				<header className="snip-list-header">
					<span>Snippets</span>
					<button className="primary-button snip-new" onClick={startCreate}><FontAwesomeIcon icon={faPlus} /> New</button>
				</header>
				<div className="snip-list-body">
					{snippets.length === 0 && <div className="snip-empty">No snippets yet. Create one, or save a cell from the notebook.</div>}
					{snippets.map((snippet) => (
						<div key={snippet.id} className={`snip-row ${snippet.id === selectedId ? "active" : ""}`} onClick={() => selectSnippet(snippet)}>
							<FontAwesomeIcon icon={faClone} className="snip-row-icon" />
							<div className="snip-row-text">
								<span className="snip-row-name">{snippet.name}</span>
								<span className="snip-row-meta">{snippet.cells.length} cell{snippet.cells.length === 1 ? "" : "s"} · {snippet.createdBy}</span>
							</div>
							<button className="snip-row-delete" title="Delete snippet" aria-label="Delete snippet" onClick={(event) => { event.stopPropagation(); remove(snippet); }}><FontAwesomeIcon icon={faTrash} /></button>
						</div>
					))}
				</div>
			</aside>

			<div className="snip-detail">
				{!draft ? (
					<div className="snip-detail-empty">Select a snippet to edit, or create a new one.</div>
				) : (
					<>
						<div className="snip-detail-toolbar">
							<input className="snip-name-input" value={draft.name} onChange={(event) => patchDraft({ name: event.target.value })} placeholder="Snippet name" />
							<div className="snip-toolbar-spacer" />
							{selectedSnippet && <button className="ghost-button" onClick={() => onInsert(selectedSnippet)} disabled={dirty} title={dirty ? "Save before inserting" : "Insert into notebook"}><FontAwesomeIcon icon={faClone} /> Insert</button>}
							<button className={dirty ? "primary-button" : "success-button"} onClick={save} disabled={!dirty && !creating}><FontAwesomeIcon icon={faFloppyDisk} /> {dirty ? "Save" : "Saved"}</button>
						</div>
						<div className="snip-cells">
							{draft.cells.map((cell, index) => (
								<div key={index} className="snip-cell">
									<div className="snip-cell-header">
										<input className="snip-cell-title" value={cell.title} onChange={(event) => patchCell(index, { title: event.target.value })} placeholder="Cell title" />
										<select value={cell.kind} onChange={(event) => patchCell(index, { kind: event.target.value as SnippetCell["kind"] })} aria-label="Cell type">
											<option value="code">Code</option>
											<option value="markdown">Markdown</option>
											<option value="mermaid">Mermaid</option>
										</select>
										{draft.cells.length > 1 && <button className="snip-cell-remove" title="Remove cell" aria-label="Remove cell" onClick={() => removeCell(index)}><FontAwesomeIcon icon={faXmark} /></button>}
									</div>
									<div className="snip-cell-editor">
										<CodeEditor value={cell.content} language={cell.kind === "code" ? "python" : "markdown"} theme={theme} onChange={(value) => patchCell(index, { content: value })} onSave={save} />
									</div>
								</div>
							))}
							<button className="ghost-button snip-add-cell" onClick={addCell}><FontAwesomeIcon icon={faPlus} /> Add cell</button>
						</div>
					</>
				)}
			</div>
		</section>
	);
}
