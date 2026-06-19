import { useEffect, useRef, useState } from "react";
import "@jupyter-widgets/controls/css/widgets.css";
import { useWidgetManager } from "../widgets/context.js";

// Renders an ipywidgets view for a model_id (Feature 2). The manager resolves
// the model once its comm_open has been processed off the live channel.
export function WidgetView({ modelId }: { modelId: string }) {
	const manager = useWidgetManager();
	const hostRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		if (!manager || !hostRef.current) return;
		const host = hostRef.current;
		let detach: (() => void) | undefined;
		let disposed = false;
		manager.renderView(modelId, host)
			.then((cleanup) => { if (disposed) cleanup(); else detach = cleanup; })
			.catch((err) => setError(err instanceof Error ? err.message : String(err)));
		return () => { disposed = true; detach?.(); host.replaceChildren(); };
	}, [manager, modelId]);

	if (!manager) return <div className="empty-output">Connect a kernel to view widgets.</div>;
	if (error) return <pre className="cell-output error">Widget render failed: {error}</pre>;
	return <div ref={hostRef} className="widget-output" />;
}
