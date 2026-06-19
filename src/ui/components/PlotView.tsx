import { useEffect, useRef, useState } from "react";

// Interactive JS plot renderers (Feature 5). Libraries are dynamically imported
// so they stay out of the main bundle and only load when a plot is shown.

type PlotlyFigure = { data: unknown[]; layout?: Record<string, unknown>; config?: Record<string, unknown> };

export function PlotlyView({ figure, theme }: { figure: PlotlyFigure; theme: "dark" | "light" }) {
	const ref = useRef<HTMLDivElement>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		let disposed = false;
		const node = ref.current;
		if (!node) return;
		(async () => {
			try {
				const Plotly = (await import("plotly.js-dist-min")).default as any;
				if (disposed || !node) return;
				const layout = {
					autosize: true,
					margin: { l: 48, r: 24, t: 32, b: 40 },
					paper_bgcolor: "transparent",
					plot_bgcolor: "transparent",
					font: { color: theme === "dark" ? "#ddd" : "#222" },
					template: theme === "dark" ? "plotly_dark" : undefined,
					...(figure.layout ?? {}),
				};
				await Plotly.react(node, figure.data, layout, { responsive: true, displaylogo: false, ...(figure.config ?? {}) });
			} catch (err) {
				if (!disposed) setError(err instanceof Error ? err.message : String(err));
			}
		})();
		return () => {
			disposed = true;
			if (node) import("plotly.js-dist-min").then((m) => (m.default as any).purge(node)).catch(() => undefined);
		};
	}, [figure, theme]);

	if (error) return <pre className="cell-output error">Plotly render failed: {error}</pre>;
	return <div className="plot-output" ref={ref} style={{ width: "100%", minHeight: 320 }} />;
}

export function VegaView({ spec, theme }: { spec: Record<string, unknown>; theme: "dark" | "light" }) {
	const ref = useRef<HTMLDivElement>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		let disposed = false;
		let view: { finalize: () => void } | null = null;
		const node = ref.current;
		if (!node) return;
		(async () => {
			try {
				const embed = (await import("vega-embed")).default;
				if (disposed || !node) return;
				const result = await embed(node, spec as any, { actions: false, theme: theme === "dark" ? "dark" : undefined, renderer: "canvas" });
				view = result.view;
			} catch (err) {
				if (!disposed) setError(err instanceof Error ? err.message : String(err));
			}
		})();
		return () => { disposed = true; view?.finalize(); };
	}, [spec, theme]);

	if (error) return <pre className="cell-output error">Vega render failed: {error}</pre>;
	return <div className="plot-output" ref={ref} style={{ width: "100%" }} />;
}
