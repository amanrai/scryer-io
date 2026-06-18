import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

type Props = {
	providerId: string;
	terminalName: string | undefined;
	onReady: (name: string) => void;
	theme: "dark" | "light";
};

export function TerminalPane({ providerId, terminalName, onReady, theme }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const readyRef = useRef(onReady);
	readyRef.current = onReady;

	useEffect(() => {
		if (!containerRef.current) return;

		const term = new Terminal({
			theme: theme === "dark"
				? { background: "#21252B", foreground: "#ABB2BF", cursor: "#A9C7EA" }
				: { background: "#ECEEF1", foreground: "#383A42", cursor: "#5D8FC9" },
			fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
			fontSize: 13,
			lineHeight: 1.4,
			cursorBlink: true,
		});
		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.open(containerRef.current);
		fitAddon.fit();
		termRef.current = term;
		fitRef.current = fitAddon;

		let disposed = false;

		async function connect() {
			let name = terminalName;
			if (!name) {
				const res = await fetch(`/api/runtime/providers/${providerId}/terminals`, { method: "POST" });
				const json = await res.json();
				name = json.name;
				if (name) readyRef.current(name);
			}
			if (disposed || !name) return;
			const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
			const host = window.location.host || `127.0.0.1:${window.location.port || 54321}`;
			const wsUrl = `${proto}//${host}/api/runtime/providers/${providerId}/terminals/${name}`;
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			ws.onopen = () => term.writeln("\x1b[32mTerminal connected.\x1b[0m");
			ws.onmessage = (event) => {
				if (typeof event.data === "string") {
					try {
						const msg = JSON.parse(event.data);
						if (msg[0] === "stdout" || msg[0] === "stderr") term.write(msg[1]);
					} catch { /* ignore non-JSON frames */ }
				}
			};
			ws.onclose = () => term.writeln("\r\n\x1b[31mConnection closed.\x1b[0m");
			term.onData((data) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(["stdin", data])));
		}
		connect().catch(console.error);

		const ro = new ResizeObserver(() => fitRef.current?.fit());
		ro.observe(containerRef.current);

		return () => {
			disposed = true;
			ro.disconnect();
			wsRef.current?.close();
			term.dispose();
		};
	}, [providerId, theme]);

	return <div ref={containerRef} className="terminal-container" />;
}
