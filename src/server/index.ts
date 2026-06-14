import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { JupyterRuntime } from "../jupyter-runtime.js";
import type { CellOutput, JupyterProviderProfile, RuntimeSession } from "../types.js";

const DEFAULT_API_PORT = 54322;
const port = Number(process.env.SCRYER_IO_API_PORT ?? DEFAULT_API_PORT);
const DATA_DIR = join(process.cwd(), "data");
const PROVIDERS_PATH = join(DATA_DIR, "providers.json");
const NOTEBOOK_PATH = join(DATA_DIR, "notebook.ipynb");

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

app.use("/api", (_req, res) => {
	res.status(404).json({ error: "Not found" });
});

await loadProviders();

app.listen(port, "127.0.0.1", () => {
	console.log(`Scryer Io API listening on http://127.0.0.1:${port}`);
});
