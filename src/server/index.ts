import express from "express";
import http from "node:http";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { JupyterRuntime } from "../jupyter-runtime.js";
import type { CellOutput, JupyterProviderProfile, RuntimeSession, Snippet, SnippetCell } from "../types.js";

const DEFAULT_API_PORT = 54322;
const port = Number(process.env.SCRYER_IO_API_PORT ?? DEFAULT_API_PORT);
const DATA_DIR = join(process.cwd(), "data");
const PROVIDERS_PATH = join(DATA_DIR, "providers.json");
const SECRETS_PATH = join(DATA_DIR, "secrets.json");
const NOTEBOOK_PATH = join(DATA_DIR, "notebook.ipynb");
const SNIPPETS_PATH = join(DATA_DIR, "snippets.json");

const app = express();
let currentNotebookPath = NOTEBOOK_PATH;
const providers = new Map<string, JupyterProviderProfile>();
const runtimes = new Map<string, JupyterRuntime>();
let activeSession: RuntimeSession | undefined;

app.use(express.json({ limit: "10mb" }));

function publicProvider(profile: JupyterProviderProfile) {
	return {
		id: profile.id,
		kind: profile.kind,
		label: profile.label,
		baseUrl: profile.baseUrl,
		defaultKernelName: profile.defaultKernelName,
		token: profile.auth.kind === "token" ? profile.auth.token : "",
		auth: { kind: profile.auth.kind },
	};
}

async function readJson<T>(path: string): Promise<T | undefined> {
	try { return JSON.parse(await readFile(path, "utf8")) as T; }
	catch { return undefined; }
}

async function writeJson(path: string, value: unknown) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(value, null, 2));
}

async function loadProviders() {
	const raw = await readJson<{ providers?: JupyterProviderProfile[] }>(PROVIDERS_PATH);
	for (const profile of raw?.providers ?? []) {
		providers.set(profile.id, profile);
		runtimes.set(profile.id, new JupyterRuntime(profile));
	}
}

async function saveProviders() {
	await writeJson(PROVIDERS_PATH, { providers: [...providers.values()] });
}

function emptyNotebook() {
	return { nbformat: 4, nbformat_minor: 5, metadata: { scryer: { app: "scryer-io", version: 1 } }, cells: [] };
}

function resolveNotebookPath(rawPath: string) {
	const expanded = rawPath.startsWith("~/") ? join(homedir(), rawPath.slice(2)) : rawPath;
	const path = isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
	if (extname(path) !== ".ipynb") throw new Error("Notebook path must end in .ipynb");
	return path;
}

async function readNotebook() {
	const notebook = await readJson<any>(currentNotebookPath);
	return notebook?.nbformat === 4 ? notebook : emptyNotebook();
}
function outputText(outputs: CellOutput[]): string {
	return outputs.map((output) => {
		if (output.kind === "stream") return output.text;
		if (output.kind === "error") return [output.ename, output.evalue, ...output.traceback].filter(Boolean).join("\n");
		if (output.kind === "execute_result" || output.kind === "display_data") {
			const text = output.data["text/plain"];
			if (Array.isArray(text)) return text.join("");
			if (typeof text === "string") return text;
			return JSON.stringify(output.data, null, 2);
		}
		return "";
	}).filter(Boolean).join("\n");
}

function getRuntime(providerId: string): JupyterRuntime {
	const runtime = runtimes.get(providerId);
	if (!runtime) throw new Error(`Unknown provider: ${providerId}`);
	return runtime;
}

function resolveWorkspacePath(rawPath: string): string {
	const p = (rawPath || "~").replace(/^~/, process.env.HOME ?? process.cwd());
	return resolve(p);
}

function stdoutText(outputs: CellOutput[]): string {
	return outputs
		.filter((output): output is Extract<CellOutput, { kind: "stream" }> => output.kind === "stream" && output.name === "stdout")
		.map((output) => output.text)
		.join("");
}

const VARIABLES_SNIPPET =
	"import json; _vars = {k: {'type': type(v).__name__, 'repr': repr(v)[:120]} for k,v in locals().items() if not k.startswith('_') and k not in ('In','Out','get_ipython','exit','quit','json')}; print(json.dumps(_vars))";

app.get("/api/healthz", (_req, res) => {
	res.json({ ok: true, service: "scryer-io-api", port });
});

app.get("/api/notebook", async (_req, res) => {
	const notebook = await readNotebook();
	res.json({ ...notebook, metadata: { ...notebook.metadata, scryer: { ...notebook.metadata?.scryer, path: currentNotebookPath } } });
});

app.put("/api/notebook", async (req, res) => {
	await writeJson(currentNotebookPath, req.body?.nbformat === 4 ? req.body : emptyNotebook());
	res.json({ ok: true, path: currentNotebookPath });
});

