import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNodes } from "@fortawesome/free-solid-svg-icons";
import type { KernelSpec, KernelStatus } from "../types.js";

type StatusBarProps = {
	statusMessage: string;
	saveLabel: string;
	cellLabel: string;
	costLabel?: string;
	hasSession: boolean;
	kernelStatus: KernelStatus;
	kernelName: string;
	kernelSpecs: KernelSpec[];
	onSwitchKernel: (name: string) => void;
	providerLabel: string;
	onChooseProvider: () => void;
};

export function StatusBar({ statusMessage, saveLabel, cellLabel, costLabel, hasSession, kernelStatus, kernelName, kernelSpecs, onSwitchKernel, providerLabel, onChooseProvider }: StatusBarProps) {
	const dotClass = hasSession ? (kernelStatus === "idle" ? "dot-green" : "dot-orange") : "dot-gray";
	return (
		<footer className="status-bar" id="workbench-status" role="status" aria-live="polite">
			<span className="status-msg">{statusMessage}</span>
			<span className="status-save">{saveLabel}</span>
			<span className="status-cell">{cellLabel}</span>
			<div className="status-spacer" />
			{costLabel && <span className="status-cost">{costLabel}</span>}
			<span className="status-kernel">
				<span className={`status-dot ${dotClass}`} />
				<select className="status-kernel-select" value={kernelName} onChange={(event) => onSwitchKernel(event.target.value)} aria-label="Switch kernel" title={`Kernel ${kernelStatus}`}>
					{kernelSpecs.length === 0 && <option value={kernelName}>{kernelName || "kernel"}</option>}
					{kernelSpecs.map((spec) => <option key={spec.name} value={spec.name}>{spec.displayName}</option>)}
				</select>
				<span className="status-kernel-status">· {kernelStatus}</span>
			</span>
			<button className="status-provider" onClick={onChooseProvider} title="Choose compute provider">
				<FontAwesomeIcon icon={faCircleNodes} />
				<span>{providerLabel}</span>
			</button>
		</footer>
	);
}
