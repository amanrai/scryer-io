import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap, showTooltip, type Tooltip } from "@codemirror/view";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";

type Props = {
	value: string;
	onChange: (value: string) => void;
	language: "python" | "markdown" | "mermaid";
	theme: "dark" | "light";
	/** Provider + session enable kernel-backed completion & introspection. */
	providerId?: string;
	sessionId?: string;
	onRun?: () => void;
	onRunAdvance?: () => void;
	onSave?: () => void;
	onEscape?: () => void;
	onFocus?: () => void;
	onBlur?: () => void;
};

const stripAnsi = (text: string) => text.replace(/\[[0-9;]*m/g, "");

// Shift+Tab introspection tooltip wiring.
const setInspectTooltip = StateEffect.define<Tooltip | null>();
const inspectTooltipField = StateField.define<Tooltip | null>({
	create: () => null,
	update(value, tr) {
		for (const effect of tr.effects) if (effect.is(setInspectTooltip)) return effect.value;
		if (value && tr.docChanged) return null;
		return value;
	},
	provide: (field) => showTooltip.from(field),
});

export type CodeEditorHandle = { focus(): void };

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(
	({ value, onChange, language, theme, providerId, sessionId, onRun, onRunAdvance, onSave, onEscape, onFocus, onBlur }, ref) => {
		const containerRef = useRef<HTMLDivElement>(null);
		const viewRef = useRef<EditorView | null>(null);
		const valueRef = useRef(value);
		const handlersRef = useRef({ onChange, onRun, onRunAdvance, onSave, onEscape, onFocus, onBlur, providerId, sessionId });
		handlersRef.current = { onChange, onRun, onRunAdvance, onSave, onEscape, onFocus, onBlur, providerId, sessionId };

		useImperativeHandle(ref, () => ({
			focus() { viewRef.current?.focus(); },
		}));

		useEffect(() => {
			if (!containerRef.current) return;
			const lang = language === "python" ? python() : markdown();

			// Kernel-backed Tab completion (Feature 1). No-ops without a session.
			const kernelCompletions = async (context: CompletionContext): Promise<CompletionResult | null> => {
				const { providerId, sessionId } = handlersRef.current;
				if (!providerId) return null;
				const word = context.matchBefore(/[\w.]+/);
				if (!context.explicit && (!word || word.from === word.to)) return null;
				try {
					const res = await fetch(`/api/runtime/providers/${providerId}/complete`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ code: context.state.doc.toString(), cursorPos: context.pos, sessionId }),
					});
					if (!res.ok) return null;
					const data = await res.json() as { matches?: string[]; cursorStart?: number; cursorEnd?: number };
					if (!data.matches?.length) return null;
					return {
						from: data.cursorStart ?? context.pos,
						to: data.cursorEnd ?? context.pos,
						options: data.matches.map((label) => ({ label })),
						validFor: /^[\w.]*$/,
					};
				} catch { return null; }
			};

			// Ruff diagnostics (Feature 6). Silently inert if ruff is unavailable.
			const ruffLinter = linter(async (view): Promise<Diagnostic[]> => {
				const code = view.state.doc.toString();
				if (!code.trim()) return [];
				try {
					const res = await fetch("/api/lint", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ code }),
					});
					if (!res.ok) return [];
					const data = await res.json() as { available?: boolean; diagnostics?: Array<{ line: number; column: number; endLine: number; endColumn: number; code?: string; message: string }> };
					if (!data.available || !data.diagnostics) return [];
					const lineStart = (n: number) => view.state.doc.line(Math.min(Math.max(n, 1), view.state.doc.lines));
					return data.diagnostics.map((d) => {
						const from = lineStart(d.line).from + (d.column - 1);
						const to = lineStart(d.endLine).from + (d.endColumn - 1);
						return { from, to: Math.max(to, from + 1), severity: "warning", message: d.code ? `${d.code}: ${d.message}` : d.message } satisfies Diagnostic;
					});
				} catch { return []; }
			}, { delay: 600 });

			// Shift+Tab introspection popover (Feature 1).
			const showInspect = (view: EditorView): boolean => {
				const { providerId, sessionId } = handlersRef.current;
				if (!providerId) return false;
				const pos = view.state.selection.main.head;
				void fetch(`/api/runtime/providers/${providerId}/inspect`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ code: view.state.doc.toString(), cursorPos: pos, sessionId }),
				}).then((res) => res.ok ? res.json() : null).then((data: { found?: boolean; data?: Record<string, unknown> } | null) => {
					const text = data?.found ? (data.data?.["text/plain"] as string | undefined) : undefined;
					if (!text) return;
					const tooltip: Tooltip = {
						pos,
						above: true,
						create: () => {
							const dom = document.createElement("div");
							dom.className = "cm-inspect-tooltip";
							const pre = document.createElement("pre");
							pre.textContent = stripAnsi(text);
							dom.appendChild(pre);
							return { dom };
						},
					};
					view.dispatch({ effects: setInspectTooltip.of(tooltip) });
				}).catch(() => undefined);
				return true;
			};

			const clearInspect = (view: EditorView): boolean => {
				if (!view.state.field(inspectTooltipField, false)) return false;
				view.dispatch({ effects: setInspectTooltip.of(null) });
				return true;
			};

			const customKeymap = keymap.of([
				{ key: "Shift-Enter", run: () => { handlersRef.current.onRunAdvance?.(); return true; } },
				{ key: "Mod-Enter", run: () => { handlersRef.current.onRun?.(); return true; } },
				{ key: "Mod-s", run: () => { handlersRef.current.onSave?.(); return true; } },
				{ key: "Shift-Tab", run: showInspect },
				{ key: "Escape", run: (view) => { if (clearInspect(view)) return true; handlersRef.current.onEscape?.(); return true; } },
				...defaultKeymap,
				indentWithTab,
			]);
			const state = EditorState.create({
				doc: valueRef.current,
				extensions: [
					customKeymap,
					basicSetup,
					lang,
					inspectTooltipField,
					language === "python" ? autocompletion({ override: [kernelCompletions], activateOnTyping: true }) : [],
					language === "python" ? ruffLinter : [],
					theme === "dark" ? oneDark : [],
					EditorView.domEventHandlers({
						focus: () => { handlersRef.current.onFocus?.(); return false; },
						blur: () => { handlersRef.current.onBlur?.(); return false; },
					}),
					EditorView.updateListener.of((update) => {
						if (update.docChanged) {
							const newValue = update.state.doc.toString();
							valueRef.current = newValue;
							handlersRef.current.onChange(newValue);
						}
					}),
					EditorView.theme({
						"&": { height: "100%", minHeight: "80px" },
						".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "13px", lineHeight: "1.55" },
						".cm-content": { padding: "10px 12px" },
						".cm-focused": { outline: "none" },
					}),
				],
			});
			const view = new EditorView({ state, parent: containerRef.current });
			viewRef.current = view;

			// When the accordion opens, the container resizes from 0 → natural height.
			// CodeMirror needs to remeasure or content stays invisible.
			const ro = new ResizeObserver(() => view.requestMeasure());
			ro.observe(containerRef.current);

			return () => { ro.disconnect(); view.destroy(); viewRef.current = null; };
		}, [language, theme]);

		useEffect(() => {
			const view = viewRef.current;
			if (!view) return;
			const current = view.state.doc.toString();
			if (current !== value) {
				valueRef.current = value;
				view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
			}
		}, [value]);

		return <div ref={containerRef} className="codemirror-wrap" />;
	},
);
