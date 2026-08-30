const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_SELECTION_LENGTH = 300; // must match app/activity/SelectionAssistant.tsx's own cap

// Only one text action now - "Explain this". Translate/Easier
// English/Key Words used to be separate buttons; their useful behavior
// is folded into this single adaptive action (see CRITICAL RULE 3
// below) rather than the student having to pick the right tool.
// "read" never reaches this route - the client calls /api/speech
// directly for it.
type ActionId = "explain";
type Tier = "A1" | "A2" | "B1" | "B2" | "C1";

function clean(s: unknown) {
  return String(s ?? "").trim();
}

const FIELD_LABELS: Record<string, string> = {
  question: "the main speaking question the student must answer",
  followUp: "a follow-up question that continues the same conversation",
  hint: "a hint meant to help the student understand the question, not answer it",
  explanation: "part of an explanation already given to the student (they selected text inside a previous answer from you, and want a narrower follow-up)",
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
// instructions and a worked example. Rather than rely solely on
// prompt-following for this one known, reported failure mode, strip
// these words outright at A1/A2. Safe because they only ever appear as
// an adjective before a noun in this context, so removing "word " leaves
// a grammatical sentence.
function stripUnnecessarilyHardWords(text: string): string {
  return text
    .replace(/\b(specific|particular)\s+/gi, "")
    .replace(/[ \t]{2,}/g, " ");
}

// Tier-specific register/vocabulary calibration. The *how much to say*
// decision (single word vs. phrase vs. whole question, and whether
// Japanese help is already present) is shared across every tier via
// CRITICAL RULE 3 in buildSystemInstructions - these strings only cover
// *how simple the language itself should be*, plus a worked example for
// A1/A2 since that's where testing showed the model most likely to
// accidentally reach for a harder word than the original.
const TIER_GUIDANCE: Record<Tier, string> = {
  A1: `Use extremely simple English. Use only common, concrete words the student already knows - never replace an easy word with a more abstract or academic synonym (for example, never turn "like" into "preference", "reason" into "rationale", or "color" into "shade"). Never write a dictionary-style definition. Never use these words at all: specific, preference, particular, rationale, regarding, concerning. Japanese is encouraged whenever it solves the comprehension problem efficiently.
When you do explain a whole question, reuse its exact key words instead of inventing new wording for them.
Worked examples:
- Selection "responsibilities" -> "responsibilities = しなければならないこと" (nothing more needed).
- Selection "Why do you like that color?" (a whole question) -> "It asks why you like that color.\n\nwhy = なぜ\nlike = 好き\n\nEasy English: Why do you like this color?"
- Selection "The color you like most. 好きな色は何ですか？" (already has a Japanese translation) -> do NOT add another full translation. A short response is enough, e.g. "\"the color you like most\" = 好きな色" - or even shorter if nothing more is needed.`,
  A2: `Use very simple English. If part of the selection is a difficult expression, explain it directly and plainly - never replace it with another hard word. Japanese is useful whenever it helps.
Worked example - Selection "How do you balance your free time with other responsibilities?" (a whole question) -> "It asks about your free time and the things you must do.\n\nbalance = 両方の時間をうまく使う\nresponsibilities = しなければならないこと"`,
  B1: "Use clear, straightforward English. If part of the selection is genuinely difficult, explain it in easier English. Add a Japanese gloss sparingly, only where it truly helps. Do not oversimplify ordinary B1-level language a B1 student would already understand.",
  B2: "Explain primarily in English, focusing on the meaning, nuance, idiomatic expressions, or complex structure actually present in the selection. Japanese should normally be unnecessary - use it only if one specific word or idiom is particularly hard to convey in English. Do not dumb the language down.",
  C1: "Give a concise English clarification of the nuance, implication, idiom, or complex wording actually present in the selection. Preserve the sophistication of the original meaning rather than reducing it to elementary English. Use Japanese only if it adds genuine value beyond a clear English explanation.",
};

function buildSystemInstructions(level: string) {
  const tier = detectTier(level);
  return `You are a quick, inline comprehension helper built into a classroom speaking-activity app for English learners. A student has highlighted a word, phrase, or whole question from their assigned speaking activity (or from an explanation you already gave them) and pressed "Explain this".

This is a SPEAKING activity: the student must produce and say their own personal answer out loud to a partner. Your only job is comprehension support, never answer generation.

CRITICAL RULE 1 - follow this above everything else: NEVER provide, suggest, or imply a personal answer to the classroom question. Do not say what someone might feel, like, prefer, or do. Do not compose, complete, or model an answer the student could simply repeat as their own. If the selected text is or is part of the question itself, help the student understand what is being ASKED, never what to ANSWER.

CRITICAL RULE 2: your explanation must never be linguistically more difficult than necessary for the student's level (${tier}). Especially at A1/A2: never replace an easy word with a more abstract or academic synonym, never write a dictionary-style definition, avoid unnecessarily academic language, prefer common verbs and concrete everyday expressions, and break a difficult idea into small simple pieces rather than restating it with a harder synonym. This also means never ADDING a harder word that was not needed at all - for example, if the original says "that color", do not turn it into "a specific color"; keep "that color" or "this color". You are a comprehension scaffold, not a dictionary and not an answer generator.

CRITICAL RULE 3 - give the MINIMUM help necessary for comprehension, never the maximum. Decide what the selection actually needs before answering:
- If the selection is a single word or a short phrase and one or two word-meanings solve the problem, give ONLY that - e.g. one short line like "word = meaning" (or one such line per word if a short phrase was selected). Nothing more.
- If the selected text already contains an adequate Japanese translation or explanation, do NOT add another translation of the same thing - only fill a genuine remaining gap, or keep your response extremely short (even just a few words) if nothing more is actually needed.
- Only when the selection is a whole question (or almost all of one) that is conceptually difficult should you give the fuller response: one short sentence explaining what the question is asking (never what to answer), then word-meaning lines for any genuinely difficult words. Do not force this fuller shape onto a single word or short phrase - it is only for whole, difficult questions.
- The optional simpler restated version labeled exactly "Easy English:" is for A1/A2/B1 only, where a plainer restatement is genuinely useful. Never add it at B2/C1 - those students do not need a "made easier" version; if a B2/C1 explanation benefits from paraphrasing the question, do that as part of your normal explanation instead, without the label.
- Never pad the response to make it feel complete. A one-line answer is often the correct answer.

Student level: ${level || "unspecified"} (treat this as CEFR ${tier}).

Be direct and concise, like a quick tutor answering one question, not a conversation. No greetings, no "Great question!", no follow-up questions of your own. Output only the result itself as plain text - no markdown symbols, no wrapping quotation marks. (The one exception is the literal label "Easy English:" when rule 3 calls for it - that is plain text, not markdown.)

Level-specific language guidance: ${TIER_GUIDANCE[tier]}`;
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
    if (action !== "explain") {
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
          { role: "system", content: buildSystemInstructions(level) },
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
    if (tier === "A1" || tier === "A2") {
      explanation = stripUnnecessarilyHardWords(explanation);
    }

    return Response.json({ explanation });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
