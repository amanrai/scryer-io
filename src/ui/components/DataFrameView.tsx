import { useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDownload, faSort, faSortDown, faSortUp } from "@fortawesome/free-solid-svg-icons";

type ParsedFrame = { columns: string[]; rows: string[][] };

/** True when an HTML blob is a pandas DataFrame repr. */
export function isDataFrameHtml(html: string): boolean {
	return /class="[^"]*\bdataframe\b/.test(html);
}

/**
 * Parse pandas' `to_html` output into columns + rows. The leading column is the
 * frame index (pandas emits it as a <th> per row). Multi-index frames collapse
 * to their first header row — good enough for an interactive preview.
 */
function parseDataFrameHtml(html: string): ParsedFrame | null {
	try {
		const doc = new DOMParser().parseFromString(html, "text/html");
		const table = doc.querySelector("table");
		if (!table) return null;
		const headerCells = Array.from(table.querySelectorAll("thead tr")).pop()?.querySelectorAll("th, td") ?? [];
		const columns = Array.from(headerCells).map((cell) => cell.textContent?.trim() ?? "");
		if (columns.length && columns[0] === "") columns[0] = "index";
		const rows: string[][] = [];
		for (const tr of table.querySelectorAll("tbody tr")) {
			const cells = Array.from(tr.querySelectorAll("th, td")).map((cell) => cell.textContent ?? "");
			if (cells.length) rows.push(cells);
		}
		if (!columns.length || !rows.length) return null;
		return { columns, rows };
	} catch {
		return null;
	}
}

const PAGE_SIZE = 50;
const numeric = (value: string) => { const n = Number(value.replace(/,/g, "")); return Number.isFinite(n) && value.trim() !== "" ? n : null; };

function compare(a: string, b: string): number {
	const na = numeric(a);
	const nb = numeric(b);
	if (na !== null && nb !== null) return na - nb;
	return a.localeCompare(b);
}

function toCsv(columns: string[], rows: string[][]): string {
	const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
	return [columns.map(esc).join(","), ...rows.map((row) => row.map(esc).join(","))].join("\n");
}

export function DataFrameView({ html }: { html: string }) {
	const parsed = useMemo(() => parseDataFrameHtml(html), [html]);
	const [sortCol, setSortCol] = useState<number | null>(null);
	const [sortDir, setSortDir] = useState<1 | -1>(1);
	const [page, setPage] = useState(0);

	const sortedRows = useMemo(() => {
		if (!parsed) return [];
		if (sortCol === null) return parsed.rows;
		return [...parsed.rows].sort((a, b) => compare(a[sortCol] ?? "", b[sortCol] ?? "") * sortDir);
	}, [parsed, sortCol, sortDir]);

	if (!parsed) return <div className="rich-output" dangerouslySetInnerHTML={{ __html: html }} />;

	const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
	const clampedPage = Math.min(page, pageCount - 1);
	const pageRows = sortedRows.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

	function toggleSort(col: number) {
		if (sortCol === col) { if (sortDir === 1) setSortDir(-1); else { setSortCol(null); setSortDir(1); } }
		else { setSortCol(col); setSortDir(1); }
	}

	function exportCsv() {
		const blob = new Blob([toCsv(parsed!.columns, sortedRows)], { type: "text/csv" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `dataframe-${Date.now()}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	return (
		<div className="dataframe-view">
			<div className="dataframe-toolbar">
				<span className="dataframe-shape">{sortedRows.length} rows × {parsed.columns.length - 1} cols</span>
				<div className="toolbar-spacer" />
				<button type="button" className="ghost-button" title="Export as CSV" onClick={exportCsv}><FontAwesomeIcon icon={faDownload} /> CSV</button>
			</div>
			<div className="dataframe-scroll">
				<table className="dataframe-table">
					<thead>
						<tr>
							{parsed.columns.map((col, index) => (
								<th key={index} onClick={() => toggleSort(index)}>
									<span>{col}</span>
									<FontAwesomeIcon icon={sortCol === index ? (sortDir === 1 ? faSortUp : faSortDown) : faSort} className="dataframe-sort-icon" />
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{pageRows.map((row, rowIndex) => (
							<tr key={rowIndex}>
								{row.map((cell, cellIndex) => (
									<td key={cellIndex} className={cellIndex === 0 ? "dataframe-index" : ""}>{cell}</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{pageCount > 1 && (
				<div className="dataframe-pager">
					<button type="button" className="ghost-button" disabled={clampedPage === 0} onClick={() => setPage(clampedPage - 1)}>Prev</button>
					<span>Page {clampedPage + 1} / {pageCount}</span>
					<button type="button" className="ghost-button" disabled={clampedPage >= pageCount - 1} onClick={() => setPage(clampedPage + 1)}>Next</button>
				</div>
			)}
		</div>
	);
}
