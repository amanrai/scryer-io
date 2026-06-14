import type { RichOutput } from "./types.js";

function plainTextData(value: unknown): string {
	if (Array.isArray(value)) return value.join("");
	if (typeof value === "string") return value;
	return JSON.stringify(value, null, 2);
}

export function OutputView({ output }: { output: RichOutput }) {
	if (output.kind === "status") return null;
	if (output.kind === "stream") return <pre className={`cell-output ${output.name}`}>{output.text}</pre>;
	if (output.kind === "error") return <pre className="cell-output error">{[output.ename, output.evalue, ...output.traceback].join("\n")}</pre>;
	if (output.kind === "execute_result" || output.kind === "display_data") {
		const html = output.data["text/html"];
		const png = output.data["image/png"];
		const svg = output.data["image/svg+xml"];
		const json = output.data["application/json"];
		if (typeof html === "string") return <div className="rich-output" dangerouslySetInnerHTML={{ __html: html }} />;
		if (Array.isArray(html)) return <div className="rich-output" dangerouslySetInnerHTML={{ __html: html.join("") }} />;
		if (typeof png === "string") return <div className="rich-output"><img src={`data:image/png;base64,${png}`} alt="cell output" /></div>;
		if (typeof svg === "string") return <div className="rich-output" dangerouslySetInnerHTML={{ __html: svg }} />;
		if (json) return <pre className="cell-output">{plainTextData(json)}</pre>;
		return <pre className="cell-output">{plainTextData(output.data["text/plain"] ?? output.data)}</pre>;
	}
	return <pre className="cell-output">{plainTextData(output.content)}</pre>;
}
