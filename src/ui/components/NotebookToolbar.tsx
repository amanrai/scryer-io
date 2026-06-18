import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	faArrowDown, faArrowUp, faBolt, faClone, faEraser, faFileCode, faFloppyDisk,
	faForwardStep, faListUl, faMagnifyingGlass, faPlay, faPlus, faPowerOff,
	faRotateRight, faStop, faTrash,
} from "@fortawesome/free-solid-svg-icons";

type NotebookToolbarProps = {
	saving: boolean;
	isExecuting: boolean;
	hasSession: boolean;
	canMoveUp: boolean;
	canMoveDown: boolean;
	canDelete: boolean;
	runLabel: string;
	onSave: () => void;
	onToggleSidebar: () => void;
	onToggleFind: () => void;
	onRestartKernel: () => void;
	onExecuteToHere: () => void;
	onExecuteFromHere: () => void;
	onClearOutputs: () => void;
	onMoveUp: () => void;
	onMoveDown: () => void;
	onDuplicate: () => void;
	onDelete: () => void;
	onRun: () => void;
	onInterrupt: () => void;
	onKill: () => void;
	onExport: () => void;
	onAddCell: () => void;
};

export function NotebookToolbar(props: NotebookToolbarProps) {
	return (
		<section className="toolbar" aria-label="Notebook actions">
			<button className="ghost-button icon-button" title="Save notebook (Cmd+S)" aria-label="Save notebook" onClick={props.onSave} disabled={props.saving}><FontAwesomeIcon icon={faFloppyDisk} /></button>
			<div className="toolbar-divider" />
			<button className="ghost-button icon-button" title="Toggle sidebar (ToC / Files / Variables)" aria-label="Toggle sidebar" onClick={props.onToggleSidebar}><FontAwesomeIcon icon={faListUl} /></button>
			<button className="ghost-button icon-button" title="Find & replace (Cmd+F)" aria-label="Find and replace" onClick={props.onToggleFind}><FontAwesomeIcon icon={faMagnifyingGlass} /></button>
			<div className="toolbar-divider" />
			<button className="ghost-button icon-button" title="Restart kernel" aria-label="Restart kernel" onClick={props.onRestartKernel} disabled={props.isExecuting || !props.hasSession}><FontAwesomeIcon icon={faRotateRight} /></button>
			<button className="ghost-button icon-button" title="Execute all up to here" aria-label="Execute all up to here" onClick={props.onExecuteToHere} disabled={props.isExecuting}><FontAwesomeIcon icon={faBolt} /></button>
			<button className="ghost-button icon-button" title="Execute all from here" aria-label="Execute all from here" onClick={props.onExecuteFromHere} disabled={props.isExecuting}><FontAwesomeIcon icon={faForwardStep} /></button>
			<button className="ghost-button icon-button" title="Clear outputs" aria-label="Clear outputs" onClick={props.onClearOutputs} disabled={props.isExecuting}><FontAwesomeIcon icon={faEraser} /></button>
			<div className="toolbar-divider" />
			<button className="ghost-button icon-button" title="Move cell up" aria-label="Move cell up" onClick={props.onMoveUp} disabled={!props.canMoveUp || props.isExecuting}><FontAwesomeIcon icon={faArrowUp} /></button>
			<button className="ghost-button icon-button" title="Move cell down" aria-label="Move cell down" onClick={props.onMoveDown} disabled={!props.canMoveDown || props.isExecuting}><FontAwesomeIcon icon={faArrowDown} /></button>
			<button className="ghost-button icon-button" title="Duplicate cell" aria-label="Duplicate cell" onClick={props.onDuplicate} disabled={props.isExecuting}><FontAwesomeIcon icon={faClone} /></button>
			<button className="ghost-button icon-button" title="Delete cell" aria-label="Delete cell" onClick={props.onDelete} disabled={props.isExecuting || !props.canDelete}><FontAwesomeIcon icon={faTrash} /></button>
			<button className="primary-button icon-button" title={props.runLabel} aria-label="Execute cell" onClick={props.onRun} disabled={props.isExecuting}><FontAwesomeIcon icon={faPlay} /></button>
			<button className="ghost-button icon-button" title="Interrupt kernel" aria-label="Interrupt kernel" onClick={props.onInterrupt} disabled={!props.hasSession}><FontAwesomeIcon icon={faStop} /></button>
			<button className="ghost-button icon-button" title="Kill kernel (Cmd+Shift+K)" aria-label="Kill kernel" onClick={props.onKill} disabled={!props.hasSession}><FontAwesomeIcon icon={faPowerOff} /></button>
			<div className="toolbar-spacer" />
			<button className="ghost-button icon-button" title="Export as .py" aria-label="Export as Python script" onClick={props.onExport}><FontAwesomeIcon icon={faFileCode} /></button>
			<button className="success-button icon-button" title="Add cell below" aria-label="Add cell below" onClick={props.onAddCell}><FontAwesomeIcon icon={faPlus} /></button>
		</section>
	);
}
