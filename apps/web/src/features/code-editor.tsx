import {
  HighlightStyle,
  StreamLanguage,
  type StreamParser,
  syntaxHighlighting,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

interface KlipperState {
  /** Inside an indented value block (G-code of a macro, multi-line options). */
  block: boolean;
}

/**
 * Klipper/Moonraker config: `[sections]`, `key: value` options, `#`/`;`
 * comments and indented G-code blocks with Jinja `{ … }` templates.
 */
const klipperConfig: StreamParser<KlipperState> = {
  name: "klipper",
  startState: () => ({ block: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.block = /^\s/.test(stream.string) && stream.string.trim() !== "";
      if (!state.block) {
        if (stream.match(/^\[[^\]]*\]/)) return "header";
        if (stream.match(/^[#;].*/)) return "comment";
        if (stream.match(/^[^:=#;\s][^:=#;]*?(?=\s*[:=])/)) return "def";
      }
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/^[#;].*/)) return "comment";
    if (stream.match(/^\{[{%#]?/)) {
      stream.skipTo("}");
      stream.match(/^[%#]?\}\}?/);
      return "meta";
    }
    if (stream.match(/^[:=]/)) return "operator";
    if (state.block && stream.column() === stream.indentation() && stream.match(/^[A-Za-z_]\w*/))
      return "keyword";
    if (stream.match(/^-?\d+(\.\d+)?(?=[\s,#;]|$)/)) return "number";
    if (!stream.match(/^[^\s#;{:=]+/)) stream.next();
    return "string";
  },
};

const highlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--color-accent)", fontWeight: "600" },
  { tag: tags.comment, color: "var(--color-subtle)", fontStyle: "italic" },
  { tag: tags.definition(tags.variableName), color: "var(--color-series-1)" },
  { tag: tags.keyword, color: "var(--color-series-2)", fontWeight: "600" },
  { tag: tags.meta, color: "var(--color-series-4)" },
  { tag: tags.number, color: "var(--color-series-3)" },
  { tag: tags.operator, color: "var(--color-subtle)" },
  { tag: tags.string, color: "var(--color-text)" },
]);

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "var(--color-sidebar)",
    color: "var(--color-text)",
  },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: "1.6" },
  ".cm-content": { caretColor: "var(--color-accent)" },
  ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
  ".cm-gutters": {
    backgroundColor: "var(--color-sidebar)",
    color: "var(--color-subtle)",
    borderRight: "1px solid var(--color-line)",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 28%, transparent)",
  },
  ".cm-panels": { backgroundColor: "var(--color-surface)", color: "var(--color-text)" },
  ".cm-panels input, .cm-panels button": { color: "inherit" },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--color-warning) 30%, transparent)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--color-surface-2)",
    border: "1px solid var(--color-line)",
    color: "var(--color-muted)",
  },
  ".cm-tooltip": { backgroundColor: "var(--color-surface)", border: "1px solid var(--color-line)" },
});

/**
 * Config editor (CodeMirror). Uncontrolled after mount: remount with a new
 * `key` to load another document.
 */
export default function CodeEditor({
  initialValue,
  label,
  readOnly = false,
  onChange,
  onSave,
}: {
  initialValue: string;
  label: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };

  // biome-ignore lint/correctness/useExhaustiveDependencies: the document is created once per mount (see doc comment).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                callbacks.current.onSave?.();
                return true;
              },
            },
          ]),
          basicSetup,
          StreamLanguage.define(klipperConfig),
          syntaxHighlighting(highlight),
          theme,
          EditorState.readOnly.of(readOnly),
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, []);

  return <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />;
}
