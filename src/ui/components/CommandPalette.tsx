import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faChevronLeft, faClone, faFloppyDisk, faLayerGroup, faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import type { Snippet } from "../snippets.js";

export type PaletteCommand = {
	id: string;
	label: string;
	hint?: string;
	icon: IconDefinition;
	run: () => void;
};

type Page = "root" | "insert" | "save";

type Entry = {
	id: string;
	label: string;
	hint?: string;
	icon: IconDefinition;
	group: "snippet" | "command";
	onSelect: () => void;
};

type CommandPaletteProps = {
	open: boolean;
	onClose: () => void;
	commands: PaletteCommand[];
	snippets: Snippet[];
	onInsertSnippet: (snippet: Snippet) => void;
	canSaveCell: boolean;
	saveCellHint?: string;
	onSaveCellAsSnippet: (name: string) => Promise<void> | void;
	onOpenSnippetsScreen: () => void;
};

export function CommandPalette({
	open,
	onClose,
	commands,
	snippets,
	onInsertSnippet,
	canSaveCell,
	saveCellHint,
	onSaveCellAsSnippet,
	onOpenSnippetsScreen,
}: CommandPaletteProps) {
	const [page, setPage] = useState<Page>("root");
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);
	const [saveName, setSaveName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

	useEffect(() => {
		if (!open) return;
		setPage("root");
		setQuery("");
		setSelected(0);
		setSaveName("");
		const timer = setTimeout(() => inputRef.current?.focus(), 30);
		return () => clearTimeout(timer);
	}, [open]);

	useEffect(() => { setSelected(0); }, [query, page]);

	const q = query.trim().toLowerCase();

	const entries = useMemo<Entry[]>(() => {
		if (page === "insert") {
			return snippets
				.filter((snippet) => !q || snippet.name.toLowerCase().includes(q))
				.map((snippet) => ({
					id: snippet.id,
					label: snippet.name,
					hint: snippet.cells.length > 1 ? `${snippet.cells.length} cells` : snippet.createdBy,
					icon: faClone,
					group: "snippet" as const,
					onSelect: () => { onInsertSnippet(snippet); onClose(); },
				}));
		}
		const list: Entry[] = [];
		list.push({ id: "insert-snippet", label: "Insert snippet…", hint: snippets.length ? `${snippets.length}` : "empty", icon: faClone, group: "snippet", onSelect: () => { setPage("insert"); setQuery(""); } });
		if (canSaveCell) list.push({ id: "save-snippet", label: "Save cell as snippet", hint: saveCellHint, icon: faFloppyDisk, group: "snippet", onSelect: () => { setPage("save"); setSaveName(saveCellHint ?? ""); } });
		list.push({ id: "open-snippets", label: "Snippets", hint: "manage", icon: faLayerGroup, group: "snippet", onSelect: () => { onOpenSnippetsScreen(); onClose(); } });
		for (const command of commands) {
			list.push({ id: command.id, label: command.label, hint: command.hint, icon: command.icon, group: "command", onSelect: () => { command.run(); onClose(); } });
		}
		return list.filter((entry) => !q || entry.label.toLowerCase().includes(q) || (entry.hint ?? "").toLowerCase().includes(q));
	}, [page, q, snippets, commands, canSaveCell, saveCellHint, onInsertSnippet, onOpenSnippetsScreen, onClose]);

	useEffect(() => {
		itemRefs.current[selected]?.scrollIntoView({ block: "nearest" });
	}, [selected]);

	function back() {
		setPage("root");
		setQuery("");
		setSaveName("");
	}

	async function submitSave() {
		const name = saveName.trim();
		if (!name) return;
		await onSaveCellAsSnippet(name);
		onClose();
	}

	function handleKey(event: React.KeyboardEvent) {
		if (event.key === "Escape") {
			event.preventDefault();
			if (page === "root") onClose(); else back();
			return;
		}
		if (page === "save") {
			if (event.key === "Enter") { event.preventDefault(); submitSave(); }
			if (event.key === "Backspace" && saveName === "") { event.preventDefault(); back(); }
			return;
		}
		if (event.key === "Backspace" && query === "" && page !== "root") { event.preventDefault(); back(); return; }
		if (event.key === "ArrowDown") { event.preventDefault(); setSelected((s) => Math.min(s + 1, entries.length - 1)); return; }
		if (event.key === "ArrowUp") { event.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); return; }
		if (event.key === "Enter") { event.preventDefault(); entries[selected]?.onSelect(); return; }
	}

	if (!open) return null;

	const placeholder = page === "insert" ? "Search snippets to insert…" : "Search for, or do something…";

	return (
		<div className="palette-backdrop" role="presentation" onClick={onClose}>
			<section className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(event) => event.stopPropagation()}>
				{page === "save" ? (
					<>
						<div className="palette-search">
							<button className="palette-back" type="button" title="Back" aria-label="Back" onClick={back}><FontAwesomeIcon icon={faChevronLeft} /></button>
							<input
								ref={inputRef}
								className="palette-input"
								value={saveName}
								onChange={(event) => setSaveName(event.target.value)}
								onKeyDown={handleKey}
								placeholder="Name this snippet…"
							/>
						</div>
						<div className="palette-save-body">
							Saving {saveCellHint ? <strong>“{saveCellHint}”</strong> : "the selected cell"} to your snippet library.
						</div>
						<div className="palette-footer">
							<span className="palette-key"><kbd>↵</kbd> save</span>
							<span className="palette-key"><kbd>esc</kbd> back</span>
							<div className="palette-footer-spacer" />
							<button className="palette-save-button" type="button" onClick={submitSave} disabled={!saveName.trim()}>Save snippet</button>
						</div>
					</>
				) : (
					<>
						<div className="palette-search">
							{page === "root" ? (
								<FontAwesomeIcon icon={faMagnifyingGlass} className="palette-search-icon" />
							) : (
								<button className="palette-back" type="button" title="Back" aria-label="Back" onClick={back}><FontAwesomeIcon icon={faChevronLeft} /></button>
							)}
							<input
								ref={inputRef}
								className="palette-input"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={handleKey}
								placeholder={placeholder}
							/>
						</div>
						<div className="palette-list">
							{entries.length === 0 && (
								<div className="palette-empty">{page === "insert" ? "No snippets yet — save a cell as a snippet first." : "No matches."}</div>
							)}
							{entries.map((entry, index) => {
								const showDivider = index > 0 && entries[index - 1].group !== entry.group;
								return (
									<div key={entry.id}>
										{showDivider && <div className="palette-divider" />}
										<button
											ref={(node) => { itemRefs.current[index] = node; }}
											type="button"
											className={`palette-row ${index === selected ? "active" : ""}`}
											onMouseEnter={() => setSelected(index)}
											onClick={entry.onSelect}
										>
											<FontAwesomeIcon icon={entry.icon} className="palette-row-icon" />
											<span className="palette-row-label">{entry.label}</span>
											{entry.hint && <span className="palette-row-hint">{entry.hint}</span>}
										</button>
									</div>
								);
							})}
						</div>
						<div className="palette-footer">
							<span className="palette-key"><kbd>↵</kbd> select</span>
							<span className="palette-key"><kbd>↑↓</kbd> navigate</span>
							<span className="palette-key"><kbd>esc</kbd> {page === "root" ? "close" : "back"}</span>
						</div>
					</>
				)}
			</section>
		</div>
	);
}
