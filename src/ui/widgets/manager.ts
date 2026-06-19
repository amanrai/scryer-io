// Browser-side ipywidgets manager (Feature 2).
//
// The kernel connection lives on the server; this manager rides the live
// session channel (kernel-channel.ts) for all comm traffic. It extends
// ipywidgets' ManagerBase, implementing comm creation/info against the channel
// and loading widget model/view classes from the installed @jupyter-widgets
// packages on demand.
import { ManagerBase } from "@jupyter-widgets/base-manager";
import { type DOMWidgetView, type IClassicComm, type WidgetModel, type WidgetView } from "@jupyter-widgets/base";
import { Widget } from "@lumino/widgets";
import { KernelChannel, decodeBuffers, encodeBuffer, type IOPubEnvelope } from "../kernel-channel.js";

const WIDGET_TARGET = "jupyter.widget";

type CommCallback = (msg: any) => void;

function encodeBuffers(buffers?: ArrayBuffer[] | ArrayBufferView[]): string[] | undefined {
	if (!buffers?.length) return undefined;
	return buffers.map((b) => encodeBuffer(b));
}

/** Reconstruct a comm message shape from a forwarded IOPub envelope. */
function envToCommMsg(env: IOPubEnvelope) {
	return { content: env.content, metadata: env.metadata, buffers: decodeBuffers(env.buffers) };
}

/** An IClassicComm backed by the session WS channel rather than a direct kernel. */
class ChannelComm implements IClassicComm {
	comm_id: string;
	target_name: string;
	private channel: KernelChannel;
	private msgCb?: CommCallback;
	private closeCb?: CommCallback;

	constructor(commId: string, targetName: string, channel: KernelChannel) {
		this.comm_id = commId;
		this.target_name = targetName;
		this.channel = channel;
	}

	open(data: any, _callbacks?: any, metadata?: any, buffers?: ArrayBuffer[] | ArrayBufferView[]): string {
		this.channel.openComm(this.target_name, this.comm_id, data, metadata, encodeBuffers(buffers));
		return this.comm_id;
	}
	send(data: any, _callbacks?: any, _metadata?: any, buffers?: ArrayBuffer[] | ArrayBufferView[]): string {
		this.channel.sendComm(this.target_name, this.comm_id, data, encodeBuffers(buffers));
		return this.comm_id;
	}
	close(): string {
		this.channel.closeComm(this.comm_id);
		return this.comm_id;
	}
	on_msg(callback: CommCallback): void { this.msgCb = callback; }
	on_close(callback: CommCallback): void { this.closeCb = callback; }

	handleMsg(env: IOPubEnvelope): void { this.msgCb?.(envToCommMsg(env)); }
	handleClose(env: IOPubEnvelope): void { this.closeCb?.(envToCommMsg(env)); }
}

export class WidgetManager extends ManagerBase {
	private readonly comms = new Map<string, ChannelComm>();
	private readonly unsubscribe: () => void;

	constructor(private readonly channel: KernelChannel) {
		super();
		this.unsubscribe = channel.subscribe((env) => this.route(env));
	}

	private route(env: IOPubEnvelope): void {
		const commId = (env.content as { comm_id?: string } | undefined)?.comm_id;
		if (!commId) return;
		if (env.msgType === "comm_open" && (env.content as { target_name?: string }).target_name === WIDGET_TARGET) {
			const comm = new ChannelComm(commId, WIDGET_TARGET, this.channel);
			this.comms.set(commId, comm);
			void this.handle_comm_open(comm, envToCommMsg(env) as any).catch((err) => console.error("widget comm_open failed", err));
		} else if (env.msgType === "comm_msg") {
			this.comms.get(commId)?.handleMsg(env);
		} else if (env.msgType === "comm_close") {
			this.comms.get(commId)?.handleClose(env);
			this.comms.delete(commId);
		}
	}

	protected async loadClass(className: string, moduleName: string, _moduleVersion: string): Promise<typeof WidgetModel | typeof WidgetView> {
		let mod: Record<string, unknown>;
		if (moduleName === "@jupyter-widgets/base") mod = await import("@jupyter-widgets/base");
		else if (moduleName === "@jupyter-widgets/controls") mod = await import("@jupyter-widgets/controls");
		else if (moduleName === "@jupyter-widgets/output") mod = await import("@jupyter-widgets/output");
		else throw new Error(`Unsupported widget module: ${moduleName}`);
		const cls = mod[className];
		if (!cls) throw new Error(`Class ${className} not found in ${moduleName}`);
		return cls as typeof WidgetModel | typeof WidgetView;
	}

	protected async _create_comm(targetName: string, modelId?: string, data?: any, metadata?: any, buffers?: ArrayBuffer[] | ArrayBufferView[]): Promise<IClassicComm> {
		const commId = modelId ?? crypto.randomUUID();
		const comm = new ChannelComm(commId, targetName, this.channel);
		this.comms.set(commId, comm);
		if (data !== undefined) comm.open(data, undefined, metadata, buffers);
		return comm;
	}

	protected async _get_comm_info(): Promise<Record<string, unknown>> {
		return this.channel.requestCommInfo(WIDGET_TARGET);
	}

	/** Resolve a model_id and attach its view into the host node. */
	async renderView(modelId: string, host: HTMLElement): Promise<() => void> {
		const model = await this.get_model(modelId);
		if (!model) { host.textContent = "[widget model unavailable]"; return () => undefined; }
		const view = (await this.create_view(model)) as DOMWidgetView;
		Widget.attach(view.luminoWidget, host);
		return () => { try { view.luminoWidget.dispose(); } catch { /* already gone */ } };
	}

	dispose(): void {
		this.unsubscribe();
		this.comms.clear();
	}
}
