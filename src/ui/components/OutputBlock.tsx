import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faChevronDown, faChevronUp, faCopy, faDownload } from "@fortawesome/free-solid-svg-icons";
import { OutputView } from "./OutputView.js";
import { plainTextData } from "../ipynb.js";
import type { RichOutput, ThemeName } from "../types.js";

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
// Outputs taller than this get a scroll box + expand toggle (Feature 8).
const TALL_THRESHOLD_PX = 360;

/** Plain-text projection of an output for copy-to-clipboard. */
function outputToText(output: RichOutput): string {
	if (output.kind === "stream") return stripAnsi(output.text);
	if (output.kind === "error") return stripAnsi([output.evalue, ...output.traceback].join("\n"));
	if (output.kind === "execute_result" || output.kind === "display_data") {
		const plain = output.data["text/plain"];
		if (plain != null) return plainTextData(plain);
		const html = output.data["text/html"];
		if (html != null) return plainTextData(html);
		return plainTextData(output.data);
	}
	if (output.kind === "unknown") return plainTextData(output.content);
	return "";
}

/** Richest downloadable artifact for an output: a blob + filename suffix. */
function outputToDownload(output: RichOutput): { blob: Blob; ext: string } {
	if (output.kind === "execute_result" || output.kind === "display_data") {
		const png = output.data["image/png"];
		if (typeof png === "string") return { blob: b64ToBlob(png, "image/png"), ext: "png" };
		const svg = output.data["image/svg+xml"];
		if (typeof svg === "string") return { blob: new Blob([svg], { type: "image/svg+xml" }), ext: "svg" };
		const html = output.data["text/html"];
		if (html != null) return { blob: new Blob([Array.isArray(html) ? html.join("") : String(html)], { type: "text/html" }), ext: "html" };
	}
	return { blob: new Blob([outputToText(output)], { type: "text/plain" }), ext: "txt" };
}

function b64ToBlob(b64: string, type: string): Blob {
	const bytes = atob(b64);
	const arr = new Uint8Array(bytes.length);
	for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
	return new Blob([arr], { type });
}

export function OutputBlock({ output, theme = "dark" }: { output: RichOutput; theme?: ThemeName }) {
	const bodyRef = useRef<HTMLDivElement>(null);
	const [tall, setTall] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		const node = bodyRef.current;
		if (!node) return;
		const measure = () => setTall(node.scrollHeight > TALL_THRESHOLD_PX + 24);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(node);
		return () => ro.disconnect();
	}, [output]);

	async function copy() {
		try {
			await navigator.clipboard.writeText(outputToText(output));
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		} catch { /* clipboard unavailable */ }
	}

	function save() {
		const { blob, ext } = outputToDownload(output);
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `output-${Date.now()}.${ext}`;
		a.click();
		URL.revokeObjectURL(url);
	}

	if (output.kind === "status") return null;

	const constrained = tall && !expanded;
	return (
		<div className="output-block">
			<div className="output-block-actions">
				<button type="button" title={copied ? "Copied" : "Copy output"} aria-label="Copy output" onClick={copy}><FontAwesomeIcon icon={copied ? faCheck : faCopy} /></button>
				<button type="button" title="Save output to file" aria-label="Save output to file" onClick={save}><FontAwesomeIcon icon={faDownload} /></button>
				{tall && <button type="button" title={expanded ? "Collapse" : "Expand"} aria-label={expanded ? "Collapse output" : "Expand output"} onClick={() => setExpanded((value) => !value)}><FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} /></button>}
			</div>
			<div ref={bodyRef} className={`output-block-body ${constrained ? "constrained" : ""}`} style={constrained ? { maxHeight: TALL_THRESHOLD_PX } : undefined}>
				<OutputView output={output} theme={theme} />
			</div>
			{constrained && <button type="button" className="output-block-more" onClick={() => setExpanded(true)}>Show more</button>}
		</div>
	);
}
