// Pure DOM utilities for turning a browser text Selection into the
// context payload the Selection Assistant needs. Adapted from the
// Pre-Entrance Study Materials project's Selection Assistant
// (src/lib/selectionAssistant/extractContext.ts), simplified for this
// app's much smaller, known content structure (a question, a follow-up,
// and a hint, each tagged with a data-field attribute) instead of
// arbitrary reading-passage HTML.

const EXCLUDED_TAGS = new Set(["INPUT", "TEXTAREA", "BUTTON", "SELECT", "A"]);

function isInsideExcludedElement(node: Node): boolean {
  let el: HTMLElement | null = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  let hops = 0;
  while (el && hops < 12) {
    if (EXCLUDED_TAGS.has(el.tagName) || el.isContentEditable) return true;
    el = el.parentElement;
    hops++;
  }
  return false;
}

export function splitIntoSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [text.trim()];
}

function findSurroundingSentence(fullText: string, selectedText: string): string {
  const sentences = splitIntoSentences(fullText);
  const exact = sentences.find((s) => s.includes(selectedText));
  if (exact) return exact;
  const firstWord = selectedText.trim().split(/\s+/)[0];
  const fallback = firstWord ? sentences.find((s) => s.includes(firstWord)) : undefined;
  return fallback ?? fullText;
}

export type SelectableField = "question" | "followUp" | "hint";

export interface ExtractedSelection {
  text: string;
  field: SelectableField;
  surroundingSentence: string;
  rect: { top: number; bottom: number; left: number; right: number };
}

export function extractSelectionContext(scope: HTMLElement, selection: Selection): ExtractedSelection | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  const text = selection.toString().trim();
  if (!text) return null;

  if (!scope.contains(range.commonAncestorContainer)) return null;
  if (isInsideExcludedElement(range.commonAncestorContainer)) return null;

  const anchor = range.commonAncestorContainer;
  const anchorEl = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
  const fieldEl = anchorEl?.closest("[data-field]");
  const field = (fieldEl?.getAttribute("data-field") as SelectableField) || "question";
  const fieldText = (fieldEl?.textContent ?? text).trim();
  const surroundingSentence = findSurroundingSentence(fieldText, text);
  const rect = range.getBoundingClientRect();

  return {
    text,
    field,
    surroundingSentence,
    rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
  };
}
