"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { extractSelectionContext } from "./selectionContext";
import type { ExtractedSelection } from "./selectionContext";

// Comprehension-support tool for the student page — highlight a word,
// phrase, or sentence in the question/follow-up/hint and get help
// understanding it. Interaction pattern (selectionchange listener,
// floating toolbar near the selection, result panel that's a floating
// card on desktop and a bottom sheet on mobile) is adapted from the
// Pre-Entrance Study Materials project's Selection Assistant, simplified
// since this page only ever has one selectable region (no cross-page
// registry/Context needed).

type ActionId = "translate" | "explain" | "easy" | "keywords" | "read";

const ACTIONS: { id: ActionId; icon: string; label: string }[] = [
  { id: "translate", icon: "🇯🇵", label: "Translate" },
  { id: "explain", icon: "❓", label: "What does this mean?" },
  { id: "easy", icon: "💬", label: "Easier English" },
  { id: "keywords", icon: "🔑", label: "Key Words" },
  { id: "read", icon: "🔊", label: "How do you read this?" },
];

// Must stay in sync with app/api/selection-assistant/route.ts's own cap —
// duplicated rather than shared, since question/follow-up/hint text is
// always short and this is the only place besides that route that needs it.
const MAX_SELECTION_LENGTH = 300;
const TOOLBAR_GAP = 8;
const PANEL_GAP = 12;
const DESKTOP_BREAKPOINT = 640;

interface PanelState {
  open: boolean;
  loading: boolean;
  action: ActionId | null;
  result: string | null;
  error: string | null;
  selection: ExtractedSelection | null;
}

const INITIAL_PANEL: PanelState = { open: false, loading: false, action: null, result: null, error: null, selection: null };

