type GeneratorItem = { text?: string; followUp?: string; hint?: string; grammarTag?: string };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function clean(s: unknown) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

// Preserve line breaks for hint display (and keep each line clean).
function cleanHintPreserveNewlines(s: unknown) {
  const raw = String(s ?? "").replace(/\r\n/g, "\n").trim();
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return lines.join("\n");
}

function looksLikeQuestionText(s: string) {
  const t = clean(s);
  if (!t) return false;
  if (!t.endsWith("?")) return false;
  if (t.split(" ").length < 2) return false;
  return true;
}

// Level-specific hint policy, restored from the classroom-question-builder
// source project (commit 8aae795) prior to its unsuccessful 3-line bilingual
// hint experiment. A1/A2 stays short and simple; everything else (B1/B2/C1)
// keeps the richer paraphrase-and-related-question style.
function hintPolicy(level: string) {
  const L = String(level || "").toUpperCase();

  if (L.includes("A1") || L.includes("A2")) {
    return `
Hint rules (A1–A2):
- hint must include:
  (1) a VERY short meaning in easy English
  (2) a Japanese translation
- Do NOT ask follow-up questions.
- Keep it short (1–2 lines).
`.trim();
  }

  return `
Hint rules (B1–B2):
- hint must include:
  (1) 1–2 short paraphrases of the question
  (2) 1–2 related questions (similar questions)
- Do NOT give answers.
- Do NOT branch (no yes/no paths).
- Keep it short (2–4 short lines).
`.trim();
}

export async function POST(request: Request) {
  try {
    if (!OPENAI_API_KEY) {
      return Response.json({ error: "Question generation is not configured." }, { status: 500 });
    }

    const body = await request.json();
    const topic = clean(body.topic || "");
    const level = clean(body.level || "");
    const count = Math.max(1, Math.min(20, Number(body.count) || 5));
    const includeHints = body.includeHints !== false;
    const wantFollowUps = body.followUps !== false;

    const prompt = `
You are an English teacher creating natural pair-work speaking questions for ESL students.

Topic: ${topic || "(none)"}
Level: ${level || "(none)"}

TASK:
Generate exactly ${count} items.

CRITICAL OUTPUT RULES:
- Each item.text MUST be a complete natural question sentence for students.
- Each item.text MUST end with a question mark "?".
- Do NOT output single nouns or word lists (examples of WRONG text: "apples", "bananas", "favorite fruit").
- Keep questions appropriate to the level and topic.
${wantFollowUps
  ? `- Each item.followUp must be ONE natural optional follow-up question that continues the conversation. Do NOT reveal the answer to the main question.`
  : `- Leave item.followUp as an empty string.`}
${includeHints ? hintPolicy(level) : `- Leave item.hint as an empty string. Do not generate any hint content.`}

Return ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "items": [
    { "text": "...?", "followUp": "...", "hint": "...", "grammarTag": "..." }
  ]
}
`.trim();

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 900,
      }),
    });

    if (!upstream.ok) {
      return Response.json({ error: "Question generation failed. Please try again." }, { status: 502 });
    }

    const data = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data?.choices?.[0]?.message?.content || "";

    let parsed: { items?: GeneratorItem[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Question generation returned an unexpected response. Please try again." }, { status: 502 });
    }

    const itemsRaw = Array.isArray(parsed?.items) ? parsed.items : [];

    const items = itemsRaw
      .map((item, i) => ({
        id: `q${i + 1}`,
        text: clean(item?.text),
        followUp: wantFollowUps ? clean(item?.followUp) : "",
        hint: includeHints ? cleanHintPreserveNewlines(item?.hint) : "",
        grammarTag: clean(item?.grammarTag),
      }))
      .filter((item) => looksLikeQuestionText(item.text))
      .slice(0, count);

    if (!items.length) {
      return Response.json({ error: "No questions were generated. Please try again." }, { status: 502 });
    }

    return Response.json({ items });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Question generation failed." }, { status: 500 });
  }
}
