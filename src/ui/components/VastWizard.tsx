import { useEffect, useRef, useState, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faChevronLeft,
	faCircleNotch,
	faRotateRight,
	faServer,
	faTriangleExclamation,
	faXmark,
} from "@fortawesome/free-solid-svg-icons";

type VastInstance = {
	id: number;
	label?: string;
	actual_status?: string;
	status_msg?: string;
	gpu_name?: string;
	num_gpus?: number;
	gpu_ram?: number;
	dph_total?: number;
	public_ipaddr?: string;
	ports?: Record<string, Array<{ HostIp: string; HostPort: string }>>;
	extra_env?: string[];
	jupyter_url?: string;
	geolocation?: string;
	disk_space?: number;
	machine_id?: number;
};

type VastOffer = {
	id: number;
	gpu_name?: string;
	num_gpus?: number;
	gpu_ram?: number;
	dph_total?: number;
	dlperf?: number;
	dlperf_per_dphtotal?: number;
	cpu_cores?: number;
	cpu_ram?: number;
	disk_space?: number;
	geolocation?: string;
	reliability2?: number;
	latencyMs?: number | null;
	cuda_max_good?: number;
};

type OfferSort = "price" | "mlperf" | "value" | "latency";

type Step = "loading" | "instances" | "offers" | "confirm-connect" | "confirm-start" | "starting" | "connecting";

type Props = {
	onClose(): void;
	onConnected(providerId: string, label: string, costPerHour?: number): void;
};

function fmtCost(dph: number | undefined): string {
	if (dph == null) return "—";
	return `$${dph.toFixed(3)}/hr`;
}

function fmtGpu(gpu_name?: string, num_gpus?: number): string {
	const n = num_gpus ?? 1;
	const g = gpu_name ?? "GPU";
	return n > 1 ? `${n}× ${g}` : g;
}

function fmtRam(mb?: number): string {
	if (!mb) return "";
	return mb >= 1024 ? `${(mb / 1024).toFixed(0)} GB` : `${mb} MB`;
}

function StatusDot({ status }: { status?: string }) {
	const color = status === "running" ? "var(--accent-green)" : status === "loading" ? "var(--accent-orange, #e07b39)" : "var(--text-dim)";
	return <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0, marginRight: 6 }} />;
}

function guessJupyterUrl(inst: VastInstance): string {
	if (inst.jupyter_url) return inst.jupyter_url;
	const ip = inst.public_ipaddr;
	if (!ip) return "";
	const ports = inst.ports ?? {};
	for (const key of ["8080/tcp", "8888/tcp", "8081/tcp"]) {
		const m = ports[key];
		if (m?.[0]?.HostPort) return `http://${ip}:${m[0].HostPort}/`;
	}
	return "";
}

function guessToken(inst: VastInstance): string {
	return inst.extra_env?.find((e) => e.startsWith("JUPYTER_TOKEN="))?.split("=")[1] ?? "";
}

