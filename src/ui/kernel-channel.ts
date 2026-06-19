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
	buffers?: number;
};

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

	/** Relay a comm message (widget interaction) back to the kernel. */
	sendComm(targetName: string, commId: string, data: unknown): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify({ type: "comm_msg", targetName, commId, data }));
		}
	}

	close() {
		this.closed = true;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.handlers.clear();
		this.ws?.close();
		this.ws = null;
	}
}
