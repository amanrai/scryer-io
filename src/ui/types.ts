import type { KeyboardEvent } from "react";

export type CellKind = "markdown" | "code" | "mermaid";

export type RichOutput =
	| { kind: "stream"; name: "stdout" | "stderr"; text: string }
	| { kind: "execute_result" | "display_data"; data: Record<string, unknown>; metadata?: Record<string, unknown> }
	| { kind: "error"; ename: string; evalue: string; traceback: string[] }
	| { kind: "status"; executionState: string }
	| { kind: "unknown"; messageType: string; content: unknown };

export type NotebookCell = {
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

export type KernelSpec = { name: string; displayName: string; language?: string; isDefault: boolean };
export type RuntimeSession = { id: string; path: string; kernelName?: string; providerId: string };
export type SavedProvider = { id: string; label: string; baseUrl: string; defaultKernelName?: string; token?: string };
export type FileEntry = { name: string; path: string; isDir: boolean; size?: number; modified?: string };
export type VariableRow = { name: string; type: string; repr: string };
export type KernelStatus = "idle" | "busy" | "dead" | "unknown";
export type AppMode = "explorer" | "notebook" | "file" | "terminal" | "snippets";
export type LeftPanel = "toc" | "files" | "variables" | null;
export type ThemeName = "dark" | "light";

export type IpynbCell = {
	cell_type: "code" | "markdown" | "raw";
	source?: string | string[];
	metadata?: Record<string, any>;
	outputs?: any[];
	execution_count?: number | null;
};
export type IpynbNotebook = { nbformat: 4; nbformat_minor: number; metadata: Record<string, any>; cells: IpynbCell[] };

export function nowLabel(): string {
	return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function isCommand(event: KeyboardEvent, code: string): boolean {
	return event.code === code && (event.metaKey || event.ctrlKey);
}