export function VastWizard({ onClose, onConnected }: Props) {
	const [step, setStep] = useState<Step>("loading");
	const [instances, setInstances] = useState<VastInstance[]>([]);
	const [offers, setOffers] = useState<VastOffer[]>([]);
	const [offerSort, setOfferSort] = useState<OfferSort>("price");
	const [offerFilter, setOfferFilter] = useState("");
	const [error, setError] = useState("");
	const [selectedInstance, setSelectedInstance] = useState<VastInstance | null>(null);
	const [selectedOffer, setSelectedOffer] = useState<VastOffer | null>(null);
	const [manualUrl, setManualUrl] = useState("");
	const [manualToken, setManualToken] = useState("");
	const [statusMsg, setStatusMsg] = useState("");
	const [newInstanceToken, setNewInstanceToken] = useState("");
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		loadInstances();
		return () => { if (pollRef.current) clearInterval(pollRef.current); };
	}, []);

	async function loadInstances() {
		setStep("loading");
		setError("");
		try {
			const resp = await fetch("/api/vast/instances");
			const data = await resp.json();
			if (!resp.ok) throw new Error(data.error ?? `Error ${resp.status}`);
			setInstances(data.instances ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setStep("instances");
		}
	}

	const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const loadOffers = useCallback(async (filter = "") => {
		setStep("loading");
		setError("");
		try {
			const url = filter ? `/api/vast/offers?filter=${encodeURIComponent(filter)}` : "/api/vast/offers";
			const resp = await fetch(url);
			const data = await resp.json();
			if (!resp.ok) throw new Error(data.error ?? `Error ${resp.status}`);
			setOffers(data.offers ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setStep("offers");
		}
	}, []);

	function handleFilterChange(value: string) {
		setOfferFilter(value);
		if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
		filterDebounceRef.current = setTimeout(() => loadOffers(value), 400);
	}

	function pickInstance(inst: VastInstance) {
		setSelectedInstance(inst);
		setManualUrl(guessJupyterUrl(inst));
		setManualToken(guessToken(inst));
		setError("");
		setStep("confirm-connect");
	}

	async function doConnect() {
		if (!selectedInstance) return;
		setStep("connecting");
		setError("");
		try {
			const resp = await fetch(`/api/vast/connect/${selectedInstance.id}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ baseUrl: manualUrl || undefined, token: manualToken || undefined }),
			});
			const data = await resp.json();
			if (!resp.ok) throw new Error(data.error ?? `Error ${resp.status}`);
			onConnected(data.provider.id, data.provider.label, data.costPerHour);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStep("confirm-connect");
		}
	}

	function pickOffer(offer: VastOffer) {
		setSelectedOffer(offer);
		setError("");
		setStep("confirm-start");
	}

	async function doStart() {
		if (!selectedOffer) return;
		setStep("starting");
		setStatusMsg("Creating instance on Vast.ai…");
		setError("");
		try {
			const resp = await fetch("/api/vast/instances", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ offerId: selectedOffer.id }),
			});
			const data = await resp.json();
			if (!resp.ok) throw new Error(data.error ?? `Error ${resp.status}`);
			const newId: number = data.new_contract;
			const tok: string = data.jupyterToken ?? "";
			setNewInstanceToken(tok);
			setStatusMsg("Instance created — waiting for Jupyter to start (2–5 min)…");
			let attempts = 0;
			pollRef.current = setInterval(async () => {
				attempts++;
				if (attempts > 72) {
					clearInterval(pollRef.current!);
					pollRef.current = null;
					setError("Timed out after 6 minutes. Check vast.ai dashboard and connect manually.");
					setStep("instances");
					return;
				}
				try {
					const r = await fetch(`/api/vast/instances/${newId}`);
					const d = await r.json();
					const inst: VastInstance = Array.isArray(d.instances) ? d.instances[0] : (d.instances ?? d);
					if (inst.actual_status === "running") {
						clearInterval(pollRef.current!);
						pollRef.current = null;
						if (tok) inst.extra_env = [...(inst.extra_env ?? []), `JUPYTER_TOKEN=${tok}`];
						setInstances((prev) => [...prev.filter((i) => i.id !== inst.id), inst]);
						pickInstance(inst);
					} else {
						setStatusMsg(`Instance ${inst.actual_status ?? "loading"} — ${Math.round(attempts * 5)}s elapsed…`);
					}
				} catch { /* keep polling */ }
			}, 5000);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setStep("confirm-start");
		}
	}

	const runningInstances = instances.filter((i) => i.actual_status === "running");
	const otherInstances = instances.filter((i) => i.actual_status !== "running");

	return (
		<div className="settings-backdrop" role="presentation" onClick={onClose}>
			<section className="settings-modal vast-wizard" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<header className="settings-header">
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						{(step === "confirm-connect" || step === "confirm-start") && (
							<button className="ghost-button icon-button" onClick={() => setStep(step === "confirm-connect" ? "instances" : "offers")} title="Back">
								<FontAwesomeIcon icon={faChevronLeft} />
							</button>
						)}
						{step === "offers" && (
							<button className="ghost-button icon-button" onClick={() => setStep("instances")} title="Back">
								<FontAwesomeIcon icon={faChevronLeft} />
							</button>
						)}
						<div>
							<div className="eyebrow">Paid provider</div>
							<h2 id="vast-wizard-title" style={{ margin: 0 }}>
								{step === "loading" ? "Loading…" : step === "instances" ? "Vast.ai" : step === "offers" ? "Choose GPU" : step === "confirm-connect" ? "Connect instance" : step === "confirm-start" ? "Start instance" : step === "starting" ? "Starting…" : "Connecting…"}
							</h2>
						</div>
					</div>
					<button className="ghost-button icon-button" onClick={onClose} title="Close"><FontAwesomeIcon icon={faXmark} /></button>
				</header>

				<div className="settings-body" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
					{/* ── LOADING ── */}
					{step === "loading" && (
						<div className="wizard-center"><FontAwesomeIcon icon={faCircleNotch} spin style={{ fontSize: 24, color: "var(--text-dim)" }} /></div>
					)}

					{/* ── INSTANCES ── */}
					{step === "instances" && (
						<>
							{error && <div className="wizard-error"><FontAwesomeIcon icon={faTriangleExclamation} /> {error}</div>}
							<div className="wizard-section-label">
								Running instances
								<button className="ghost-button icon-button" style={{ marginLeft: "auto" }} onClick={loadInstances} title="Refresh"><FontAwesomeIcon icon={faRotateRight} /></button>
							</div>
							{runningInstances.length === 0 && !error && (
								<div className="wizard-empty">No running instances on this account.</div>
							)}
							<div className="wizard-list">
								{runningInstances.map((inst) => (
									<div key={inst.id} className="wizard-row">
										<StatusDot status={inst.actual_status} />
										<div className="wizard-row-info">
											<span className="wizard-row-name">{inst.label || `#${inst.id}`}</span>
											<span className="wizard-row-sub">{fmtGpu(inst.gpu_name, inst.num_gpus)} · {inst.geolocation ?? ""}</span>
										</div>
										<span className="wizard-cost">{fmtCost(inst.dph_total)}</span>
										<button className="primary-button" style={{ flexShrink: 0 }} onClick={() => pickInstance(inst)}>Connect</button>
									</div>
								))}
								{otherInstances.map((inst) => (
									<div key={inst.id} className="wizard-row wizard-row--dim">
										<StatusDot status={inst.actual_status} />
										<div className="wizard-row-info">
											<span className="wizard-row-name">{inst.label || `#${inst.id}`}</span>
											<span className="wizard-row-sub">{inst.actual_status} · {fmtGpu(inst.gpu_name, inst.num_gpus)}</span>
										</div>
										<span className="wizard-cost">{fmtCost(inst.dph_total)}</span>
									</div>
								))}
							</div>
							<div className="wizard-footer">
								<button className="ghost-button" onClick={() => loadOffers()}><FontAwesomeIcon icon={faServer} /> Start new instance →</button>
							</div>
						</>
					)}

					{/* ── OFFERS ── */}
					{step === "offers" && (() => {
						const sorted = [...offers].sort((a, b) => {
							if (offerSort === "mlperf") return (b.dlperf ?? 0) - (a.dlperf ?? 0);
							if (offerSort === "value") return (b.dlperf_per_dphtotal ?? 0) - (a.dlperf_per_dphtotal ?? 0);
							if (offerSort === "latency") {
								const la = a.latencyMs ?? 9999, lb = b.latencyMs ?? 9999;
								return la - lb;
							}
							return (a.dph_total ?? 0) - (b.dph_total ?? 0);
						});
						return (
							<>
								{error && <div className="wizard-error"><FontAwesomeIcon icon={faTriangleExclamation} /> {error}</div>}
								<div className="wizard-offer-controls">
									<input
										className="wizard-filter-input"
										placeholder="Filter by GPU name…"
										value={offerFilter}
										onChange={(e) => handleFilterChange(e.target.value)}
									/>
									<div className="wizard-sort-pills">
										{(["price", "mlperf", "value", "latency"] as OfferSort[]).map((s) => (
											<button key={s} className={offerSort === s ? "wizard-sort-pill active" : "wizard-sort-pill"} onClick={() => setOfferSort(s)}>
												{s === "price" ? "Price" : s === "mlperf" ? "MLPerf" : s === "value" ? "MLPerf/$" : "Latency"}
											</button>
										))}
									</div>
									<button className="ghost-button icon-button" onClick={() => loadOffers()} title="Refresh"><FontAwesomeIcon icon={faRotateRight} /></button>
								</div>
								{sorted.length === 0 && !error && <div className="wizard-empty">{offerFilter ? `No GPUs matching "${offerFilter}".` : "No offers found."}</div>}
								<div className="wizard-list">
									{sorted.map((offer) => (
										<div key={offer.id} className="wizard-row">
											<div className="wizard-row-info">
												<span className="wizard-row-name">{fmtGpu(offer.gpu_name, offer.num_gpus)}</span>
												<span className="wizard-row-sub">
													{fmtRam(offer.gpu_ram)} VRAM
													{offer.dlperf ? ` · ${offer.dlperf.toFixed(0)} MLPerf` : ""}
													{offer.dlperf_per_dphtotal ? ` · ${offer.dlperf_per_dphtotal.toFixed(0)}/$ ` : ""}
													{offer.latencyMs != null ? ` · ${offer.latencyMs}ms` : ""}
													{offer.geolocation ? ` · ${offer.geolocation}` : ""}
													{(offer.cuda_max_good ?? 99) < 12.4 ? <span style={{ color: "var(--accent-orange, #e07b39)", marginLeft: 4 }}>CUDA {offer.cuda_max_good} — driver too old</span> : null}
												</span>
											</div>
											<span className="wizard-cost">{fmtCost(offer.dph_total)}</span>
											<button className="primary-button" style={{ flexShrink: 0 }} onClick={() => pickOffer(offer)}>Select</button>
										</div>
									))}
								</div>
							</>
						);
					})()}

					{/* ── CONFIRM CONNECT ── */}
					{step === "confirm-connect" && selectedInstance && (
						<div className="settings-page">
							<div className="wizard-instance-summary">
								<StatusDot status={selectedInstance.actual_status} />
								<strong>{selectedInstance.label || `Instance #${selectedInstance.id}`}</strong>
								<span>{fmtGpu(selectedInstance.gpu_name, selectedInstance.num_gpus)}</span>
								<span className="wizard-cost-inline">{fmtCost(selectedInstance.dph_total)}</span>
							</div>
							{error && <div className="wizard-error" style={{ marginBottom: 12 }}><FontAwesomeIcon icon={faTriangleExclamation} /> {error}</div>}
							<label>
								<span>Jupyter URL</span>
								<input value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} placeholder="http://IP:PORT/" />
							</label>
							<label>
								<span>Token</span>
								<input value={manualToken} onChange={(e) => setManualToken(e.target.value)} type="password" placeholder="leave blank if none" />
							</label>
							<p className="settings-copy" style={{ marginTop: 4 }}>
								This instance is billing at <strong style={{ color: "var(--accent-red, #e05c5c)" }}>{fmtCost(selectedInstance.dph_total)}</strong>. You will be charged until the instance is stopped on vast.ai.
							</p>
							<div className="settings-actions">
								<button className="primary-button" onClick={doConnect} disabled={!manualUrl.trim()}>Connect</button>
							</div>
						</div>
					)}

					{/* ── CONFIRM START ── */}
					{step === "confirm-start" && selectedOffer && (
						<div className="settings-page">
							<div className="wizard-instance-summary">
								<FontAwesomeIcon icon={faServer} style={{ color: "var(--text-dim)" }} />
								<strong>{fmtGpu(selectedOffer.gpu_name, selectedOffer.num_gpus)}</strong>
								<span>{fmtRam(selectedOffer.gpu_ram)} VRAM</span>
								<span className="wizard-cost-inline">{fmtCost(selectedOffer.dph_total)}</span>
							</div>
							{error && <div className="wizard-error" style={{ marginBottom: 12 }}><FontAwesomeIcon icon={faTriangleExclamation} /> {error}</div>}
							<p className="settings-copy">Starting this instance will install JupyterLab and make it available in Scryer. Boot takes 2–5 minutes.</p>
							<p className="settings-copy" style={{ marginTop: 0 }}>
								<strong>You will be billed at <span style={{ color: "var(--accent-red, #e05c5c)" }}>{fmtCost(selectedOffer.dph_total)}</span></strong> from the moment the instance starts, until you destroy it on vast.ai.
							</p>
							<div className="settings-actions">
								<button className="ghost-button" onClick={() => setStep("offers")}>Cancel</button>
								<button className="primary-button" onClick={doStart}>
									Start instance · {fmtCost(selectedOffer.dph_total)}
								</button>
							</div>
						</div>
					)}

					{/* ── STARTING / CONNECTING ── */}
					{(step === "starting" || step === "connecting") && (
						<div className="wizard-center">
							<FontAwesomeIcon icon={faCircleNotch} spin style={{ fontSize: 24, color: "var(--text-dim)", marginBottom: 12 }} />
							<p style={{ color: "var(--text-dim)", textAlign: "center", margin: 0 }}>{statusMsg || "Connecting…"}</p>
							{error && <div className="wizard-error" style={{ marginTop: 12 }}><FontAwesomeIcon icon={faTriangleExclamation} /> {error}</div>}
						</div>
					)}
				</div>
			</section>
		</div>
	);
}
