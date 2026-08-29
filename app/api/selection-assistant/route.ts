const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_SELECTION_LENGTH = 300; // must match app/activity/SelectionAssistant.tsx's own cap

type ActionId = "translate" | "explain" | "easy" | "keywords";
type Tier = "A1" | "A2" | "B1" | "B2" | "C1";

function clean(s: unknown) {
  return String(s ?? "").trim();
}

const FIELD_LABELS: Record<string, string> = {
  question: "the main speaking question the student must answer",
  followUp: "a follow-up question that continues the same conversation",
  hint: "a hint meant to help the student understand the question, not answer it",
};

// The teacher's level selector only ever produces "A1 (Starter)",
// "A2 (Elementary)", "B1 (Intermediate)", or "B2–C1 (Advanced)" - the
// last one deliberately combines B2 and C1 into one choice. Checking for
// "C1" first means that combined option resolves to the C1 (least
// simplification) end of the spectrum, which is the safer failure
// direction for an "Advanced" bucket. Detecting substrings independently
// (rather than an exact match) also means a future level string, or a
// direct API caller, can pass a plain "B2" or "C1" and still get the
// right tier.
function detectTier(level: string): Tier {
  const L = level.toUpperCase();
  if (L.includes("C1")) return "C1";
  if (L.includes("B2")) return "B2";
  if (L.includes("B1")) return "B1";
  if (L.includes("A2")) return "A2";
  if (L.includes("A1")) return "A1";
  return "B1"; // unrecognized/missing level: a neutral, moderate default
}

// Deterministic safety net on top of the prompt: in testing, gpt-4o-mini
// kept inserting "specific"/"particular" as an unnecessary adjective (e.g.
// "a specific color" for "that color") even after explicit prompt
// instructions and a worked example - exactly the failure this feature
// was built to fix. Rather than rely solely on prompt-following for this
// one known, reported failure mode, strip these words outright for
// A1/A2's free-text actions. Safe because they only ever appear as an
// adjective before a noun in this context, so removing "word " leaves a
// grammatical sentence.
function stripUnnecessarilyHardWords(text: string): string {
  return text
    .replace(/\b(specific|particular)\s+/gi, "")
    .replace(/[ \t]{2,}/g, " ");
}

// "What does this mean?" is the action most likely to accidentally use
// language harder than the original (e.g. explaining "like" with
// "preference"), so each tier gets a full, self-contained instruction
// rather than a shared base + addendum - including an explicit required
// output shape for A1/A2, matching the exact worked examples the
// pedagogy for this app was designed against.
const EXPLAIN_GUIDANCE: Record<Tier, string> = {
  A1: `Use extremely simple English and short sentences. Use only common, concrete words the student already knows - never replace an easy word with a more abstract or academic synonym (for example, never turn "like" into "preference", "reason" into "rationale", or "color" into "shade"). Never write a dictionary-style definition. Never use these words at all: specific, preference, particular, rationale, regarding, concerning.
For sentence 1, reuse the exact key words already in the question instead of inventing new wording for them - do not paraphrase words that are already simple.
Worked example - Question: "Why do you like that color?"
- Good sentence 1 (reuses the original words): "It asks why you like that color."
- Bad sentence 1 (invents new, harder words for no reason): "It asks for the reason you like a specific color."
Follow this exact shape:
1. One short, plain sentence explaining what the question is asking (never what to answer).
2. A blank line, then a Japanese gloss for each word or idea that could still be difficult, one per line, written as "word = Japanese meaning". Only include words that genuinely need it - do not gloss words a true beginner already knows.
3. A blank line, then a line that says exactly "Easy English:" followed by one short, simpler restatement of the question.`,
  A2: `Use very simple English and short sentences. If part of the question is a difficult expression, explain it directly and plainly - never replace it with another hard word.
Follow this exact shape:
1. One or two short sentences explaining what the question is asking (never what to answer).
2. A blank line, then a Japanese gloss for each genuinely difficult word or idea, one per line, written as "word = Japanese meaning". Only include words that actually need it.
3. A blank line, then a line that says exactly "Easy English:" followed by one short, simpler restatement of the question.`,
  B1: `Use clear, straightforward English. If part of the selection is genuinely difficult, explain it in easier English. You may add a Japanese gloss sparingly, only where it truly helps, and you may end with a simpler restatement of the question - but do not force a rigid template, and do not oversimplify ordinary B1-level language that a B1 student would already understand. Write in normal flowing sentences.`,
  B2: `Explain primarily in English, focusing on the meaning, nuance, idiomatic expressions, or complex structure actually present in the selection. Japanese should normally be unnecessary - use it only if one specific word or idiom is particularly hard to convey in English. Do not dumb the language down; a B2 student can handle a normal English explanation. Write in normal flowing sentences.`,
  C1: `Give a concise English clarification of the nuance, implication, idiom, or complex wording actually present in the selection. Preserve the sophistication of the original meaning rather than reducing it to elementary English. Use Japanese only if it adds genuine value beyond a clear English explanation. Write in normal flowing sentences.`,
};

