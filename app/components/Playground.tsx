"use client";

import { useRef, useState, useCallback, KeyboardEvent } from "react";

type LogType = "log" | "warn" | "error" | "info";

interface LogLine {
  id: number;
  type: LogType;
  text: string;
}

const PLACEHOLDER = `// Escreva seu código aqui e clique em Executar (ou Ctrl+Enter)

console.log("Olá, mundo!")

const soma = (a, b) => a + b
console.log("2 + 3 =", soma(2, 3))
`;

let idCounter = 0;

// ─── Syntax highlighting ────────────────────────────────────────────────────

const KEYWORDS = new Set([
  "const","let","var","function","return","if","else","for","while","do",
  "class","new","this","typeof","instanceof","import","export","default",
  "from","async","await","try","catch","finally","throw","switch","case",
  "break","continue","in","of","void","delete","yield","static","extends",
  "super","debugger",
]);

const LITERALS = new Set(["true","false","null","undefined","NaN","Infinity"]);

const BUILTINS = new Set([
  "console","Math","Array","Object","String","Number","Boolean","Date",
  "RegExp","Error","Promise","JSON","parseInt","parseFloat","isNaN",
  "isFinite","setTimeout","setInterval","clearTimeout","clearInterval",
  "fetch","document","window","globalThis","Symbol","Map","Set",
  "WeakMap","WeakSet","Proxy","Reflect","structuredClone",
]);

// Single-pass tokenizer: order of alternatives = priority
const TOKEN_RE = new RegExp(
  [
    /\/\/[^\n]*/.source,                         // line comment
    /\/\*[\s\S]*?\*\//.source,                   // block comment
    /"(?:[^"\\]|\\.)*"/.source,                  // double-quoted string
    /'(?:[^'\\]|\\.)*'/.source,                  // single-quoted string
    /`(?:[^`\\]|\\.)*`/.source,                  // template literal
    /\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/.source, // number
    /[a-zA-Z_$][a-zA-Z0-9_$]*/.source,           // identifier
  ].join("|"),
  "g"
);

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(code: string): string {
  let out = "";
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = TOKEN_RE.exec(code)) !== null) {
    if (m.index > last) out += escHtml(code.slice(last, m.index));
    last = TOKEN_RE.lastIndex;

    const tok = m[0];
    const ch0 = tok[0];

    if (ch0 === "/" && (tok[1] === "/" || tok[1] === "*")) {
      out += `<span class="hl-comment">${escHtml(tok)}</span>`;
    } else if (ch0 === '"' || ch0 === "'" || ch0 === "`") {
      out += `<span class="hl-string">${escHtml(tok)}</span>`;
    } else if (ch0 >= "0" && ch0 <= "9") {
      out += `<span class="hl-number">${escHtml(tok)}</span>`;
    } else if (/[a-zA-Z_$]/.test(ch0)) {
      if (KEYWORDS.has(tok)) {
        out += `<span class="hl-keyword">${escHtml(tok)}</span>`;
      } else if (LITERALS.has(tok)) {
        out += `<span class="hl-literal">${escHtml(tok)}</span>`;
      } else if (BUILTINS.has(tok)) {
        out += `<span class="hl-builtin">${escHtml(tok)}</span>`;
      } else {
        // look-ahead: is the next non-space char a '('? → function call
        const rest = code.slice(last);
        const isFn = /^\s*\(/.test(rest);
        if (isFn) {
          out += `<span class="hl-function">${escHtml(tok)}</span>`;
        } else {
          out += escHtml(tok);
        }
      }
    } else {
      out += escHtml(tok);
    }
  }

  if (last < code.length) out += escHtml(code.slice(last));
  return out;
}

// ─── JS runner ──────────────────────────────────────────────────────────────

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  if (typeof v === "function") return v.toString();
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

