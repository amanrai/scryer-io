// Live session channel transport (Phase 0 plumbing).
//
// Opens a WebSocket to the server-side proxy that forwards every kernel IOPub
// message and relays comm messages back. Consumers (the widget manager in
// Feature 2, live-display renderers) subscribe by parent message id and/or
// comm id. The one-shot HTTP execute/stream path is unaffected; this channel
// carries the bidirectional traffic that path cannot.

export type IOPubEnvelope = {
	msgType: string;
	content: any;
	metadata: Record<string, unknown>;
	parentMsgId?: string;
	parentMsgType?: string;
	/** Binary comm buffers, base64-encoded over the JSON channel. */
	buffers?: string[];
};

export function decodeBuffers(buffers?: string[]): ArrayBuffer[] {
	if (!buffers?.length) return [];
	return buffers.map((b64) => {
		const binary = atob(b64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes.buffer;
	});
}

export function encodeBuffer(buffer: ArrayBuffer | ArrayBufferView): string {
	const bytes = ArrayBuffer.isView(buffer)
		? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
		: new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

type MessageHandler = (envelope: IOPubEnvelope) => void;

function channelUrl(providerId: string, sessionId: string): string {
	const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
	const base = `${proto}//${window.location.host}`;
	return `${base}/api/runtime/providers/${encodeURIComponent(providerId)}/sessions/${encodeURIComponent(sessionId)}/channel`;
}

export class KernelChannel {
	private ws: WebSocket | null = null;
	private readonly handlers = new Set<MessageHandler>();
	private closed = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly providerId: string, private readonly sessionId: string) {
		this.connect();
	}

	private connect() {
		if (this.closed) return;
		const ws = new WebSocket(channelUrl(this.providerId, this.sessionId));
		this.ws = ws;
		ws.onmessage = (event) => {
			let envelope: IOPubEnvelope;
			try { envelope = JSON.parse(event.data); } catch { return; }
			for (const handler of this.handlers) handler(envelope);
		};
		ws.onclose = () => {
			if (this.closed) return;
			// Best-effort reconnect; the kernel session usually outlives a blip.
			this.reconnectTimer = setTimeout(() => this.connect(), 1500);
		};
		ws.onerror = () => ws.close();
	}

	/** Subscribe to every forwarded IOPub message. Returns an unsubscribe fn. */
	subscribe(handler: MessageHandler): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	private send(payload: Record<string, unknown>): void {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
	}

	/** Relay a comm message (widget interaction) back to the kernel. */
	sendComm(targetName: string, commId: string, data: unknown, buffers?: string[]): void {
		this.send({ type: "comm_msg", targetName, commId, data, buffers });
	}

	/** Open a comm to the kernel (widget manager → kernel). */
	openComm(targetName: string, commId: string, data: unknown, metadata?: Record<string, unknown>, buffers?: string[]): void {
		this.send({ type: "comm_open", targetName, commId, data, metadata, buffers });
	}

	/** Close a comm. */
	closeComm(commId: string): void {
		this.send({ type: "comm_close", commId });
	}

	/** Request the list of open comms; resolves with the comm_info_reply. */
	requestCommInfo(targetName?: string): Promise<Record<string, { target_name: string }>> {
		const requestId = `comminfo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		return new Promise((resolve) => {
			const timer = setTimeout(() => { off(); resolve({}); }, 5000);
			const off = this.subscribe((envelope) => {
				if (envelope.msgType === "comm_info_reply" && envelope.parentMsgId === requestId) {
					clearTimeout(timer);
					off();
					resolve((envelope.content?.comms ?? {}) as Record<string, { target_name: string }>);
				}
			});
			this.send({ type: "comm_info", targetName, requestId });
		});
	}

	close() {
		this.closed = true;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.handlers.clear();
		this.ws?.close();
		this.ws = null;
	}
}
