import {
	KernelManager,
	KernelMessage,
	KernelSpecAPI,
	ServerConnection,
	SessionManager,
	type Session,
} from "@jupyterlab/services";
import type {
	CellOutput,
	CompleteResult,
	ExecuteRequest,
	ExecuteResult,
	InspectResult,
	JupyterProviderProfile,
	KernelSpecSummary,
	RuntimeSession,
	StartSessionRequest,
} from "./types.js";

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function wsUrlFromBaseUrl(baseUrl: string): string {
	const url = new URL(normalizeBaseUrl(baseUrl));
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
}

function makeSettings(profile: JupyterProviderProfile): ServerConnection.ISettings {
	const token = profile.auth.kind === "token" ? profile.auth.token : "";
	return ServerConnection.makeSettings({
		baseUrl: normalizeBaseUrl(profile.baseUrl),
		wsUrl: wsUrlFromBaseUrl(profile.baseUrl),
		token,
		appendToken: Boolean(token),
	});
}

function toRuntimeSession(providerId: string, model: Session.IModel): RuntimeSession {
	return {
		id: model.id,
		path: model.path,
		name: model.name,
		type: model.type,
		kernelId: model.kernel?.id,
		kernelName: model.kernel?.name,
		providerId,
	};
}

function outputFromMessage(msg: KernelMessage.IIOPubMessage): CellOutput | undefined {
	if (KernelMessage.isStreamMsg(msg)) {
		return { kind: "stream", name: msg.content.name, text: msg.content.text };
	}
	if (KernelMessage.isExecuteResultMsg(msg)) {
		return {
			kind: "execute_result",
			data: msg.content.data as Record<string, unknown>,
			metadata: msg.content.metadata as Record<string, unknown>,
		};
	}
	if (KernelMessage.isDisplayDataMsg(msg)) {
		return {
			kind: "display_data",
			data: msg.content.data as Record<string, unknown>,
			metadata: msg.content.metadata as Record<string, unknown>,
			displayId: (msg.content.transient as { display_id?: string } | undefined)?.display_id,
		};
	}
	if (KernelMessage.isErrorMsg(msg)) {
		return {
			kind: "error",
			ename: msg.content.ename,
			evalue: msg.content.evalue,
			traceback: msg.content.traceback,
		};
	}
	if (KernelMessage.isStatusMsg(msg)) {
		return { kind: "status", executionState: msg.content.execution_state };
	}
	if (msg.header.msg_type === "update_display_data") {
		const content = msg.content as KernelMessage.IUpdateDisplayDataMsg["content"];
		return {
			kind: "update_display_data",
			data: content.data as Record<string, unknown>,
			metadata: content.metadata as Record<string, unknown>,
			displayId: (content.transient as { display_id?: string } | undefined)?.display_id,
		};
	}
	if (msg.header.msg_type === "clear_output") {
		const content = msg.content as KernelMessage.IClearOutputMsg["content"];
		return { kind: "clear_output", wait: Boolean(content.wait) };
	}
	if (msg.header.msg_type === "execute_input") {
		return undefined;
	}
	// comm_open / comm_msg / comm_close are intentionally not turned into cell
	// outputs; they flow over the live session channel to the widget manager.
	if (msg.header.msg_type.startsWith("comm_")) {
		return undefined;
	}
	return { kind: "unknown", messageType: msg.header.msg_type, content: msg.content };
}

/** A raw IOPub message forwarded over the live session channel. */
export type IOPubEnvelope = {
	msgType: string;
	content: unknown;
	metadata: Record<string, unknown>;
	parentMsgId?: string;
	parentMsgType?: string;
	buffers?: number;
};

function toEnvelope(msg: KernelMessage.IIOPubMessage): IOPubEnvelope {
	return {
		msgType: msg.header.msg_type,
		content: msg.content,
		metadata: (msg.metadata ?? {}) as Record<string, unknown>,
		parentMsgId: msg.parent_header && "msg_id" in msg.parent_header ? msg.parent_header.msg_id : undefined,
		parentMsgType: msg.parent_header && "msg_type" in msg.parent_header ? msg.parent_header.msg_type : undefined,
		buffers: msg.buffers?.length ?? 0,
	};
}

export class JupyterRuntime {
	readonly profile: JupyterProviderProfile;
	private readonly settings: ServerConnection.ISettings;
	private readonly kernelManager: KernelManager;
	private readonly sessionManager: SessionManager;
	private readonly sessions = new Map<string, Session.ISessionConnection>();