function runUserCode(code: string): LogLine[] {
  const lines: LogLine[] = [];

  function push(type: LogType, prefix: string, args: unknown[]) {
    lines.push({ id: idCounter++, type, text: prefix + args.map(formatValue).join(" ") });
  }

  const sandboxConsole = {
    log:   (...a: unknown[]) => push("log",   "",    a),
    warn:  (...a: unknown[]) => push("warn",  "⚠ ",  a),
    error: (...a: unknown[]) => push("error", "✖ ",  a),
    info:  (...a: unknown[]) => push("info",  "ℹ ",  a),
  };

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("console", `"use strict";\n${code}`);
    const result = fn(sandboxConsole);
    if (result !== undefined) push("info", "→ ", [result]);
    if (lines.length === 0) push("info", "", ["// Executado sem saída."]);
  } catch (err) {
    const e = err as Error;
    push("error", "", [`${e.name}: ${e.message}`]);
  }
  return lines;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PAIRS: Record<string, string> = {
  "(": ")", "[": "]", "{": "}",
  '"': '"', "'": "'", "`": "`",
};

const LOG_STYLE: Record<LogType, string> = {
  log:   "text-slate-200",
  warn:  "text-yellow-300",
  error: "text-red-400",
  info:  "text-sky-300",
};

const EDITOR_FONT = "var(--font-mono), 'Fira Code', Consolas, monospace";
const EDITOR_STYLE = { fontFamily: EDITOR_FONT, fontSize: 15, lineHeight: "1.7" };
const PAD = { padding: "16px 20px" };

const MIN_PCT = 15;
const MAX_PCT = 85;

// ─── Component ──────────────────────────────────────────────────────────────

