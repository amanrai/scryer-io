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
	ExecuteRequest,
	ExecuteResult,
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
	if (msg.header.msg_type === "execute_input") {
		return undefined;
	}
	return { kind: "unknown", messageType: msg.header.msg_type, content: msg.content };
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
