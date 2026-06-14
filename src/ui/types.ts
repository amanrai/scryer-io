import type { KeyboardEvent } from "react";

export type CellKind = "markdown" | "code";

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
	agentOpen: boolean;
	lastRun?: string;
	outputs?: RichOutput[];
};

export type KernelSpec = { name: string; displayName: string; language?: string; isDefault: boolean };
export type RuntimeSession = { id: string; path: string; kernelName?: string; providerId: string };
export type SavedProvider = { id: string; label: string; baseUrl: string; defaultKernelName?: string; token?: string };

export function lineNumbers(text: string): number[] {
	return Array.from({ length: Math.max(1, text.split("\n").length) }, (_, index) => index + 1);
}

export function nowLabel(): string {
	return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function isCommand(event: KeyboardEvent, code: string): boolean {
	return event.code === code && (event.metaKey || event.ctrlKey);
}

export function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderMarkdown(md: string): string {
	return escapeHtml(md)
		.replace(/^### (.*)$/gm, "<h3>$1</h3>")
		.replace(/^## (.*)$/gm, "<h2>$1</h2>")
		.replace(/^# (.*)$/gm, "<h1>$1</h1>")
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/^[-*] (.*)$/gm, "<div class=\"md-bullet\">• $1</div>")
		.replace(/\n/g, "<br />");
}
