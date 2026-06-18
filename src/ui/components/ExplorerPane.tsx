import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFile, faFolder, faPlus, faRotateRight } from "@fortawesome/free-solid-svg-icons";
import type { FileEntry } from "../types.js";

type ExplorerPaneProps = {
	fileDir: string;
	fileTree: FileEntry[];
	onLoadFiles: (path: string) => void;
	onOpenFile: (entry: FileEntry) => void;
	onNewNotebook: () => void;
};

export function ExplorerPane({ fileDir, fileTree, onLoadFiles, onOpenFile, onNewNotebook }: ExplorerPaneProps) {
	const segments = fileDir.split("/");
	return (
		<section className="notebook-panel explorer-panel" aria-label="File explorer">
			<div className="explorer-toolbar">
				<nav className="explorer-breadcrumb" aria-label="Current path">
					{segments.map((part, i) => (
						<span key={i} className="explorer-crumb-group">
							<button className="explorer-crumb" onClick={() => onLoadFiles(segments.slice(0, i + 1).join("/") || ".")}>{part || "/"}</button>
							{i < segments.length - 1 && <span className="explorer-sep">/</span>}
						</span>
					))}
				</nav>
				<div className="explorer-toolbar-actions">
					<button className="ghost-button icon-button" title="Refresh" onClick={() => onLoadFiles(fileDir)}><FontAwesomeIcon icon={faRotateRight} /></button>
					<button className="primary-button" onClick={onNewNotebook}><FontAwesomeIcon icon={faPlus} /> New Notebook</button>
				</div>
			</div>
			<div className="explorer-list">
				{fileDir !== "." && (
					<button className="explorer-row" onClick={() => onLoadFiles(fileDir.split("/").slice(0, -1).join("/") || ".")}>
						<FontAwesomeIcon icon={faFolder} className="explorer-icon dir" />
						<span className="explorer-name">..</span>
					</button>
				)}
				{fileTree.map((entry) => (
					<button key={entry.path} className="explorer-row" onClick={() => onOpenFile(entry)}>
						<FontAwesomeIcon icon={entry.isDir ? faFolder : faFile} className={`explorer-icon ${entry.isDir ? "dir" : "file"}`} />
						<span className="explorer-name">{entry.name}</span>
					</button>
				))}
				{fileTree.length === 0 && <div className="explorer-empty">No files in this directory.</div>}
			</div>
		</section>
	);
}
