import type { IpynbCell, IpynbNotebook, NotebookCell, RichOutput } from "./types.js";

export function plainTextData(value: unknown): string {
	if (Array.isArray(value)) return value.join("");
	if (typeof value === "string") return value;
	return JSON.stringify(value, null, 2);
}

export function normalizeSource(source: unknown): string {
	if (Array.isArray(source)) return source.join("");
	if (typeof source === "string") return source;
	return "";
}

function mergeCarriageReturnText(previous: string, chunk: string): string {
	let text = previous;
	for (const part of chunk.split(/(\r\n|\r|\n)/)) {
		if (part === "\r" || part === "\r\n") text = text.replace(/[^\n]*$/, "");
		else if (part === "\n") text += "\n";
		else text += part;
	}
	return text;
}

function textPlain(value: unknown): string | undefined {
	if (Array.isArray(value)) return value.join("");
	return typeof value === "string" ? value : undefined;
}

function isProgressLikeText(text: string): boolean {
	return text.includes("\r") || /\d+%\|/.test(text);
}

function isProgressLikeOutput(output: RichOutput): boolean {
	if (output.kind === "stream") return isProgressLikeText(output.text);
	if (output.kind === "display_data" || output.kind === "execute_result") return isProgressLikeText(textPlain(output.data["text/plain"]) ?? "");
	return false;
}

export function appendRichOutput(outputs: RichOutput[], output: RichOutput): RichOutput[] {
	if (output.kind === "status") return outputs;
	// `clear_output` wipes the cell's outputs. We clear eagerly; honoring the
	// `wait` flag (clear only when the next output arrives) is a future refinement.
	if (output.kind === "clear_output") return [];
	// `update_display_data` replaces the most recent display sharing its display_id.
	if (output.kind === "update_display_data") {
		const updated = [...outputs];
		const idx = output.displayId
			? updated.findLastIndex((item) => (item.kind === "display_data" || item.kind === "execute_result") && item.displayId === output.displayId)
			: -1;
		const replacement: RichOutput = { kind: "display_data", data: output.data, metadata: output.metadata, displayId: output.displayId };
		if (idx >= 0) { updated[idx] = replacement; return updated; }
		return [...updated, replacement];
	}
	const next = [...outputs];
	const last = next[next.length - 1];
	if (output.kind === "stream") {
		if (last?.kind === "stream") {
			next[next.length - 1] = { ...last, text: mergeCarriageReturnText(last.text, output.text) };
			return next;
		}
		return [...next, { ...output, text: mergeCarriageReturnText("", output.text) }];
	}
	if ((output.kind === "display_data" || output.kind === "execute_result") && isProgressLikeOutput(output)) {
		const progressIndex = next.findLastIndex((item) => item.kind === output.kind && isProgressLikeOutput(item));
		if (progressIndex >= 0) {
			const previous = next[progressIndex];
			const currentText = textPlain(output.data["text/plain"]);
			const previousText = (previous.kind === "display_data" || previous.kind === "execute_result") ? textPlain(previous.data["text/plain"]) : undefined;
			next[progressIndex] = currentText && previousText ? { ...output, data: { ...output.data, "text/plain": mergeCarriageReturnText(previousText, currentText) } } : output;
			return next;
		}
	}
	return [...next, output];
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
	if (output.kind === "unknown") return { output_type: "display_data", data: { "text/plain": plainTextData(output.content) }, metadata: {} };
	return undefined;
}

export function cellsFromNotebook(notebook: any): NotebookCell[] {
	if (notebook?.nbformat !== 4) return [];
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

export function notebookFromCells(cells: NotebookCell[]): IpynbNotebook {
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

export type TocEntry = { cellId: string; level: number; text: string };

export function tableOfContents(cells: NotebookCell[]): TocEntry[] {
	const entries: TocEntry[] = [];
	for (const cell of cells) {
		if (cell.kind !== "markdown") continue;
		for (const line of cell.content.split("\n")) {
			const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line.trim());
			if (match) entries.push({ cellId: cell.id, level: match[1].length, text: match[2] });
		}
	}
	return entries;
}

export function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let from = 0;
	const lower = haystack.toLowerCase();
	const target = needle.toLowerCase();
	while (true) {
		const idx = lower.indexOf(target, from);
		if (idx < 0) break;
		count += 1;
		from = idx + target.length;
	}
	return count;
}