export default function SelectionAssistant({ level, children }: { level: string; children: React.ReactNode }) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<ExtractedSelection | null>(null);
  const [toolbarPos, setToolbarPos] = useState<{ top: number; left: number } | null>(null);
  const [panel, setPanel] = useState<PanelState>(INITIAL_PANEL);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    function onSelectionChange() {
      const sel = window.getSelection();
      if (!sel || !scopeRef.current) {
        setActive(null);
        return;
      }
      setActive(extractSelectionContext(scopeRef.current, sel));
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // Position the toolbar above the selection, flipping below and clamping
  // to the viewport when there isn't room — same technique as Pre-Entrance.
  useLayoutEffect(() => {
    if (!active || !toolbarRef.current) {
      setToolbarPos(null);
      return;
    }
    const { width, height } = toolbarRef.current.getBoundingClientRect();
    const midX = (active.rect.left + active.rect.right) / 2;
    let top = active.rect.top - height - TOOLBAR_GAP;
    if (top < TOOLBAR_GAP) top = active.rect.bottom + TOOLBAR_GAP;
    top = Math.max(TOOLBAR_GAP, Math.min(top, window.innerHeight - height - TOOLBAR_GAP));
    const left = Math.max(TOOLBAR_GAP, Math.min(midX - width / 2, window.innerWidth - width - TOOLBAR_GAP));
    setToolbarPos({ top, left });
  }, [active]);

  // Desktop: anchor the panel near the selection. Mobile (< 640px): leave
  // panelPos unset so CSS renders it as a fixed bottom sheet instead.
  useLayoutEffect(() => {
    if (!panel.open || !panel.selection || !panelRef.current || window.innerWidth < DESKTOP_BREAKPOINT) {
      setPanelPos(null);
      return;
    }
    const { width, height } = panelRef.current.getBoundingClientRect();
    const { rect } = panel.selection;
    let top = rect.bottom + PANEL_GAP;
    if (top + height > window.innerHeight - PANEL_GAP) top = Math.max(PANEL_GAP, rect.top - height - PANEL_GAP);
    const left = Math.max(PANEL_GAP, Math.min(rect.left, window.innerWidth - width - PANEL_GAP));
    setPanelPos({ top, left });
  }, [panel.open, panel.selection]);

  useEffect(() => {
    if (!panel.open) return;
    function onOutsideClick(e: MouseEvent) {
      if (!panelRef.current || panelRef.current.contains(e.target as Node)) return;
      if (window.getSelection()?.toString()) return; // an in-progress selection drag must not close the panel
      setPanel(INITIAL_PANEL);
    }
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, [panel.open]);

  // "How do you read this?" — reuses the same server-side OpenAI TTS
  // endpoint as the main question speaker button (tts-1-hd/alloy). Never
  // falls back to browser speechSynthesis: on failure, show an error and
  // stop, exactly like the main speaker button and like Pre-Entrance's
  // own "How to Read" policy.
  const requestRead = useCallback(async (snapshot: ExtractedSelection) => {
    try {
      const response = await fetch("/api/speech", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: snapshot.text }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Couldn't play this text.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.addEventListener("ended", () => URL.revokeObjectURL(url));
      audio.addEventListener("error", () => URL.revokeObjectURL(url));
      await audio.play();
      // Playback started — close the panel, there's no text result to show.
      setPanel((prev) => (prev.selection !== snapshot ? prev : INITIAL_PANEL));
    } catch (e) {
      setPanel((prev) =>
        prev.selection !== snapshot ? prev : { ...prev, loading: false, error: e instanceof Error ? e.message : "Couldn't play this text." }
      );
    }
  }, []);

  const requestAction = useCallback(
    async (actionId: ActionId) => {
      if (!active) return;
      const snapshot = active;

      if (snapshot.text.length > MAX_SELECTION_LENGTH) {
        setPanel({ open: true, loading: false, action: actionId, result: null, error: "The selected text is too long. Please select a shorter part.", selection: snapshot });
        return;
      }

      if (actionId === "read") {
        setPanel({ open: true, loading: true, action: actionId, result: null, error: null, selection: snapshot });
        await requestRead(snapshot);
        return;
      }

      setPanel({ open: true, loading: true, action: actionId, result: null, error: null, selection: snapshot });

      try {
        const response = await fetch("/api/selection-assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ selectedText: snapshot.text, context: snapshot.surroundingSentence, field: snapshot.field, level, action: actionId }),
        });
        const data = (await response.json()) as { explanation?: string; error?: string };
        setPanel((prev) => {
          if (prev.selection !== snapshot) return prev; // a newer request has since taken over
          return response.ok && data.explanation
            ? { ...prev, loading: false, result: data.explanation }
            : { ...prev, loading: false, error: data.error || "Something went wrong." };
        });
      } catch {
        setPanel((prev) => (prev.selection !== snapshot ? prev : { ...prev, loading: false, error: "Couldn't reach the assistant. Please check your connection." }));
      }
    },
    [active, level, requestRead]
  );

  return (
    <div ref={scopeRef} className="selectionScope">
      {children}
      {active && !panel.open && (
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label="Get help with this text"
          className="selectionToolbar"
          style={toolbarPos ? { top: toolbarPos.top, left: toolbarPos.left } : { top: -9999, left: -9999 }}
        >
          {ACTIONS.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-label={a.label}
              title={a.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => requestAction(a.id)}
              className="selectionToolbarButton"
            >
              <span aria-hidden="true">{a.icon}</span>
              <span className="selectionToolbarLabel">{a.label}</span>
            </button>
          ))}
        </div>
      )}
      {panel.open && (
        <div ref={panelRef} role="dialog" aria-label="Selection help" className="selectionPanel" style={panelPos ? { top: panelPos.top, left: panelPos.left } : undefined}>
          <div className="selectionPanelHead">
            <span>{ACTIONS.find((a) => a.id === panel.action)?.label || "Help"}</span>
            <button type="button" onClick={() => setPanel(INITIAL_PANEL)} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="selectionPanelBody">
            {panel.selection && <p className="selectionPanelOriginal">&ldquo;{panel.selection.text}&rdquo;</p>}
            {panel.loading && <p className="selectionPanelLoading">Thinking…</p>}
            {panel.error && !panel.loading && <p className="selectionPanelError">{panel.error}</p>}
            {panel.result && !panel.loading && <p className="selectionPanelResult">{panel.result}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
