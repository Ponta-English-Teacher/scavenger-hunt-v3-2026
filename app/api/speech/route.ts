const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TTS_MODEL = "tts-1-hd";
const TTS_VOICE = "alloy";
const MAX_SPEECH_TEXT_LENGTH = 500;

function clean(s: unknown) {
  return String(s ?? "").trim();
}

// On-demand OpenAI TTS for a single question, mirroring the Pre-Entrance
// AI Talk speech pattern: generated fresh per request, nothing written to
// disk or cached, server-side only. No browser speechSynthesis fallback.
export async function POST(request: Request) {
  try {
    if (!OPENAI_API_KEY) {
      return Response.json({ error: "Speech is not configured." }, { status: 500 });
    }

    const body = await request.json();
    const text = clean(body.text);

    if (!text) {
      return Response.json({ error: "No text was provided." }, { status: 400 });
    }
    if (text.length > MAX_SPEECH_TEXT_LENGTH) {
      return Response.json({ error: "This text is too long to read aloud." }, { status: 400 });
    }

    const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: text,
        response_format: "mp3",
      }),
    });

    if (!upstream.ok) {
      return Response.json({ error: "Couldn't generate audio for this question." }, { status: 502 });
    }

    const audio = await upstream.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Speech generation failed." }, { status: 500 });
  }
}
