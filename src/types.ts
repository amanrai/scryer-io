export type KernelProviderKind = "jupyter";

export type JupyterAuth =
	| { kind: "none" }
	| { kind: "token"; token: string };

export type JupyterProviderProfile = {
	id: string;
	kind: "jupyter";
	label: string;
	baseUrl: string;
	auth: JupyterAuth;
	defaultKernelName?: string;
	notes?: string;
};

export type KernelProviderProfile = JupyterProviderProfile;

export type KernelSpecSummary = {
	name: string;
	displayName: string;
	language?: string;
	isDefault: boolean;
};

export type RuntimeSession = {
	id: string;
	path: string;
	name: string;
	type: string;
	kernelId?: string;
	kernelName?: string;
	providerId: string;
};

export type StartSessionRequest = {
	path: string;
	name?: string;
	type?: "notebook" | "console" | "file" | string;
	kernelName?: string;
};

export type ExecuteRequest = {
	code: string;
	sessionId?: string;
	path?: string;
	kernelName?: string;
	silent?: boolean;
	storeHistory?: boolean;
};

export type CellOutput =
	| { kind: "stream"; name: "stdout" | "stderr"; text: string }
	| { kind: "execute_result" | "display_data"; data: Record<string, unknown>; metadata?: Record<string, unknown> }
	| { kind: "error"; ename: string; evalue: string; traceback: string[] }
	| { kind: "status"; executionState: string }
	| { kind: "unknown"; messageType: string; content: unknown };

export type ExecuteResult = {
	providerId: string;
	session: RuntimeSession;
	executionCount?: number | null;
	outputs: CellOutput[];
	ok: boolean;
};

export interface KernelRuntime {
	readonly profile: KernelProviderProfile;
	getKernelSpecs(): Promise<KernelSpecSummary[]>;
	listSessions(): Promise<RuntimeSession[]>;
	startSession(request: StartSessionRequest): Promise<RuntimeSession>;
	connectSession(sessionId: string): Promise<RuntimeSession>;
	execute(request: ExecuteRequest): Promise<ExecuteResult>;
	interrupt(sessionId: string): Promise<void>;
	restart(sessionId: string): Promise<void>;
	shutdown(sessionId: string): Promise<void>;
}