// "Easier English" changes qualitatively by tier (at A1/A2 it means
// "make this much simpler"; at B2/C1 it means "lightly clarify the one
// or two genuinely obscure elements, keep everything else at its normal
// register") rather than just varying in degree, so - like explain -
// each tier gets a full, self-contained instruction instead of a shared
// "rewrite in easier English" base that would otherwise anchor every
// tier toward maximum simplification regardless of the addendum.
const EASY_GUIDANCE: Record<Tier, string> = {
  A1: 'Rewrite the selected text in genuine A1-level English: only the most common, concrete, everyday words (e.g. "like", "want", "good") and very short sentences - the kind of English a true beginner already knows. Never swap an easy word for a harder, more abstract one. Keep the exact meaning; do not add new information. Output only the rewritten text itself, with no label or prefix.',
  A2: "Rewrite the selected text in genuine A2-level English: common, everyday vocabulary and simple sentence structures. Keep the exact meaning; do not add new information. Output only the rewritten text itself, with no label or prefix.",
  B1: "Rewrite the selected text in clear, straightforward B1-level English - simplify the parts that are genuinely complex, but you do not need to go below normal B1 phrasing. Keep the exact meaning; do not add new information. Output only the rewritten text itself, with no label or prefix.",
  B2: "Lightly clarify the selected text for a B2 student. Keep the vocabulary and sentence structure a B2 student would already find normal - change only the specific word(s) or structure(s) that are genuinely obscure or overly formal for B2. The result must still read as natural B2-level English, not beginner English: do not flatten the register or shorten the sentence beyond what clarity requires. Keep the exact meaning. Output only the rewritten text itself, with no label or prefix.",
  C1: "Lightly clarify the selected text for a C1 student. Keep vocabulary and phrasing a C1 student would already find normal - change only the one or two elements that are genuinely obscure, archaic, or overly dense. The result must still read as natural, fairly sophisticated English, not beginner English: preserve register and nuance. Keep the exact meaning. Output only the rewritten text itself, with no label or prefix.",
};

const ACTION_BASE: Record<"translate" | "keywords", string> = {
  translate:
    "Give a natural, concise Japanese translation of the selected text, as it is used in this context. Keep it short - translate only what was selected, nothing more.",
  keywords:
    "Identify the important or difficult words or short phrases in the selected text (at most 5) - choose words that are actually likely to be difficult for a student at the given level; do not list extremely basic words the student certainly already knows. For each one, give a very short, level-appropriate easy-English meaning, and add a Japanese meaning where it helps. Keep the whole response compact, like a short list - not full sentences of explanation.",
};

const TIER_ADDENDUM: Record<"translate" | "keywords", Record<Tier, string>> = {
  translate: {
    A1: "If you add any extra English commentary at all, keep it extremely simple - usually the translation alone is enough.",
    A2: "Keep any extra English commentary short and very simple.",
    B1: "",
    B2: "",
    C1: "",
  },
  keywords: {
    A1: "At this level almost any non-basic word may be worth including, and a Japanese meaning is particularly useful for every entry. Write each definition in extremely simple English.",
    A2: "Focus on words a genuine beginner would find new; a Japanese meaning is particularly useful for every entry. Write each definition in very simple English.",
    B1: "Focus on words that would genuinely challenge a B1 student; add a Japanese meaning only where it helps. Write each definition in clear, straightforward English - it does not need to be simplified below B1.",
    B2: "Focus only on less common vocabulary, idioms, or nuanced word choices that would genuinely challenge a B2 student - skip anything a B2 student would already know. Write each definition in normal B2-level English, not simplified beginner English. Do not add a Japanese meaning unless one specific term is genuinely hard to convey in English even at this level - Japanese should be rare or absent.",
    C1: "Focus only on genuinely advanced, idiomatic, or nuanced vocabulary that would challenge even a strong student - skip anything a B2 student would already know. Write each definition in precise, natural English at a similarly sophisticated register, not simplified beginner English. Japanese should be rare or absent - use it only if a term is genuinely difficult to convey in English.",
  },
};

