const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_SELECTION_LENGTH = 300; // must match app/activity/SelectionAssistant.tsx's own cap

type ActionId = "translate" | "explain" | "easy" | "keywords";

function clean(s: unknown) {
  return String(s ?? "").trim();
}

const FIELD_LABELS: Record<string, string> = {
  question: "the main speaking question the student must answer",
  followUp: "a follow-up question that continues the same conversation",
  hint: "a hint meant to help the student understand the question, not answer it",
};

// Comprehension-only instructions per action. The CRITICAL RULE in
// buildSystemInstructions below applies to all four and is what actually
// keeps this a comprehension tool rather than an answer generator; these
// per-action strings only describe the *kind* of comprehension help.
const ACTION_INSTRUCTIONS: Record<ActionId, string> = {
  translate:
    "Give a natural, concise Japanese translation of the selected text, as it is used in this context. Keep it short - translate only what was selected, nothing more.",
  explain:
    "Explain what the selected text means, in easier English. If it is a difficult word or expression, unpack it in plain terms. If the selection is the whole question (or most of it), explain what topic or idea the question is asking the student to talk about, and you may give a simpler restated version of the question.",
  easy:
    "Rewrite the selected text using easier English vocabulary and simpler grammar, while keeping its exact meaning. Do not add information that was not in the original.",
  keywords:
    "Identify the important or difficult words or short phrases in the selected text (at most 5). For each one, give a very short easy-English meaning, and add a short Japanese meaning too where it helps. Keep the whole response compact, like a short list - not full sentences of explanation.",
};

function buildSystemInstructions(action: ActionId, level: string) {
  return `You are a quick, inline comprehension helper built into a classroom speaking-activity app for English learners. A student has highlighted part of their assigned speaking question, its follow-up, or a hint, and wants help understanding it.

This is a SPEAKING activity: the student must produce and say their own personal answer out loud to a partner. Your only job is comprehension support, never answer generation.

CRITICAL RULE - follow this above everything else: NEVER provide, suggest, or imply a personal answer to the classroom question. Do not say what someone might feel, like, prefer, or do. Do not compose, complete, or model an answer the student could simply repeat as their own. If the selected text is or is part of the question itself, help the student understand what is being ASKED, never what to ANSWER.

Student level: ${level || "unspecified"}. Keep your own explanation itself in clear, simple English appropriate for this level.

Be direct and concise, like a quick dictionary lookup, not a conversation. No greetings, no "Great question!", no follow-up questions of your own. Output only the result itself as plain text - no labels, no markdown, no wrapping quotation marks.

Task: ${ACTION_INSTRUCTIONS[action]}`;
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
    if (!ACTION_INSTRUCTIONS[action]) {
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
        temperature: 0.3,
        max_tokens: 400,
      }),
    });

    if (!upstream.ok) {
      return Response.json({ error: "Couldn't reach the assistant. Please try again." }, { status: 502 });
    }

    const data = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const explanation = (data?.choices?.[0]?.message?.content || "").trim();

    if (!explanation) {
      return Response.json({ error: "No response was generated. Please try again." }, { status: 502 });
    }

    return Response.json({ explanation });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Something went wrong." }, { status: 500 });
  }
}
