import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFile, faFolder, faFolderOpen, faListUl, faRotateRight, faTable } from "@fortawesome/free-solid-svg-icons";
import type { TocEntry } from "../ipynb.js";
import type { FileEntry, LeftPanel, VariableRow } from "../types.js";

type SidebarProps = {
	panel: LeftPanel;
	toc: TocEntry[];
	onScrollToCell: (cellId: string) => void;
	fileDir: string;
	fileTree: FileEntry[];
	onLoadFiles: (path: string) => void;
	onOpenFile: (entry: FileEntry) => void;
	variables: VariableRow[];
	variablesLoading: boolean;
	onLoadVariables: () => void;
};

function parentDir(dir: string): string {
	return dir.split("/").slice(0, -1).join("/") || ".";
}

export function Sidebar({ panel, toc, onScrollToCell, fileDir, fileTree, onLoadFiles, onOpenFile, variables, variablesLoading, onLoadVariables }: SidebarProps) {
	return (
		<aside className="sidebar" aria-label="Sidebar">
			{panel === "toc" && (
				<div className="sidebar-panel">
					<header className="sidebar-header"><FontAwesomeIcon icon={faListUl} /> Outline</header>
					<div className="toc-list">
						{toc.length === 0 && <div className="sidebar-empty">No headings yet.</div>}
						{toc.map((entry, index) => (
							<button key={`${entry.cellId}-${index}`} className="toc-link" style={{ paddingLeft: `${8 + (entry.level - 1) * 12}px` }} onClick={() => onScrollToCell(entry.cellId)}>{entry.text}</button>
						))}
					</div>
				</div>
			)}
			{panel === "files" && (
				<div className="sidebar-panel">
					<header className="sidebar-header"><FontAwesomeIcon icon={faFolderOpen} /> Files <button className="ghost-button icon-button sidebar-refresh" title="Refresh" onClick={() => onLoadFiles(fileDir)}><FontAwesomeIcon icon={faRotateRight} /></button></header>
					<div className="file-tree">
						<div className="file-dir-label">{fileDir}</div>
						{fileDir !== "." && <button className="file-row" onClick={() => onLoadFiles(parentDir(fileDir))}><FontAwesomeIcon icon={faFolder} /> ..</button>}
						{fileTree.map((entry) => (
							<button key={entry.path} className="file-row" onClick={() => onOpenFile(entry)}><FontAwesomeIcon icon={entry.isDir ? faFolder : faFile} /> {entry.name}</button>
						))}
					</div>
				</div>
			)}
			{panel === "variables" && (
				<div className="sidebar-panel">
					<header className="sidebar-header"><FontAwesomeIcon icon={faTable} /> Variables <button className="ghost-button icon-button sidebar-refresh" title="Refresh" onClick={onLoadVariables} disabled={variablesLoading}><FontAwesomeIcon icon={faRotateRight} /></button></header>
					<div className="variable-table">
						{variables.length === 0 && <div className="sidebar-empty">{variablesLoading ? "Loading…" : "No variables loaded."}</div>}
						{variables.length > 0 && (
							<table>
								<thead><tr><th>Name</th><th>Type</th><th>Value</th></tr></thead>
								<tbody>{variables.map((v) => <tr key={v.name}><td>{v.name}</td><td>{v.type}</td><td title={v.repr}>{v.repr}</td></tr>)}</tbody>
							</table>
						)}
					</div>
				</div>
			)}
		</aside>
	);
}