	constructor(profile: JupyterProviderProfile) {
		this.profile = profile;
		this.settings = makeSettings(profile);
		this.kernelManager = new KernelManager({ serverSettings: this.settings });
		this.sessionManager = new SessionManager({ kernelManager: this.kernelManager, serverSettings: this.settings });
	}

	async getKernelSpecs(): Promise<KernelSpecSummary[]> {
		const specs = await KernelSpecAPI.getSpecs(this.settings);
		return Object.entries(specs.kernelspecs).flatMap(([name, spec]) => {
			if (!spec) return [];
			return [{
				name,
				displayName: spec.display_name,
				language: spec.language,
				isDefault: name === specs.default,
			}];
		});
	}

	async listSessions(): Promise<RuntimeSession[]> {
		const models = [...this.sessionManager.running()];
		return models.map((model) => toRuntimeSession(this.profile.id, model));
	}

	async startSession(request: StartSessionRequest): Promise<RuntimeSession> {
		const kernelName = request.kernelName ?? this.profile.defaultKernelName ?? "python3";
		const session = await this.sessionManager.startNew({
			path: request.path,
			name: request.name ?? request.path,
			type: request.type ?? "notebook",
			kernel: { name: kernelName },
		});
		this.sessions.set(session.id, session);
		return toRuntimeSession(this.profile.id, session.model);
	}

	async connectSession(sessionId: string): Promise<RuntimeSession> {
		const existing = this.sessions.get(sessionId);
		if (existing) return toRuntimeSession(this.profile.id, existing.model);
		const session = this.sessionManager.connectTo({ model: { id: sessionId } as Session.IModel });
		this.sessions.set(session.id, session);
		return toRuntimeSession(this.profile.id, session.model);
	}

	async execute(request: ExecuteRequest, onOutput?: (output: CellOutput) => void): Promise<ExecuteResult> {
		const session = request.sessionId
			? await this.getSessionConnection(request.sessionId)
			: await this.startAndGetSession(request);
		if (!session.kernel) throw new Error(`Session ${session.id} has no active kernel`);

		const outputs: CellOutput[] = [];
		let executionCount: number | null | undefined;
		let ok = true;

		const pushOutput = (output: CellOutput) => {
			outputs.push(output);
			onOutput?.(output);
			if (output.kind === "error") ok = false;
		};

		const future = session.kernel.requestExecute({
			code: request.code,
			silent: request.silent ?? false,
			store_history: request.storeHistory ?? true,
		});

		future.onIOPub = (msg) => {
			const output = outputFromMessage(msg);
			if (output) pushOutput(output);
		};

		const reply = await future.done;
		if (KernelMessage.isExecuteReplyMsg(reply)) {
			executionCount = reply.content.execution_count;
			ok = ok && reply.content.status === "ok";
			if (reply.content.status === "error") {
				pushOutput({
					kind: "error",
					ename: reply.content.ename,
					evalue: reply.content.evalue,
					traceback: reply.content.traceback,
				});
			}
		}

		return {
			providerId: this.profile.id,
			session: toRuntimeSession(this.profile.id, session.model),
			executionCount,
			outputs,
			ok,
		};
	}

	private authHeaders(): Record<string, string> {
		const token = this.profile.auth.kind === "token" ? this.profile.auth.token : "";
		return token ? { Authorization: `token ${token}` } : {};
	}

	get authToken(): string {
		return this.profile.auth.kind === "token" ? this.profile.auth.token : "";
	}

