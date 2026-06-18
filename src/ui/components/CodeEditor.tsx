import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";

type Props = {
	value: string;
	onChange: (value: string) => void;
	language: "python" | "markdown" | "mermaid";
	theme: "dark" | "light";
	onRun?: () => void;
	onRunAdvance?: () => void;
	onSave?: () => void;
	onEscape?: () => void;
	onFocus?: () => void;
	onBlur?: () => void;
};

export type CodeEditorHandle = { focus(): void };

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(
	({ value, onChange, language, theme, onRun, onRunAdvance, onSave, onEscape, onFocus, onBlur }, ref) => {
		const containerRef = useRef<HTMLDivElement>(null);
		const viewRef = useRef<EditorView | null>(null);
		const valueRef = useRef(value);
		const handlersRef = useRef({ onChange, onRun, onRunAdvance, onSave, onEscape, onFocus, onBlur });
		handlersRef.current = { onChange, onRun, onRunAdvance, onSave, onEscape, onFocus, onBlur };

		useImperativeHandle(ref, () => ({
			focus() { viewRef.current?.focus(); },
		}));

		useEffect(() => {
			if (!containerRef.current) return;
			const lang = language === "python" ? python() : markdown();
			const customKeymap = keymap.of([
				{ key: "Shift-Enter", run: () => { handlersRef.current.onRunAdvance?.(); return true; } },
				{ key: "Mod-Enter", run: () => { handlersRef.current.onRun?.(); return true; } },
				{ key: "Mod-s", run: () => { handlersRef.current.onSave?.(); return true; } },
				{ key: "Escape", run: () => { handlersRef.current.onEscape?.(); return true; } },
				...defaultKeymap,
				indentWithTab,
			]);
			const state = EditorState.create({
				doc: valueRef.current,
				extensions: [
					customKeymap,
					basicSetup,
					lang,
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
