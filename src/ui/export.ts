// Notebook → self-contained HTML export (Feature 7). Runs entirely client-side
// so the export matches exactly what the workbench renders. PDF reuses the same
// HTML through a print window.
import { renderMarkdown } from "./markdown.js";
import { plainTextData } from "./ipynb.js";
import type { NotebookCell, RichOutput } from "./types.js";

const escapeHtml = (text: string) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

function outputToHtml(output: RichOutput): string {
	if (output.kind === "stream") return `<pre class="out ${output.name}">${escapeHtml(stripAnsi(output.text))}</pre>`;
	if (output.kind === "error") return `<pre class="out err">${escapeHtml(stripAnsi([output.evalue, ...output.traceback].join("\n")))}</pre>`;
	if (output.kind === "execute_result" || output.kind === "display_data") {
		const data = output.data;
		const html = data["text/html"];
		const rawHtml = Array.isArray(html) ? html.join("") : typeof html === "string" ? html : null;
		if (rawHtml) return `<div class="out rich">${rawHtml}</div>`;
		const png = data["image/png"];
		if (typeof png === "string") return `<div class="out rich"><img alt="output" src="data:image/png;base64,${png}" /></div>`;
		const svg = data["image/svg+xml"];
		if (typeof svg === "string") return `<div class="out rich">${svg}</div>`;
		const plain = data["text/plain"];
		if (plain != null) return `<pre class="out">${escapeHtml(plainTextData(plain))}</pre>`;
	}
	return "";
}

function cellToHtml(cell: NotebookCell, execCount: number | undefined, includeOutputs: boolean): string {
	if (cell.kind === "markdown") return `<section class="cell md">${renderMarkdown(cell.content)}</section>`;
	if (cell.kind === "mermaid") return `<section class="cell code"><pre class="src">${escapeHtml(cell.content)}</pre></section>`;
	const prompt = execCount != null ? `In [${execCount}]:` : "In [ ]:";
	const outputs = includeOutputs && cell.outputs?.length
		? `<div class="outputs">${cell.outputs.map(outputToHtml).join("")}</div>`
		: "";
	return `<section class="cell code"><div class="prompt">${escapeHtml(prompt)}</div><pre class="src">${escapeHtml(cell.content)}</pre>${outputs}</section>`;
}

const EXPORT_CSS = `
:root { color-scheme: light; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; max-width: 920px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a; background: #fff; }
h1.nb-title { font-size: 20px; border-bottom: 1px solid #e2e2e2; padding-bottom: 12px; margin-bottom: 24px; }
.cell { margin: 14px 0; }
.cell.code { border: 1px solid #e6e6e6; border-radius: 8px; overflow: hidden; }
.cell.code .prompt { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #999; padding: 4px 10px; background: #f7f7f8; border-bottom: 1px solid #eee; }
pre.src { margin: 0; padding: 10px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.outputs { border-top: 1px solid #eee; padding: 6px 12px; }
pre.out { margin: 4px 0; font-family: ui-monospace, Menlo, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
pre.out.stderr, pre.out.err { color: #c0341d; }
.out.rich img { max-width: 100%; }
.out.rich table { border-collapse: collapse; font-size: 12px; }
.out.rich table td, .out.rich table th { border: 1px solid #ddd; padding: 3px 8px; }
.cell.md { line-height: 1.6; }
.cell.md pre { background: #f7f7f8; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
`;

export function notebookToHtml(cells: NotebookCell[], execCounts: Map<string, number>, options: { title: string; includeOutputs: boolean }): string {
	const body = cells.map((cell) => cellToHtml(cell, execCounts.get(cell.id), options.includeOutputs)).join("\n");
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(options.title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css" />
<style>${EXPORT_CSS}</style>
</head>
<body>
<h1 class="nb-title">${escapeHtml(options.title)}</h1>
${body}
</body>
</html>`;
}

export function downloadHtml(html: string, filename: string) {
	const blob = new Blob([html], { type: "text/html" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

/** Open the export in a print window; the user picks "Save as PDF". */
export function printHtml(html: string) {
	const win = window.open("", "_blank");
	if (!win) return;
	win.document.write(html);
	win.document.close();
	win.addEventListener("load", () => { win.focus(); win.print(); });
	// Fallback if load already fired.
	setTimeout(() => { try { win.focus(); win.print(); } catch { /* ignore */ } }, 600);
}
