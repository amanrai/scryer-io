import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";

type FindBarProps = {
	findQuery: string;
	onFindQueryChange: (value: string) => void;
	replaceQuery: string;
	onReplaceQueryChange: (value: string) => void;
	matchCount: number;
	hasMatches: boolean;
	onPrev: () => void;
	onNext: () => void;
	onReplace: () => void;
	onReplaceAll: () => void;
	onClose: () => void;
};

export function FindBar({ findQuery, onFindQueryChange, replaceQuery, onReplaceQueryChange, matchCount, hasMatches, onPrev, onNext, onReplace, onReplaceAll, onClose }: FindBarProps) {
	return (
		<div className="find-bar">
			<FontAwesomeIcon icon={faMagnifyingGlass} />
			<input className="find-input" value={findQuery} onChange={(event) => onFindQueryChange(event.target.value)} placeholder="Find" autoFocus />
			<input className="find-input" value={replaceQuery} onChange={(event) => onReplaceQueryChange(event.target.value)} placeholder="Replace" />
			<span className="find-count">{matchCount} match{matchCount === 1 ? "" : "es"}</span>
			<button className="ghost-button" onClick={onPrev} disabled={!hasMatches}>Prev</button>
			<button className="ghost-button" onClick={onNext} disabled={!hasMatches}>Next</button>
			<button className="ghost-button" onClick={onReplace} disabled={!hasMatches}>Replace</button>
			<button className="ghost-button" onClick={onReplaceAll} disabled={!matchCount}>Replace All</button>
			<button className="ghost-button icon-button" title="Close find" aria-label="Close find" onClick={onClose}><FontAwesomeIcon icon={faXmark} /></button>
		</div>
	);
}
