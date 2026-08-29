const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const ACTIVITY_TTL_SECONDS = 60 * 60 * 24; // 24 hours: covers a full teaching day.
const MAX_CODE_ATTEMPTS = 10;

async function kvCommand(command: unknown[]) {
  if (!KV_URL || !KV_TOKEN) {
    throw new Error("Activity codes are not configured.");
  }

  const response = await fetch(KV_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${KV_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
  });

  const data = (await response.json()) as { result?: unknown; error?: string };
  if (!response.ok || data.error) {
    throw new Error(data.error || "Activity storage request failed.");
  }
  return data.result;
}

function generateCode() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

function isActivityPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === "string" &&
    v.title.trim().length > 0 &&
    Array.isArray(v.questions) &&
    v.questions.length > 0
  );
}

// POST /api/activities — store an activity, return a short 4-digit code.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!isActivityPayload(body)) {
      return Response.json({ error: "This activity is missing required fields." }, { status: 400 });
    }

    const payload = JSON.stringify(body);

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = generateCode();
      const result = await kvCommand(["SET", `activity:${code}`, payload, "NX", "EX", String(ACTIVITY_TTL_SECONDS)]);
      if (result === "OK") {
        return Response.json({ code });
      }
    }

    return Response.json({ error: "Could not generate an activity code. Please try again." }, { status: 503 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not create an activity code." }, { status: 500 });
  }
}

// GET /api/activities?code=XXXX — resolve a code back to the same
// base64url fragment the direct link and QR code already use, so /join
// can hand the browser off to the existing /activity page unchanged.
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = (searchParams.get("code") || "").trim();
    if (!/^\d{4}$/.test(code)) {
      return Response.json({ error: "Enter a valid 4-digit activity code." }, { status: 400 });
    }

    const raw = await kvCommand(["GET", `activity:${code}`]);
    if (!raw || typeof raw !== "string") {
      return Response.json({ error: "This code is invalid or has expired." }, { status: 404 });
    }

    const data = Buffer.from(raw, "utf-8").toString("base64url");
    return Response.json({ data });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not look up this code." }, { status: 500 });
  }
}