app.post("/api/notebook/open", async (req, res) => {
	try {
		currentNotebookPath = resolveNotebookPath(String(req.body?.path ?? ""));
		const notebook = await readNotebook();
		res.json({ ...notebook, metadata: { ...notebook.metadata, scryer: { ...notebook.metadata?.scryer, path: currentNotebookPath } } });
	} catch (err: any) {
		res.status(400).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/notebook/new", async (req, res) => {
	try {
		currentNotebookPath = resolveNotebookPath(String(req.body?.path ?? ""));
		const notebook = emptyNotebook();
		await writeJson(currentNotebookPath, notebook);
		res.status(201).json(notebook);
	} catch (err: any) {
		res.status(400).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/notebook/close", async (_req, res) => {
	currentNotebookPath = NOTEBOOK_PATH;
	res.json(emptyNotebook());
});

app.get("/api/runtime/providers", (_req, res) => {
	res.json({ providers: [...providers.values()].map(publicProvider), activeSession });
});

app.post("/api/runtime/providers", async (req, res) => {
	try {
		const body = req.body ?? {};
		const id = String(body.id || "local");
		const baseUrl = String(body.baseUrl || "").trim();
		if (!baseUrl) return res.status(400).json({ error: "baseUrl is required" });
		const profile: JupyterProviderProfile = {
			id,
			kind: "jupyter",
			label: String(body.label || id),
			baseUrl,
			auth: body.token ? { kind: "token", token: String(body.token) } : { kind: "none" },
			defaultKernelName: body.defaultKernelName ? String(body.defaultKernelName) : undefined,
		};
		const runtime = new JupyterRuntime(profile);
		const kernelSpecs = await runtime.getKernelSpecs();
		providers.set(id, profile);
		runtimes.set(id, runtime);
		await saveProviders();
		res.status(201).json({ provider: publicProvider(profile), kernelSpecs });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.delete("/api/runtime/providers/:providerId", async (req, res) => {
	try {
		const providerId = req.params.providerId;
		providers.delete(providerId);
		runtimes.delete(providerId);
		if (activeSession?.providerId === providerId) activeSession = undefined;
		await saveProviders();
		res.json({ ok: true });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.get("/api/runtime/providers/:providerId/kernelspecs", async (req, res) => {
	try { res.json({ kernelSpecs: await getRuntime(req.params.providerId).getKernelSpecs() }); }
	catch (err: any) { res.status(500).json({ error: err?.message ?? String(err) }); }
});

app.get("/api/runtime/providers/:providerId/sessions", async (req, res) => {
	try { res.json({ sessions: await getRuntime(req.params.providerId).listSessions() }); }
	catch (err: any) { res.status(500).json({ error: err?.message ?? String(err) }); }
});

app.post("/api/runtime/providers/:providerId/sessions", async (req, res) => {
	try {
		const body = req.body ?? {};
		const session = await getRuntime(req.params.providerId).startSession({
			path: String(body.path || `scryer-io-${Date.now()}.ipynb`),
			name: body.name ? String(body.name) : undefined,
			type: body.type ? String(body.type) : "notebook",
			kernelName: body.kernelName ? String(body.kernelName) : undefined,
		});
		activeSession = session;
		res.status(201).json({ session });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/runtime/providers/:providerId/restart", async (req, res) => {
	try {
		const body = req.body ?? {};
		const sessionId = body.sessionId ? String(body.sessionId) : activeSession?.providerId === req.params.providerId ? activeSession.id : undefined;
		if (!sessionId) return res.status(400).json({ error: "No active session to restart" });
		await getRuntime(req.params.providerId).restart(sessionId);
		res.json({ ok: true, sessionId });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/runtime/providers/:providerId/interrupt", async (req, res) => {
	try {
		const body = req.body ?? {};
		const sessionId = body.sessionId ? String(body.sessionId) : activeSession?.providerId === req.params.providerId ? activeSession.id : undefined;
		if (!sessionId) return res.status(400).json({ error: "No active session to interrupt" });
		await getRuntime(req.params.providerId).interrupt(sessionId);
		res.json({ ok: true, sessionId });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/runtime/providers/:providerId/execute", async (req, res) => {
	try {
		const body = req.body ?? {};
		const code = String(body.code ?? "");
		if (!code.trim()) return res.status(400).json({ error: "code is required" });
		const runtime = getRuntime(req.params.providerId);
		const startedAt = performance.now();
		const result = await runtime.execute({
			code,
			sessionId: body.sessionId ? String(body.sessionId) : activeSession?.providerId === req.params.providerId ? activeSession.id : undefined,
			path: body.path ? String(body.path) : "scryer-io.ipynb",
			kernelName: body.kernelName ? String(body.kernelName) : undefined,
		});
		const elapsedMs = Math.round(performance.now() - startedAt);
		activeSession = result.session;
		res.json({ ...result, elapsedMs, text: outputText(result.outputs) });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/runtime/providers/:providerId/execute/stream", async (req, res) => {
	const writeEvent = (event: unknown) => res.write(`${JSON.stringify(event)}\n`);
	try {
		const body = req.body ?? {};
		const code = String(body.code ?? "");
		if (!code.trim()) return res.status(400).json({ error: "code is required" });
		res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
		res.setHeader("Cache-Control", "no-cache, no-transform");
		res.setHeader("X-Accel-Buffering", "no");
		res.flushHeaders?.();
		const runtime = getRuntime(req.params.providerId);
		const startedAt = performance.now();
		const result = await runtime.execute({
			code,
			sessionId: body.sessionId ? String(body.sessionId) : activeSession?.providerId === req.params.providerId ? activeSession.id : undefined,
			path: body.path ? String(body.path) : "scryer-io.ipynb",
			kernelName: body.kernelName ? String(body.kernelName) : undefined,
		}, (output) => writeEvent({ type: "output", output }));
		const elapsedMs = Math.round(performance.now() - startedAt);
		activeSession = result.session;
		writeEvent({ type: "done", ...result, elapsedMs, text: outputText(result.outputs) });
	} catch (err: any) {
		if (!res.headersSent) res.status(500);
		writeEvent({ type: "error", error: err?.message ?? String(err) });
	} finally {
		res.end();
	}
});

app.get("/api/runtime/providers/:providerId/kernel-status", async (req, res) => {
	try {
		const sessionId = typeof req.query.sessionId === "string"
			? req.query.sessionId
			: activeSession?.providerId === req.params.providerId ? activeSession.id : undefined;
		res.json(await getRuntime(req.params.providerId).getKernelStatus(sessionId));
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/runtime/providers/:providerId/shutdown", async (req, res) => {
	try {
		const body = req.body ?? {};
		const sessionId = body.sessionId ? String(body.sessionId) : activeSession?.providerId === req.params.providerId ? activeSession.id : undefined;
		if (!sessionId) return res.status(400).json({ error: "No active session to shut down" });
		await getRuntime(req.params.providerId).shutdown(sessionId);
		if (activeSession?.id === sessionId) activeSession = undefined;
		res.json({ ok: true, sessionId });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/runtime/providers/:providerId/variables", async (req, res) => {
	try {
		const body = req.body ?? {};
		const runtime = getRuntime(req.params.providerId);
		const result = await runtime.execute({
			code: VARIABLES_SNIPPET,
			sessionId: body.sessionId ? String(body.sessionId) : activeSession?.providerId === req.params.providerId ? activeSession.id : undefined,
			path: "scryer-io.ipynb",
			kernelName: body.kernelName ? String(body.kernelName) : undefined,
			silent: true,
			storeHistory: false,
		});
		activeSession = result.session;
		const raw = stdoutText(result.outputs).trim();
		let variables: Array<{ name: string; type: string; repr: string }> = [];
		if (raw) {
			try {
				const parsed = JSON.parse(raw) as Record<string, { type: string; repr: string }>;
				variables = Object.entries(parsed).map(([name, info]) => ({ name, type: info.type, repr: info.repr }));
			} catch {
				variables = [];
			}
		}
		res.json({ variables });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/runtime/providers/:providerId/complete", async (req, res) => {
	try {
		const body = req.body ?? {};
		const code = String(body.code ?? "");
		const cursorPos = Number(body.cursorPos ?? code.length);
		const sessionId = body.sessionId ? String(body.sessionId) : activeSession?.providerId === req.params.providerId ? activeSession.id : undefined;
		if (!sessionId) return res.status(400).json({ error: "No active session" });
		res.json(await getRuntime(req.params.providerId).requestComplete(sessionId, code, cursorPos));
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/runtime/providers/:providerId/inspect", async (req, res) => {
	try {
		const body = req.body ?? {};
		const code = String(body.code ?? "");
		const cursorPos = Number(body.cursorPos ?? code.length);
		const detailLevel = body.detailLevel === 1 ? 1 : 0;
		const sessionId = body.sessionId ? String(body.sessionId) : activeSession?.providerId === req.params.providerId ? activeSession.id : undefined;
		if (!sessionId) return res.status(400).json({ error: "No active session" });
		res.json(await getRuntime(req.params.providerId).requestInspect(sessionId, code, cursorPos, detailLevel));
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/runtime/providers/:providerId/terminals", async (req, res) => {
	try {
		res.status(201).json(await getRuntime(req.params.providerId).createTerminal());
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

// Run ruff over stdin. Tries the `ruff` binary, then `python3 -m ruff`. Resolves
// with available:false (never throws) when ruff is not installed (Feature 6).
function runRuff(args: string[], input: string): Promise<{ available: boolean; code: number; stdout: string; stderr: string }> {
	const candidates: Array<{ cmd: string; argv: string[] }> = process.env.SCRYER_RUFF_BIN
		? [{ cmd: process.env.SCRYER_RUFF_BIN, argv: args }]
		: [{ cmd: "ruff", argv: args }, { cmd: "python3", argv: ["-m", "ruff", ...args] }];
	return new Promise((resolve) => {
		const attempt = (index: number) => {
			const candidate = candidates[index];
			if (!candidate) { resolve({ available: false, code: -1, stdout: "", stderr: "ruff not found" }); return; }
			let stdout = "", stderr = "";
			let spawnFailed = false;
			const child = spawn(candidate.cmd, candidate.argv, { stdio: ["pipe", "pipe", "pipe"] });
			child.on("error", () => { spawnFailed = true; attempt(index + 1); });
			child.stdout.on("data", (chunk) => { stdout += chunk; });
			child.stderr.on("data", (chunk) => { stderr += chunk; });
			child.on("close", (code) => { if (!spawnFailed) resolve({ available: true, code: code ?? 0, stdout, stderr }); });
			child.stdin.end(input);
		};
		attempt(0);
	});
}

app.post("/api/lint", async (req, res) => {
	try {
		const code = String(req.body?.code ?? "");
		if (!code.trim()) return res.json({ available: true, diagnostics: [] });
		const result = await runRuff(["check", "--output-format", "json", "--stdin-filename", "cell.py", "-"], code);
		if (!result.available) return res.json({ available: false, diagnostics: [] });
		let diagnostics: unknown[] = [];
		try {
			const parsed = JSON.parse(result.stdout || "[]") as Array<any>;
			diagnostics = parsed.map((d) => ({
				code: d.code, message: d.message,
				line: d.location?.row ?? 1, column: d.location?.column ?? 1,
				endLine: d.end_location?.row ?? d.location?.row ?? 1, endColumn: d.end_location?.column ?? (d.location?.column ?? 1) + 1,
			}));
		} catch { diagnostics = []; }
		res.json({ available: true, diagnostics });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/format", async (req, res) => {
	try {
		const code = String(req.body?.code ?? "");
		const result = await runRuff(["format", "-"], code);
		if (!result.available) return res.json({ available: false, formatted: code });
		if (result.code !== 0) return res.status(422).json({ available: true, error: result.stderr || "Format failed", formatted: code });
		res.json({ available: true, formatted: result.stdout });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.get("/api/files", async (req, res) => {
	try {
		const dir = resolveWorkspacePath(typeof req.query.path === "string" ? req.query.path : ".");
		const entries = await readdir(dir, { withFileTypes: true });
		const items = await Promise.all(entries.map(async (entry) => {
			const full = join(dir, entry.name);
			const isDir = entry.isDirectory();
			let size: number | undefined;
			let modified: string | undefined;
			try {
				const info = await stat(full);
				size = isDir ? undefined : info.size;
				modified = info.mtime.toISOString();
			} catch { /* ignore */ }
			return { name: entry.name, path: full.split(sep).join("/"), isDir, size, modified };
		}));
		items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
		res.json({ path: dir.split(sep).join("/"), entries: items });
	} catch (err: any) {
		res.status(400).json({ error: err?.message ?? String(err) });
	}
});

app.get("/api/files/read", async (req, res) => {
	try {
		const file = resolveWorkspacePath(typeof req.query.path === "string" ? req.query.path : "");
		const content = await readFile(file, "utf8");
		res.json({ path: file.split(sep).join("/"), content });
	} catch (err: any) {
		res.status(400).json({ error: err?.message ?? String(err) });
	}
});

app.put("/api/files/write", async (req, res) => {
	try {
		const body = req.body ?? {};
		const file = resolveWorkspacePath(String(body.path ?? ""));
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, String(body.content ?? ""), "utf8");
		res.json({ ok: true, path: file.split(sep).join("/") });
	} catch (err: any) {
		res.status(400).json({ error: err?.message ?? String(err) });
	}
});

app.post("/api/files/mkdir", async (req, res) => {
	try {
		const body = req.body ?? {};
		const dir = resolveWorkspacePath(String(body.path ?? ""));
		await mkdir(dir, { recursive: true });
		res.status(201).json({ ok: true, path: dir.split(sep).join("/") });
	} catch (err: any) {
		res.status(400).json({ error: err?.message ?? String(err) });
	}
});

async function readSnippets(): Promise<Snippet[]> {
	const data = await readJson<{ snippets?: Snippet[] }>(SNIPPETS_PATH);
	return data?.snippets ?? [];
}

async function writeSnippets(snippets: Snippet[]) {
	await writeJson(SNIPPETS_PATH, { snippets });
}

function sanitizeSnippetCells(raw: unknown): SnippetCell[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((cell): SnippetCell => {
			const kind = (cell?.kind === "markdown" || cell?.kind === "mermaid") ? cell.kind : "code";
			return { kind, title: String(cell?.title ?? "Untitled"), content: String(cell?.content ?? "") };
		})
		.filter((cell) => cell.content.length > 0 || cell.title !== "Untitled");
}

app.get("/api/snippets", async (_req, res) => {
	res.json({ snippets: await readSnippets() });
});

app.post("/api/snippets", async (req, res) => {
	try {
		const body = req.body ?? {};
		const cells = sanitizeSnippetCells(body.cells);
		if (!cells.length) return res.status(400).json({ error: "A snippet needs at least one non-empty cell" });
		const now = new Date().toISOString();
		const snippet: Snippet = {
			id: randomUUID(),
			name: String(body.name || "Untitled snippet").trim() || "Untitled snippet",
			createdBy: body.createdBy === "agent" ? "agent" : "human",
			cells,
			createdAt: now,
			updatedAt: now,
		};
		const snippets = await readSnippets();
		snippets.push(snippet);
		await writeSnippets(snippets);
		res.status(201).json({ snippet });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.patch("/api/snippets/:id", async (req, res) => {
	try {
		const body = req.body ?? {};
		const snippets = await readSnippets();
		const snippet = snippets.find((item) => item.id === req.params.id);
		if (!snippet) return res.status(404).json({ error: "Snippet not found" });
		if (typeof body.name === "string") snippet.name = body.name.trim() || snippet.name;
		if (body.cells !== undefined) {
			const cells = sanitizeSnippetCells(body.cells);
			if (!cells.length) return res.status(400).json({ error: "A snippet needs at least one non-empty cell" });
			snippet.cells = cells;
		}
		snippet.updatedAt = new Date().toISOString();
		await writeSnippets(snippets);
		res.json({ snippet });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.delete("/api/snippets/:id", async (req, res) => {
	const snippets = await readSnippets();
	const next = snippets.filter((item) => item.id !== req.params.id);
	if (next.length === snippets.length) return res.status(404).json({ error: "Snippet not found" });
	await writeSnippets(next);
	res.json({ ok: true });
});

async function readSecrets(): Promise<Record<string, string>> {
	const data = await readJson<{ secrets?: Record<string, string> }>(SECRETS_PATH);
	return data?.secrets ?? {};
}

const REQUIREMENTS_PATH = join(DATA_DIR, "requirements.txt");
const ONSTART_PATH = join(DATA_DIR, "onstart.sh");

const DEFAULT_ONSTART = `#!/usr/bin/env bash
set -e
pip install -q jupyterlab
if [ -n "$REQUIREMENTS" ]; then
  printf '%b' "$REQUIREMENTS" > /tmp/requirements.txt
  pip install -q -r /tmp/requirements.txt
fi
jupyter lab --allow-root --no-browser --port=8080 --ip=0.0.0.0 --ServerApp.token="$JUPYTER_TOKEN"
`;

async function readStartup() {
	const [requirements, onstart] = await Promise.all([
		readFile(REQUIREMENTS_PATH, "utf8").catch(() => ""),
		readFile(ONSTART_PATH, "utf8").catch(() => DEFAULT_ONSTART),
	]);
	return { requirements, onstart };
}

app.get("/api/startup", async (_req, res) => {
	res.json(await readStartup());
});

app.put("/api/startup", async (req, res) => {
	const { requirements, onstart } = req.body ?? {};
	await Promise.all([
		writeFile(REQUIREMENTS_PATH, String(requirements ?? ""), "utf8"),
		writeFile(ONSTART_PATH, String(onstart ?? DEFAULT_ONSTART), "utf8"),
	]);
	res.json({ ok: true });
});

function tcpPing(host: string, port: number, timeoutMs: number): Promise<number | null> {
	return new Promise((resolve) => {
		const start = Date.now();
		const socket = createConnection({ host, port }, () => {
			resolve(Date.now() - start);
			socket.destroy();
		});
		socket.setTimeout(timeoutMs);
		socket.on("timeout", () => { socket.destroy(); resolve(null); });
		socket.on("error", () => resolve(null));
	});
}

async function pingOffers(offers: any[]): Promise<void> {
	await Promise.all(offers.map(async (offer) => {
		const ip = offer.public_ipaddr as string | undefined;
		if (!ip) return;
		offer.latencyMs = await tcpPing(ip, 22, 500);
	}));
}

// Cache of all GPU names seen across offers calls — used for filter matching.
const knownGpuNames = new Set<string>();
let gpuNamesCachedAt = 0;

async function fetchBundlesPages(vastApiKey: string, q: string, count: number): Promise<any[]> {
	const url = `https://console.vast.ai/api/v0/bundles/?q=${q}`;
	const headers = { Authorization: `Bearer ${vastApiKey}` };
	const pages = await Promise.all(
		Array.from({ length: count }, () =>
			fetch(url, { headers }).then((r) => r.json() as Promise<any>).catch(() => ({ offers: [] }))
		)
	);
	const seen = new Set<number>();
	const offers: any[] = [];
	for (const page of pages) {
		for (const offer of page.offers ?? []) {
			if (!seen.has(offer.id)) { seen.add(offer.id); offers.push(offer); }
			if (offer.gpu_name) knownGpuNames.add(offer.gpu_name as string);
		}
	}
	return offers;
}

async function warmGpuNames(vastApiKey: string) {
	if (Date.now() - gpuNamesCachedAt < 5 * 60 * 1000) return;
	gpuNamesCachedAt = Date.now();
	const q = encodeURIComponent(JSON.stringify({ rentable: { eq: true } }));
	await fetchBundlesPages(vastApiKey, q, 8).catch(() => {});
}

function extractJupyterEndpoint(instance: Record<string, any>): { baseUrl: string; token?: string } | null {
	if (instance.jupyter_url) return { baseUrl: instance.jupyter_url };
	const ip = instance.public_ipaddr as string | undefined;
	if (!ip) return null;
	const ports = (instance.ports ?? {}) as Record<string, Array<{ HostIp: string; HostPort: string }>>;
	for (const portKey of ["8080/tcp", "8888/tcp", "8081/tcp"]) {
		const mapping = ports[portKey];
		if (mapping?.[0]?.HostPort) return { baseUrl: `http://${ip}:${mapping[0].HostPort}/` };
	}
	return null;
}

app.get("/api/vast/instances", async (_req, res) => {
	const { vastApiKey } = await readSecrets();
	if (!vastApiKey) return res.status(401).json({ error: "No Vast API key configured" });
	try {
		const resp = await fetch("https://console.vast.ai/api/v0/instances/?owner=me", {
			headers: { Authorization: `Bearer ${vastApiKey}` },
		});
		const data = await resp.json() as any;
		if (!resp.ok) return res.status(resp.status).json({ error: data?.msg ?? data?.error ?? `Vast API ${resp.status}` });
		res.json(data);
	} catch (err: any) { res.status(500).json({ error: err?.message ?? String(err) }); }
});

app.get("/api/vast/instances/:id", async (req, res) => {
	const { vastApiKey } = await readSecrets();
	if (!vastApiKey) return res.status(401).json({ error: "No Vast API key configured" });
	try {
		const resp = await fetch(`https://console.vast.ai/api/v0/instances/${req.params.id}/`, {
			headers: { Authorization: `Bearer ${vastApiKey}` },
		});
		const data = await resp.json() as any;
		if (!resp.ok) return res.status(resp.status).json({ error: data?.msg ?? data?.error ?? `Vast API ${resp.status}` });
		res.json(data);
	} catch (err: any) { res.status(500).json({ error: err?.message ?? String(err) }); }
});

app.get("/api/vast/offers", async (req, res) => {
	const { vastApiKey } = await readSecrets();
	if (!vastApiKey) return res.status(401).json({ error: "No Vast API key configured" });
	try {
		const filter = typeof req.query.filter === "string" ? req.query.filter.trim().toLowerCase() : "";

		let offers: any[];

		if (filter) {
			// Warm the GPU name cache if empty, then do a targeted gpu_name query
			await warmGpuNames(vastApiKey);
			const matchingNames = [...knownGpuNames].filter((n) => n.toLowerCase().includes(filter));
			if (matchingNames.length === 0) {
				// No cached names match — return unfiltered broad sample
				const q = encodeURIComponent(JSON.stringify({ rentable: { eq: true } }));
				offers = await fetchBundlesPages(vastApiKey, q, 4);
			} else {
				// Query exactly the matching GPU types — fewer results but complete coverage
				const q = encodeURIComponent(JSON.stringify({ rentable: { eq: true }, gpu_name: { in: matchingNames } }));
				offers = await fetchBundlesPages(vastApiKey, q, 2);
			}
		} else {
			// No filter: 4 parallel calls for a broad sample, also warms the GPU name cache
			const q = encodeURIComponent(JSON.stringify({ rentable: { eq: true } }));
			offers = await fetchBundlesPages(vastApiKey, q, 4);
			gpuNamesCachedAt = Date.now();
		}

		if (offers.length === 0 && !filter) {
			return res.status(502).json({ error: "Vast API returned no offers" });
		}

		offers.sort((a, b) => (a.dph_total ?? 0) - (b.dph_total ?? 0));
		await pingOffers(offers);
		res.json({ offers, gpuNames: [...knownGpuNames].sort() });
	} catch (err: any) { res.status(500).json({ error: err?.message ?? String(err) }); }
});

app.post("/api/vast/instances", async (req, res) => {
	const { vastApiKey } = await readSecrets();
	if (!vastApiKey) return res.status(401).json({ error: "No Vast API key configured" });
	try {
		const body = req.body ?? {};
		const offerId = Number(body.offerId);
		if (!offerId) return res.status(400).json({ error: "offerId required" });
		const jupyterToken = `scryer-${Date.now()}`;
		const { requirements, onstart } = await readStartup();
		// Escape requirements for shell: newlines → literal \n so bash printf can restore them
		const requirementsEscaped = requirements.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
		const payload = {
			client_id: "me",
			image: String(body.image ?? "pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime"),
			env: { JUPYTER_TOKEN: jupyterToken, REQUIREMENTS: requirementsEscaped },
			disk: Number(body.disk ?? 20),
			label: "scryer-io",
			onstart,
			runtype: "args",
		};
		const resp = await fetch(`https://console.vast.ai/api/v0/asks/${offerId}/`, {
			method: "PUT",
			headers: { Authorization: `Bearer ${vastApiKey}`, "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		const data = await resp.json() as any;
		if (!resp.ok) return res.status(resp.status).json({ error: data?.error ?? `Vast API ${resp.status}` });
		res.status(201).json({ ...data, jupyterToken });
	} catch (err: any) { res.status(500).json({ error: err?.message ?? String(err) }); }
});

app.delete("/api/vast/instances/:id", async (req, res) => {
	const { vastApiKey } = await readSecrets();
	if (!vastApiKey) return res.status(401).json({ error: "No Vast API key configured" });
	try {
		const resp = await fetch(`https://console.vast.ai/api/v0/instances/${req.params.id}/`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${vastApiKey}` },
		});
		if (!resp.ok) {
			const data = await resp.json().catch(() => ({})) as any;
			return res.status(resp.status).json({ error: data?.error ?? `Vast API ${resp.status}` });
		}
		res.json({ ok: true });
	} catch (err: any) { res.status(500).json({ error: err?.message ?? String(err) }); }
});

app.post("/api/vast/connect/:id", async (req, res) => {
	const { vastApiKey } = await readSecrets();
	if (!vastApiKey) return res.status(401).json({ error: "No Vast API key configured" });
	try {
		const instResp = await fetch(`https://console.vast.ai/api/v0/instances/${req.params.id}/`, {
			headers: { Authorization: `Bearer ${vastApiKey}` },
		});
		const instData = await instResp.json() as any;
		if (!instResp.ok) return res.status(instResp.status).json({ error: instData?.error ?? `Vast API ${instResp.status}` });

		const raw: Record<string, any> = Array.isArray(instData.instances) ? (instData.instances[0] ?? instData) : (instData.instances ?? instData);
		const body = req.body ?? {};

		let endpoint = extractJupyterEndpoint(raw);
		if (body.baseUrl) endpoint = { baseUrl: String(body.baseUrl), token: body.token ? String(body.token) : endpoint?.token };
		if (!endpoint) return res.status(422).json({
			error: "Could not determine Jupyter URL. Provide baseUrl in request body.",
			hint: { public_ipaddr: raw.public_ipaddr, ports: raw.ports },
		});

		// Extract stored token from extra_env if not overridden
		if (!endpoint.token) {
			const envToken = (raw.extra_env as string[] | undefined)?.find((e) => e.startsWith("JUPYTER_TOKEN="))?.split("=")[1];
			if (envToken) endpoint.token = envToken;
		}
		if (body.token) endpoint.token = String(body.token);

		const providerId = `vast-${raw.id}`;
		const label = String(raw.label || `Vast ${raw.gpu_name ?? "GPU"} #${raw.id}`);
		const profile: JupyterProviderProfile = {
			id: providerId,
			kind: "jupyter",
			label,
			baseUrl: endpoint.baseUrl,
			auth: endpoint.token ? { kind: "token", token: endpoint.token } : { kind: "none" },
			defaultKernelName: undefined,
		};
		const runtime = new JupyterRuntime(profile);
		const kernelSpecs = await runtime.getKernelSpecs().catch(() => []);
		providers.set(providerId, profile);
		runtimes.set(providerId, runtime);
		await saveProviders();
		res.json({ provider: publicProvider(profile), kernelSpecs, costPerHour: raw.dph_total });
	} catch (err: any) { res.status(500).json({ error: err?.message ?? String(err) }); }
});

app.use("/api", (_req, res) => {
	res.status(404).json({ error: "Not found" });
});

await loadProviders();

const httpServer = new http.Server(app);
const terminalWss = new WebSocketServer({ noServer: true });
const channelWss = new WebSocketServer({ noServer: true });
const TERMINAL_PATH = /^\/api\/runtime\/providers\/([^/]+)\/terminals\/([^/]+)\/?$/;
const CHANNEL_PATH = /^\/api\/runtime\/providers\/([^/]+)\/sessions\/([^/]+)\/channel\/?$/;

// Live session channel: forwards every kernel IOPub message to the browser and
// relays inbound comm messages back to the kernel. Foundation for widgets
// (Feature 2) and live display/clear_output updates.
httpServer.on("upgrade", (request, socket, head) => {
	const url = new URL(request.url ?? "/", "http://127.0.0.1");
	const channelMatch = CHANNEL_PATH.exec(url.pathname);
	if (channelMatch) {
		const [, providerId, sessionId] = channelMatch;
		let runtime: JupyterRuntime;
		try {
			runtime = getRuntime(decodeURIComponent(providerId));
		} catch {
			socket.destroy();
			return;
		}
		channelWss.handleUpgrade(request, socket, head, async (clientWs) => {
			let unsubscribe: (() => void) | undefined;
			try {
				unsubscribe = await runtime.subscribeIOPub(decodeURIComponent(sessionId), (envelope) => {
					if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(envelope));
				});
			} catch (err: any) {
				if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ msgType: "channel_error", content: { error: err?.message ?? String(err) }, metadata: {} }));
				clientWs.close();
				return;
			}
			const sid = decodeURIComponent(sessionId);
			clientWs.on("message", (data: Buffer) => {
				try {
					const msg = JSON.parse(data.toString());
					const commId = msg?.commId ? String(msg.commId) : "";
					if (msg?.type === "comm_open" && msg.targetName && commId) {
						void runtime.openComm(sid, String(msg.targetName), commId, msg.data, msg.metadata, msg.buffers).catch(() => undefined);
					} else if (msg?.type === "comm_msg" && commId) {
						void runtime.sendCommMessage(sid, String(msg.targetName ?? "jupyter.widget"), commId, msg.data, msg.buffers).catch(() => undefined);
					} else if (msg?.type === "comm_close" && commId) {
						void runtime.closeComm(sid, commId).catch(() => undefined);
					} else if (msg?.type === "comm_info") {
						void runtime.commInfo(sid, msg.targetName ? String(msg.targetName) : undefined)
							.then((comms) => { if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify({ msgType: "comm_info_reply", content: { comms }, metadata: {}, parentMsgId: msg.requestId })); })
							.catch(() => undefined);
					}
				} catch { /* ignore malformed frames */ }
			});
			clientWs.on("close", () => unsubscribe?.());
			clientWs.on("error", () => unsubscribe?.());
		});
		return;
	}
	const match = TERMINAL_PATH.exec(url.pathname);
	if (!match) {
		socket.destroy();
		return;
	}
	const [, providerId, terminalName] = match;
	let runtime: JupyterRuntime;
	try {
		runtime = getRuntime(decodeURIComponent(providerId));
	} catch {
		socket.destroy();
		return;
	}
	terminalWss.handleUpgrade(request, socket, head, (clientWs) => {
		const upstreamUrl = runtime.terminalChannelsUrl(decodeURIComponent(terminalName));
		const upstream = new WebSocket(upstreamUrl);
		const pending: Array<string | Buffer> = [];

		upstream.on("open", () => {
			for (const frame of pending) upstream.send(frame);
			pending.length = 0;
		});
		upstream.on("message", (data: Buffer, isBinary: boolean) => {
			if (clientWs.readyState === WebSocket.OPEN) clientWs.send(isBinary ? data : data.toString());
		});
		upstream.on("close", () => clientWs.close());
		upstream.on("error", () => clientWs.close());

		clientWs.on("message", (data: Buffer, isBinary: boolean) => {
			const frame = isBinary ? data : data.toString();
			if (upstream.readyState === WebSocket.OPEN) upstream.send(frame);
			else pending.push(frame);
		});
		clientWs.on("close", () => { if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close(); });
		clientWs.on("error", () => upstream.close());
	});
});

httpServer.listen(port, "127.0.0.1", () => {
	console.log(`Scryer Io API listening on http://127.0.0.1:${port}`);
});
