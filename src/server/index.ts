import express from "express";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { JupyterRuntime } from "../jupyter-runtime.js";
import type { CellOutput, JupyterProviderProfile, RuntimeSession } from "../types.js";

const DEFAULT_API_PORT = 54322;
const port = Number(process.env.SCRYER_IO_API_PORT ?? DEFAULT_API_PORT);
const PROVIDERS_PATH = join(process.cwd(), "data", "providers.json");

const app = express();
const providers = new Map<string, JupyterProviderProfile>();
const runtimes = new Map<string, JupyterRuntime>();
let activeSession: RuntimeSession | undefined;

app.use(express.json({ limit: "2mb" }));

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

async function loadProviders() {
	try {
		const raw = JSON.parse(await readFile(PROVIDERS_PATH, "utf8")) as { providers?: JupyterProviderProfile[] };
		for (const profile of raw.providers ?? []) {
			providers.set(profile.id, profile);
			runtimes.set(profile.id, new JupyterRuntime(profile));
		}
	} catch {
		// First run: no provider file yet.
	}
}

async function saveProviders() {
	await mkdir(dirname(PROVIDERS_PATH), { recursive: true });
	await writeFile(PROVIDERS_PATH, JSON.stringify({ providers: [...providers.values()] }, null, 2));
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

app.get("/api/runtime/providers/:providerId/kernelspecs", async (req, res) => {
	try {
		res.json({ kernelSpecs: await getRuntime(req.params.providerId).getKernelSpecs() });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.get("/api/runtime/providers/:providerId/sessions", async (req, res) => {
	try {
		res.json({ sessions: await getRuntime(req.params.providerId).listSessions() });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
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

app.post("/api/runtime/providers/:providerId/execute", async (req, res) => {
	try {
		const body = req.body ?? {};
		const code = String(body.code ?? "");
		if (!code.trim()) return res.status(400).json({ error: "code is required" });
		const runtime = getRuntime(req.params.providerId);
		const result = await runtime.execute({
			code,
			sessionId: body.sessionId ? String(body.sessionId) : activeSession?.providerId === req.params.providerId ? activeSession.id : undefined,
			path: body.path ? String(body.path) : "scryer-io.ipynb",
			kernelName: body.kernelName ? String(body.kernelName) : undefined,
		});
		activeSession = result.session;
		res.json({ ...result, text: outputText(result.outputs) });
	} catch (err: any) {
		res.status(500).json({ error: err?.message ?? String(err) });
	}
});

app.use("/api", (_req, res) => {
	res.status(404).json({ error: "Not found" });
});

await loadProviders();

app.listen(port, "127.0.0.1", () => {
	console.log(`Scryer Io API listening on http://127.0.0.1:${port}`);
});
