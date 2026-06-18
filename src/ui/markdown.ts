import DOMPurify from "dompurify";
import { marked } from "marked";
import katex from "katex";

function renderMathSegments(html: string): string {
	let out = html.replace(/\$\$([\s\S]+?)\$\$/g, (match, expr: string) => {
		try { return katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false, output: "html" }); }
		catch { return match; }
	});
	out = out.replace(/(^|[^\\$])\$(?!\$)([^\n$]+?)\$/g, (match, pre: string, expr: string) => {
		try { return pre + katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false, output: "html" }); }
		catch { return match; }
	});
	return out;
}

export function renderMarkdown(md: string): string {
	const html = marked.parse(md, { async: false }) as string;
	return DOMPurify.sanitize(renderMathSegments(html));
}