export default function Playground() {
  const [code, setCode]       = useState(PLACEHOLDER);
  const [lines, setLines]     = useState<LogLine[] | null>(null);
  const [splitPct, setSplit]  = useState(50);

  const outputRef   = useRef<HTMLDivElement>(null);
  const taRef       = useRef<HTMLTextAreaElement>(null);
  const preRef      = useRef<HTMLPreElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const dragging    = useRef(false);

  // ── run ──
  function run() {
    setLines(runUserCode(code));
    setTimeout(() => {
      outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
    }, 0);
  }

  // ── scroll sync ──
  function syncScroll() {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop  = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }

  // ── divider drag ──
  const onDragStart = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor     = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onDragEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor     = "";
    document.body.style.userSelect = "";
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging.current || !workspaceRef.current) return;
    const r = workspaceRef.current.getBoundingClientRect();
    setSplit(Math.min(MAX_PCT, Math.max(MIN_PCT, ((e.clientX - r.left) / r.width) * 100)));
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!dragging.current || !workspaceRef.current) return;
    const r = workspaceRef.current.getBoundingClientRect();
    setSplit(Math.min(MAX_PCT, Math.max(MIN_PCT, ((e.touches[0].clientX - r.left) / r.width) * 100)));
  }, []);

  // ── keyboard shortcuts + autocomplete ──
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const ta    = e.currentTarget;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const val   = ta.value;

    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault(); run(); return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      setCode(val.slice(0, start) + "  " + val.slice(end));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 2; });
      return;
    }

    const closing = Object.values(PAIRS);
    if (closing.includes(e.key) && val[start] === e.key && start === end) {
      e.preventDefault();
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 1; });
      return;
    }

    if (PAIRS[e.key]) {
      e.preventDefault();
      const close    = PAIRS[e.key];
      const selected = val.slice(start, end);
      const insert   = e.key + selected + close;
      setCode(val.slice(0, start) + insert + val.slice(end));
      requestAnimationFrame(() => {
        const pos = selected.length > 0 ? start + insert.length : start + 1;
        ta.selectionStart = ta.selectionEnd = pos;
      });
      return;
    }

    if (e.key === "Backspace" && start === end && start > 0) {
      const before = val[start - 1], after = val[start];
      if (PAIRS[before] && PAIRS[before] === after) {
        e.preventDefault();
        setCode(val.slice(0, start - 1) + val.slice(start + 1));
        requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start - 1; });
      }
    }
  }

  // ── render ──
  return (
    <div
      className="flex flex-col h-full bg-[#0f0f14] text-slate-200"
      style={{ padding: "0 24px" }}
      onMouseUp={onDragEnd}
      onMouseLeave={onDragEnd}
    >
      {/* Header */}
      <header
        className="flex items-center gap-4 bg-[#16161e] border-b border-[#2a2a3a] shrink-0"
        style={{ padding: "14px 20px" }}
      >
        <span className="text-yellow-400 text-lg font-bold tracking-wide">⚡ JS Playground</span>
        <span className="ml-auto text-sm font-semibold text-slate-400 tracking-wide">2º Jogos Digitais</span>
      </header>

      {/* Workspace */}
      <div
        ref={workspaceRef}
        className="flex flex-1 overflow-hidden flex-col md:flex-row"
        onMouseMove={onMouseMove}
        onTouchMove={onTouchMove}
        onTouchEnd={onDragEnd}
      >
        {/* ── Editor pane ── */}
        <div
          className="flex flex-col min-w-0 min-h-0 overflow-hidden"
          style={{ flexBasis: `${splitPct}%`, flexShrink: 0, flexGrow: 0 }}
        >
          <div
            className="flex items-center justify-between bg-[#16161e] border-b border-[#2a2a3a] shrink-0"
            style={{ padding: "10px 16px" }}
          >
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
              <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
              Código JavaScript
            </span>
            <button
              onClick={run}
              className="flex items-center gap-2 bg-yellow-400 hover:bg-yellow-300 active:scale-95 text-[#0f0f14] font-bold rounded-lg transition-all shadow-md"
              style={{ padding: "8px 20px", fontSize: 15 }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3 2l11 6-11 6V2z" />
              </svg>
              Executar
            </button>
          </div>

          {/* Overlay editor */}
          <div className="relative flex-1 overflow-hidden bg-[#0f0f14]">
            {/* Highlighted pre — behind */}
            <pre
              ref={preRef}
              aria-hidden
              dangerouslySetInnerHTML={{ __html: highlight(code) + "\n" }}
              style={{
                ...EDITOR_STYLE, ...PAD,
                position: "absolute", inset: 0,
                margin: 0, overflow: "hidden",
                whiteSpace: "pre-wrap", wordBreak: "break-all",
                pointerEvents: "none",
                color: "#cdd6f4",
              }}
            />
            {/* Transparent textarea — on top */}
            <textarea
              ref={taRef}
              style={{
                ...EDITOR_STYLE, ...PAD,
                position: "absolute", inset: 0,
                margin: 0, resize: "none",
                background: "transparent",
                color: "transparent",
                caretColor: "#f0c040",
                outline: "none",
                overflowY: "auto",
                whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={syncScroll}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        </div>

        {/* ── Draggable divider ── */}
        <div
          className="hidden md:flex items-center justify-center w-2 shrink-0 bg-[#2a2a3a] hover:bg-[#3a3a5a] cursor-col-resize group transition-colors"
          onMouseDown={onDragStart}
          onTouchStart={onDragStart}
        >
          <div className="flex flex-col gap-1">
            <span className="w-0.5 h-4 rounded-full bg-slate-600 group-hover:bg-slate-400 transition-colors" />
            <span className="w-0.5 h-4 rounded-full bg-slate-600 group-hover:bg-slate-400 transition-colors" />
            <span className="w-0.5 h-4 rounded-full bg-slate-600 group-hover:bg-slate-400 transition-colors" />
          </div>
        </div>
        <div className="md:hidden h-px bg-[#2a2a3a] shrink-0" />

        {/* ── Output pane ── */}
        <div className="flex flex-col min-w-0 min-h-0 overflow-hidden flex-1">
          <div
            className="flex items-center justify-between bg-[#16161e] border-b border-[#2a2a3a] shrink-0"
            style={{ padding: "10px 16px" }}
          >
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
              Saída
            </span>
            <button
              onClick={() => setLines(null)}
              className="text-xs font-semibold uppercase tracking-wider text-slate-600 hover:text-slate-300 transition-colors"
            >
              Limpar
            </button>
          </div>
          <div
            ref={outputRef}
            className="flex-1 overflow-y-auto bg-[#0d0d12]"
            style={{ ...EDITOR_STYLE, ...PAD }}
          >
            {lines === null ? (
              <span className="text-slate-700">// A saída aparecerá aqui...</span>
            ) : (
              lines.map((line) => (
                <div
                  key={line.id}
                  className={`mb-0.5 whitespace-pre-wrap break-all ${LOG_STYLE[line.type]}`}
                >
                  {line.text}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