	async createTerminal(): Promise<{ name: string }> {
		const res = await fetch(`${this.settings.baseUrl}api/terminals`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...this.authHeaders() },
		});
		if (!res.ok) throw new Error(`Failed to create terminal (${res.status})`);
		const json = (await res.json()) as { name: string };
		return { name: json.name };
	}

	terminalChannelsUrl(name: string): string {
		const wsBase = this.settings.wsUrl.endsWith("/") ? this.settings.wsUrl : `${this.settings.wsUrl}/`;
		const url = new URL(`terminals/websocket/${name}`, wsBase);
		const token = this.authToken;
		if (token) url.searchParams.set("token", token);
		return url.toString();
	}

	async getKernelStatus(sessionId?: string): Promise<{ status: string; kernelId?: string }> {
		if (!sessionId) return { status: "unknown" };
		try {
			const session = await this.getSessionConnection(sessionId);
			const kernel = session.kernel;
			if (!kernel) return { status: "dead" };
			return { status: kernel.status, kernelId: kernel.id };
		} catch {
			return { status: "unknown" };
		}
	}

	async interrupt(sessionId: string): Promise<void> {
		const session = await this.getSessionConnection(sessionId);
		if (!session.kernel) throw new Error(`Session ${sessionId} has no active kernel`);
		await session.kernel.interrupt();
	}

	async restart(sessionId: string): Promise<void> {
		const session = await this.getSessionConnection(sessionId);
		if (!session.kernel) throw new Error(`Session ${sessionId} has no active kernel`);
		await session.kernel.restart();
	}

	async shutdown(sessionId: string): Promise<void> {
		const session = await this.getSessionConnection(sessionId);
		await session.shutdown();
		this.sessions.delete(sessionId);
	}

	/** Tab-completion request against the live kernel (Feature 1). */
	async requestComplete(sessionId: string, code: string, cursorPos: number): Promise<CompleteResult> {
		const session = await this.getSessionConnection(sessionId);
		if (!session.kernel) throw new Error(`Session ${sessionId} has no active kernel`);
		const reply = await session.kernel.requestComplete({ code, cursor_pos: cursorPos });
		const content = reply.content;
		if (content.status !== "ok") return { matches: [], cursorStart: cursorPos, cursorEnd: cursorPos };
		return {
			matches: content.matches ?? [],
			cursorStart: content.cursor_start,
			cursorEnd: content.cursor_end,
			metadata: content.metadata as Record<string, unknown> | undefined,
		};
	}

	/** Introspection (Shift+Tab signature/docstring) against the live kernel (Feature 1). */
	async requestInspect(sessionId: string, code: string, cursorPos: number, detailLevel: 0 | 1 = 0): Promise<InspectResult> {
		const session = await this.getSessionConnection(sessionId);
		if (!session.kernel) throw new Error(`Session ${sessionId} has no active kernel`);
		const reply = await session.kernel.requestInspect({ code, cursor_pos: cursorPos, detail_level: detailLevel });
		const content = reply.content;
		if (content.status !== "ok" || !content.found) return { found: false, data: {} };
		return { found: true, data: content.data as Record<string, unknown> };
	}

	/**
	 * Subscribe to every IOPub message for a session and forward it raw. Used by
	 * the live session channel so the browser-side widget manager and renderers
	 * see comm/display traffic that the one-shot execute path does not persist.
	 * Returns an unsubscribe function.
	 */
	async subscribeIOPub(sessionId: string, onMessage: (envelope: IOPubEnvelope) => void): Promise<() => void> {
		const session = await this.getSessionConnection(sessionId);
		const handler = (_: unknown, msg: KernelMessage.IIOPubMessage) => onMessage(toEnvelope(msg));
		const connect = (kernel: Session.ISessionConnection["kernel"]) => kernel?.iopubMessage.connect(handler);
		const disconnect = (kernel: Session.ISessionConnection["kernel"]) => kernel?.iopubMessage.disconnect(handler);
		connect(session.kernel);
		// Re-attach across restarts (the kernel connection is swapped on restart).
		type KernelChanged = { oldValue: Session.ISessionConnection["kernel"]; newValue: Session.ISessionConnection["kernel"] };
		const onKernelChanged = (_: unknown, args: KernelChanged) => {
			disconnect(args.oldValue);
			connect(args.newValue);
		};
		session.kernelChanged.connect(onKernelChanged);
		return () => {
			disconnect(session.kernel);
			session.kernelChanged.disconnect(onKernelChanged);
		};
	}

	/** Relay a comm message from the browser widget manager to the kernel. */
	async sendCommMessage(sessionId: string, targetName: string, commId: string, data: unknown): Promise<void> {
		const session = await this.getSessionConnection(sessionId);
		if (!session.kernel) throw new Error(`Session ${sessionId} has no active kernel`);
		const comm = session.kernel.createComm(targetName, commId);
		comm.send(data as Parameters<typeof comm.send>[0]);
	}

	private async getSessionConnection(sessionId: string): Promise<Session.ISessionConnection> {
		const existing = this.sessions.get(sessionId);
		if (existing) return existing;
		await this.connectSession(sessionId);
		const session = this.sessions.get(sessionId);
		if (!session) throw new Error(`Unable to connect session ${sessionId}`);
		return session;
	}

	private async startAndGetSession(request: ExecuteRequest): Promise<Session.ISessionConnection> {
		const path = request.path ?? `scryer-io-${Date.now()}.ipynb`;
		const runtimeSession = await this.startSession({ path, kernelName: request.kernelName });
		return this.getSessionConnection(runtimeSession.id);
	}
}