function buildTaskInstruction(action: ActionId, tier: Tier): string {
  if (action === "explain") return EXPLAIN_GUIDANCE[tier];
  if (action === "easy") return EASY_GUIDANCE[tier];
  const addendum = TIER_ADDENDUM[action][tier];
  return addendum ? `${ACTION_BASE[action]} ${addendum}` : ACTION_BASE[action];
}

function buildSystemInstructions(action: ActionId, level: string) {
  const tier = detectTier(level);
  return `You are a quick, inline comprehension helper built into a classroom speaking-activity app for English learners. A student has highlighted part of their assigned speaking question, its follow-up, or a hint, and wants help understanding it.

This is a SPEAKING activity: the student must produce and say their own personal answer out loud to a partner. Your only job is comprehension support, never answer generation.

CRITICAL RULE 1 - follow this above everything else: NEVER provide, suggest, or imply a personal answer to the classroom question. Do not say what someone might feel, like, prefer, or do. Do not compose, complete, or model an answer the student could simply repeat as their own. If the selected text is or is part of the question itself, help the student understand what is being ASKED, never what to ANSWER.

CRITICAL RULE 2: your explanation must never be linguistically more difficult than necessary for the student's level (${tier}). Especially at A1/A2: never replace an easy word with a more abstract or academic synonym (for example, never turn "like" into "preference", "color" into "shade", or "reason" into "rationale"), never write a dictionary-style definition, avoid unnecessarily academic language, prefer common verbs and concrete everyday expressions, and break a difficult idea into small simple pieces rather than restating it with a harder synonym. This also means never ADDING a harder word that was not needed at all - for example, if the original says "that color", do not turn it into "a specific color"; keep "that color" or "this color". You are a comprehension scaffold, not a dictionary and not an answer generator.

Student level: ${level || "unspecified"} (treat this as CEFR ${tier}).

Be direct and concise, like a quick tutor answering one question, not a conversation. No greetings, no "Great question!", no follow-up questions of your own. Output only the result itself as plain text - no markdown symbols, no wrapping quotation marks. (The one exception is the literal label "Easy English:" when the task below asks for it - that is plain text, not markdown.)

Task: ${buildTaskInstruction(action, tier)}`;
}

function buildTaskInput(params: { selectedText: string; context: string; field: string }) {
  const { selectedText, context, field } = params;
  const fieldLabel = FIELD_LABELS[field] || FIELD_LABELS.question;
  return [
    `This text is: ${fieldLabel}.`,
    `Selected text: "${selectedText}"`,
    context && context !== selectedText ? `Surrounding text (context only - do not restate it): "${context}"` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function POST(request: Request) {
  try {
    if (!OPENAI_API_KEY) {
      return Response.json({ error: "This assistant is not configured." }, { status: 500 });
    }

    const body = await request.json();
    const selectedText = clean(body.selectedText);
    const context = clean(body.context);
    const field = clean(body.field) || "question";
    const level = clean(body.level);
    const action = clean(body.action) as ActionId;

    if (!selectedText) {
      return Response.json({ error: "No text was selected." }, { status: 400 });
    }
    if (selectedText.length > MAX_SELECTION_LENGTH) {
      return Response.json({ error: "The selected text is too long. Please select a shorter part." }, { status: 400 });
    }
    if (action !== "explain" && action !== "easy" && !ACTION_BASE[action as "translate" | "keywords"]) {
      return Response.json({ error: "Unknown action." }, { status: 400 });
    }

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: buildSystemInstructions(action, level) },
          { role: "user", content: buildTaskInput({ selectedText, context, field }) },
        ],
        temperature: 0.2,
        max_tokens: 400,
      }),
    });

    if (!upstream.ok) {
      return Response.json({ error: "Couldn't reach the assistant. Please try again." }, { status: 502 });
    }

    const data = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> };
    let explanation = (data?.choices?.[0]?.message?.content || "").trim();

    if (!explanation) {
      return Response.json({ error: "No response was generated. Please try again." }, { status: 502 });
    }

    const tier = detectTier(level);
    if ((tier === "A1" || tier === "A2") && (action === "explain" || action === "easy")) {
      explanation = stripUnnecessarilyHardWords(explanation);
    }

    return Response.json({ explanation });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
