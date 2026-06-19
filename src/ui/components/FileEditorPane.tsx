import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFile, faFloppyDisk, faFolder, faFolderOpen, faPlay, faRotateRight } from "@fortawesome/free-solid-svg-icons";
import { CodeEditor } from "./CodeEditor.js";
import { OutputBlock } from "./OutputBlock.js";
import type { FileEntry, RichOutput, ThemeName } from "../types.js";

type FileEditorPaneProps = {
	fileDir: string;
	fileTree: FileEntry[];
	onLoadFiles: (path: string) => void;
	onOpenFile: (entry: FileEntry) => void;
	currentFilePath?: string;
	fileContent: string;
	fileLanguage: "python" | "markdown";
	fileDirty: boolean;
	fileOutputs: RichOutput[];
	isExecuting: boolean;
	theme: ThemeName;
	providerId?: string;
	sessionId?: string;
	onContentChange: (value: string) => void;
	onSave: () => void;
	onRun: () => void;
};

export function FileEditorPane({ fileDir, fileTree, onLoadFiles, onOpenFile, currentFilePath, fileContent, fileLanguage, fileDirty, fileOutputs, isExecuting, theme, providerId, sessionId, onContentChange, onSave, onRun }: FileEditorPaneProps) {
	return (
		<section className="notebook-panel file-editor" aria-label="File editor">
			<div className="file-editor-tree">
				<header className="sidebar-header"><FontAwesomeIcon icon={faFolderOpen} /> {fileDir} <button className="ghost-button icon-button sidebar-refresh" title="Refresh" onClick={() => onLoadFiles(fileDir)}><FontAwesomeIcon icon={faRotateRight} /></button></header>
				<div className="file-tree">
					{fileDir !== "." && <button className="file-row" onClick={() => onLoadFiles(fileDir.split("/").slice(0, -1).join("/") || ".")}><FontAwesomeIcon icon={faFolder} /> ..</button>}
					{fileTree.map((entry) => (
						<button key={entry.path} className={`file-row ${entry.path === currentFilePath ? "active" : ""}`} onClick={() => onOpenFile(entry)}><FontAwesomeIcon icon={entry.isDir ? faFolder : faFile} /> {entry.name}</button>
					))}
				</div>
			</div>
			<div className="file-editor-main">
				<div className="file-editor-toolbar">
					<span className="file-editor-path">{currentFilePath ?? "No file selected"}{fileDirty ? " •" : ""}</span>
					<div className="toolbar-spacer" />
					<button className="ghost-button" onClick={onSave} disabled={!currentFilePath}><FontAwesomeIcon icon={faFloppyDisk} /> Save</button>
					<button className="primary-button" onClick={onRun} disabled={!currentFilePath || isExecuting}><FontAwesomeIcon icon={faPlay} /> Run</button>
				</div>
				<div className="file-editor-body">
					{currentFilePath ? <CodeEditor value={fileContent} language={fileLanguage} theme={theme} providerId={providerId} sessionId={sessionId} onChange={onContentChange} onRun={onRun} onSave={onSave} /> : <div className="empty-output">Select a file from the tree to edit.</div>}
				</div>
				{fileOutputs.length > 0 && <div className="file-editor-console output-scroll">{fileOutputs.map((output, index) => <OutputBlock key={index} output={output} theme={theme} />)}</div>}
			</div>
		</section>
	);
}
