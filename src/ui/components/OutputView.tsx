import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { plainTextData } from "../ipynb.js";
import type { RichOutput } from "../types.js";

const ANSI_FG: Record<number, string> = {
	30: "#4C566A", 31: "#E06C75", 32: "#98C379", 33: "#E5C07B",
	34: "#61AFEF", 35: "#C678DD", 36: "#56B6C2", 37: "#DCDFE4",
	90: "#636D83", 91: "#E06C75", 92: "#98C379", 93: "#E5C07B",
	94: "#61AFEF", 95: "#C678DD", 96: "#56B6C2", 97: "#FFFFFF",
};

function ansiToHtml(text: string): string {
	const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const open: string[] = [];
	const result = escaped.replace(/\x1b\[([0-9;]*)m/g, (_m, codes: string) => {
		const nums = codes === "" ? [0] : codes.split(";").map(Number);
		let out = "";
		for (const n of nums) {
			if (n === 0) { out += "</span>".repeat(open.length); open.length = 0; }
			else if (n === 1) { out += '<span style="font-weight:600">'; open.push("b"); }
			else if (n === 3) { out += '<span style="font-style:italic">'; open.push("i"); }
			else if (n === 4) { out += '<span style="text-decoration:underline">'; open.push("u"); }
			else if (ANSI_FG[n]) { out += `<span style="color:${ANSI_FG[n]}">`;  open.push("c"); }
		}
		return out;
	});
	return result + "</span>".repeat(open.length);
}

export function AnsiPre({ text, className }: { text: string; className: string }) {
	return <pre className={className} dangerouslySetInnerHTML={{ __html: ansiToHtml(text) }} />;
}

let mermaidInitialized = false;

async function renderMermaid(source: string, id: string): Promise<string> {
	const mermaid = (await import("mermaid")).default;
	if (!mermaidInitialized) {
		mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
		mermaidInitialized = true;
	}
	const result = await mermaid.render(`mermaid-${id}-${Date.now()}`, source);
	return DOMPurify.sanitize(result.svg);
}

export function MermaidView({ source, id }: { source: string; id: string }) {
	const [svg, setSvg] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		let cancelled = false;
		async function render() {
			if (!source.trim()) { setSvg(""); setError(""); setLoading(false); return; }
			setLoading(true);
			try {
				const nextSvg = await renderMermaid(source, id);
				if (!cancelled) { setSvg(nextSvg); setError(""); }
			} catch (err) {
				if (!cancelled) { setSvg(""); setError(err instanceof Error ? err.message : String(err)); }
			} finally {
				if (!cancelled) setLoading(false);
			}
		}
		render();
		return () => { cancelled = true; };
	}, [id, source]);

	if (error) return <pre className="cell-output error">{error}</pre>;
	if (loading && !svg) return <div className="empty-output">Rendering diagram…</div>;
	if (!svg) return <div className="empty-output">No diagram rendered.</div>;
	return <div className="mermaid-output" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function OutputView({ output }: { output: RichOutput }) {
	if (output.kind === "status") return null;
	if (output.kind === "stream") return <AnsiPre className={`cell-output ${output.name}`} text={output.text} />;
	if (output.kind === "error") {
		const text = [output.ename, output.evalue, ...output.traceback].join("\n");
		return <AnsiPre className="cell-output error" text={text} />;
	}
	if (output.kind === "execute_result" || output.kind === "display_data") {
		const html = output.data["text/html"];
		const png = output.data["image/png"];
		const svg = output.data["image/svg+xml"];
		const json = output.data["application/json"];
		const rawHtml = Array.isArray(html) ? html.join("") : typeof html === "string" ? html : null;
		if (rawHtml) return <div className="rich-output" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(rawHtml) }} />;
		if (typeof png === "string") return <div className="rich-output"><img src={`data:image/png;base64,${png}`} alt="cell output" style={{ maxWidth: "100%" }} /></div>;
		if (typeof svg === "string") return <div className="rich-output" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(typeof svg === "string" ? svg : "") }} />;
		if (json) return <pre className="cell-output">{plainTextData(json)}</pre>;
		const plain = output.data["text/plain"];
		return <AnsiPre className="cell-output" text={plainTextData(plain ?? output.data)} />;
	}
	if (output.kind === "unknown") return <pre className="cell-output">{plainTextData(output.content)}</pre>;
	return null;
}
