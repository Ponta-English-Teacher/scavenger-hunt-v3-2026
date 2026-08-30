type GeneratorItem = { text?: string; followUp?: string; hint?: string; grammarTag?: string };
type Question = { text: string; followUp: string; hint: string; grammarTag: string };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Allow this route up to 60s on Vercel: large requests run several batches
// (parallel, plus at most a couple of sequential backfill rounds), which
// can exceed the platform's default function duration.
export const maxDuration = 60;

const MAX_COUNT = 50;
const BATCH_SIZE = 10; // items per OpenAI call - see planBatches()
const MAX_BACKFILL_ROUNDS = 2;

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
// keeps the richer paraphrase-and-related-question style. Unchanged by the
// batching work below - each batch still uses this exact policy.
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

// Split a requested count into batches of at most BATCH_SIZE, generated in
// one OpenAI call each rather than one huge call for the whole request -
// this is what actually fixes the truncated-JSON failure, since each
// individual call now only ever has to produce a small, bounded amount of
// output regardless of how many questions the teacher asked for in total.
function planBatches(count: number): number[] {
  const sizes: number[] = [];
  let remaining = count;
  while (remaining > 0) {
    const size = Math.min(BATCH_SIZE, remaining);
    sizes.push(size);
    remaining -= size;
  }
  return sizes;
}

// Output-token budget scales with what a batch actually has to produce -
// batch size, and whether hints/follow-ups are on - instead of one fixed
// number applied to every request regardless of size. B1+ hints are
// deliberately richer (2-4 lines) than A1/A2's, so they get a larger
// per-item allowance.
function estimateMaxTokens(batchSize: number, level: string, includeHints: boolean, wantFollowUps: boolean) {
  const isSimpleHint = /A1|A2/i.test(level);
  const perItem =
    70 + // question text + grammarTag + JSON field names/punctuation
    (wantFollowUps ? 30 : 5) +
    (includeHints ? (isSimpleHint ? 40 : 100) : 5);
  const overhead = 150; // outer JSON wrapper
  return Math.min(4000, Math.max(400, overhead + batchSize * perItem));
}

function buildPrompt(params: { topic: string; level: string; batchSize: number; includeHints: boolean; wantFollowUps: boolean; avoid: string[] }) {
  const { topic, level, batchSize, includeHints, wantFollowUps, avoid } = params;
  return `
You are an English teacher creating natural pair-work speaking questions for ESL students.

Topic: ${topic || "(none)"}
Level: ${level || "(none)"}

TASK:
Generate exactly ${batchSize} items.
${
  avoid.length
    ? `\nDo NOT repeat or closely rephrase any of these questions, which have already been used for this same activity:\n${avoid.map((q) => `- ${q}`).join("\n")}\nGenerate genuinely different questions covering different angles or aspects of the topic.\n`
    : ""
}
CRITICAL OUTPUT RULES:
- Each item.text MUST be a complete natural question sentence for students.
- Each item.text MUST end with a question mark "?".
- Do NOT output single nouns or word lists (examples of WRONG text: "apples", "bananas", "favorite fruit").
- Keep questions appropriate to the level and topic.
- Vary the phrasing and angle across items - do not produce near-duplicate questions within this set.
${
  wantFollowUps
    ? `- Each item.followUp must be ONE natural optional follow-up question that continues the conversation. Do NOT reveal the answer to the main question.`
    : `- Leave item.followUp as an empty string.`
}
${includeHints ? hintPolicy(level) : `- Leave item.hint as an empty string. Do not generate any hint content.`}

Return ONLY valid JSON in this exact format (no markdown, no extra text):
{
  "items": [
    { "text": "...?", "followUp": "...", "hint": "...", "grammarTag": "..." }
  ]
}
`.trim();
}

async function callOpenAI(prompt: string, maxTokens: number): Promise<GeneratorItem[] | null> {
  try {
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
        max_tokens: maxTokens,
      }),
    });
    if (!upstream.ok) return null;
    const data = (await upstream.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(raw) as { items?: GeneratorItem[] };
    return Array.isArray(parsed?.items) ? parsed.items : null;
  } catch {
    return null;
  }
}

// One batch = one OpenAI call, with a single retry if that call fails or
// returns malformed/truncated JSON - so one bad batch doesn't sink an
// entire large request, it just gets one more attempt before being
// treated as a (partial) shortfall for the backfill step to cover.
async function generateBatch(params: { topic: string; level: string; batchSize: number; includeHints: boolean; wantFollowUps: boolean; avoid: string[] }): Promise<GeneratorItem[]> {
  const prompt = buildPrompt(params);
  const maxTokens = estimateMaxTokens(params.batchSize, params.level, params.includeHints, params.wantFollowUps);
  const result = (await callOpenAI(prompt, maxTokens)) ?? (await callOpenAI(prompt, maxTokens));
  return result ?? [];
}

function normalizeItems(raw: GeneratorItem[], includeHints: boolean, wantFollowUps: boolean): Question[] {
  return raw
    .map((item) => ({
      text: clean(item?.text),
      followUp: wantFollowUps ? clean(item?.followUp) : "",
      hint: includeHints ? cleanHintPreserveNewlines(item?.hint) : "",
      grammarTag: clean(item?.grammarTag),
    }))
    .filter((item) => looksLikeQuestionText(item.text));
}

function normalizeForDedup(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Batches run in parallel and can't see each other's output, so combining
// them can produce the same main question twice (e.g. two batches both
// reaching for "What is your favorite food?" on a generic topic). This
// keeps the first occurrence of each distinct question and drops later
// near-duplicates (case/punctuation-insensitive).
function dedupeItems(items: Question[]): Question[] {
  const seen = new Set<string>();
  const result: Question[] = [];
  for (const item of items) {
    const key = normalizeForDedup(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export async function POST(request: Request) {
  try {
    if (!OPENAI_API_KEY) {
      return Response.json({ error: "Question generation is not configured." }, { status: 500 });
    }

    const body = await request.json();
    const topic = clean(body.topic || "");
    const level = clean(body.level || "");
    const count = Math.max(1, Math.min(MAX_COUNT, Number(body.count) || 5));
    const includeHints = body.includeHints !== false;
    const wantFollowUps = body.followUps !== false;

    const batchSizes = planBatches(count);
    const batches = await Promise.all(
      batchSizes.map((batchSize) => generateBatch({ topic, level, batchSize, includeHints, wantFollowUps, avoid: [] }))
    );

    let items = dedupeItems(normalizeItems(batches.flat(), includeHints, wantFollowUps));

    // If deduplication (or a batch that failed both attempts) left us short
    // of the requested count, generate a small make-up batch that's told
    // exactly which questions are already used, and try again - bounded so
    // a stubbornly narrow topic can't loop forever.
    for (let round = 0; round < MAX_BACKFILL_ROUNDS && items.length < count; round++) {
      const shortfall = count - items.length;
      const avoid = items.map((item) => item.text);
      const extra = await generateBatch({ topic, level, batchSize: Math.min(shortfall + 2, BATCH_SIZE), includeHints, wantFollowUps, avoid });
      items = dedupeItems([...items, ...normalizeItems(extra, includeHints, wantFollowUps)]);
    }

    const finalItems = items.slice(0, count).map((item, i) => ({ id: `q${i + 1}`, ...item }));

    if (!finalItems.length) {
      return Response.json({ error: "No questions were generated. Please try again." }, { status: 502 });
    }

    return Response.json({ items: finalItems });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Question generation failed." }, { status: 500 });
  }
}
