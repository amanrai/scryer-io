import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCircleNodes, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { KernelSpec, ThemeName } from "../types.js";

export type SettingsPage = "provider" | "startup" | "theme";
type SaveState = "saved" | "saving" | "dirty";

type SettingsModalProps = {
	page: SettingsPage;
	onPageChange: (page: SettingsPage) => void;
	onClose: () => void;
	// Provider
	baseUrl: string;
	onBaseUrlChange: (value: string) => void;
	token: string;
	onTokenChange: (value: string) => void;
	kernelName: string;
	onKernelNameChange: (value: string) => void;
	kernelSpecs: KernelSpec[];
	connected: boolean;
	isConnecting: boolean;
	canConnect: boolean;
	onToggleConnection: () => void;
	// Startup
	requirements: string;
	onRequirementsChange: (value: string) => void;
	onstart: string;
	onOnstartChange: (value: string) => void;
	startupSaveState: SaveState;
	onSaveStartup: () => void;
	// Theme
	theme: ThemeName;
	onThemeChange: (theme: ThemeName) => void;
};

export function SettingsModal(props: SettingsModalProps) {
	const { page } = props;
	const title = page === "provider" ? "Provider" : page === "startup" ? "Startup" : "Theme";

	return (
		<div className="settings-backdrop" role="presentation" onClick={props.onClose}>
			<section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
				<header className="settings-header">
					<div><div className="eyebrow">Settings</div><h2 id="settings-title">{title}</h2></div>
					<button className="ghost-button icon-button" title="Close settings" aria-label="Close settings" onClick={props.onClose}><FontAwesomeIcon icon={faXmark} /></button>
				</header>
				<div className="settings-body">
					<nav className="settings-nav" aria-label="Settings pages">
						<button className={page === "provider" ? "active" : ""} type="button" onClick={() => props.onPageChange("provider")}>Provider</button>
						<button className={page === "startup" ? "active" : ""} type="button" onClick={() => props.onPageChange("startup")}>Startup</button>
						<button className={page === "theme" ? "active" : ""} type="button" onClick={() => props.onPageChange("theme")}>Theme</button>
					</nav>
					{page === "provider" && (
						<div className="settings-page">
							<p className="settings-copy">Connect this Scryer Io server to a Jupyter endpoint. Values are saved on the backend for every browser using this server.</p>
							<label><span>Jupyter URL</span><input value={props.baseUrl} onChange={(event) => props.onBaseUrlChange(event.target.value)} placeholder="http://127.0.0.1:8888/" /></label>
							<label><span>Token</span><input value={props.token} onChange={(event) => props.onTokenChange(event.target.value)} placeholder="paste token" type="password" /></label>
							<label><span>Kernel</span><input value={props.kernelName} onChange={(event) => props.onKernelNameChange(event.target.value)} list="kernel-specs" placeholder="python3" /><datalist id="kernel-specs">{props.kernelSpecs.map((spec) => <option key={spec.name} value={spec.name}>{spec.displayName}</option>)}</datalist></label>
							<div className="settings-actions"><button className={props.connected ? "success-button" : "primary-button"} onClick={props.onToggleConnection} disabled={props.isConnecting || !props.canConnect}><FontAwesomeIcon icon={faCircleNodes} /> {props.isConnecting ? "Working…" : props.connected ? "Connected" : "Connect"}</button></div>
						</div>
					)}
					{page === "startup" && (
						<div className="settings-page startup-page">
							<p className="settings-copy">These files are used when spinning up any compute provider. <code>requirements.txt</code> is installed at boot; the onstart script controls how the environment starts.</p>
							<label><span>requirements.txt</span>
								<textarea className="startup-editor" value={props.requirements} onChange={(event) => props.onRequirementsChange(event.target.value)} placeholder={"numpy\npandas\nmatplotlib\nscikit-learn"} rows={6} spellCheck={false} />
							</label>
							<label><span>onstart.sh</span>
								<textarea className="startup-editor startup-editor--tall" value={props.onstart} onChange={(event) => props.onOnstartChange(event.target.value)} rows={12} spellCheck={false} />
							</label>
							<div className="settings-actions">
								<button className={props.startupSaveState === "saved" ? "success-button" : "primary-button"} disabled={props.startupSaveState === "saving"} onClick={props.onSaveStartup}>
									{props.startupSaveState === "saving" ? "Saving…" : props.startupSaveState === "saved" ? "Saved" : "Save"}
								</button>
							</div>
						</div>
					)}
					{page === "theme" && (
						<div className="settings-page">
							<p className="settings-copy">Choose the Scryer Io interface theme. This preference is stored in this browser.</p>
							<div className="theme-options">
								<button className={props.theme === "dark" ? "theme-option active" : "theme-option"} onClick={() => props.onThemeChange("dark")}>One dark</button>
								<button className={props.theme === "light" ? "theme-option active" : "theme-option"} onClick={() => props.onThemeChange("light")}>One light</button>
							</div>
						</div>
					)}
				</div>
			</section>
		</div>
	);
}
