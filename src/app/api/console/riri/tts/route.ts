// Riri's voice. POST { text, lang } → base64 MP3.
//
// Google Cloud Text-to-Speech, with the same voices the Hub already uses (en-GB Neural2
// and sw-KE) so Riri sounds like one product across BirgenAI rather than two.
//
// SIMULATION-FIRST, like every other credentialed capability here: with no key this
// answers `{ success: false, reason: "no-key" }` and the CLIENT falls back to the
// browser's own speech synthesis. Riri still talks — just in the browser's voice
// instead of a Neural one. A demo on a laptop with no keys is not a silent demo, and we
// never pretend the good voice is on when it is not.
//
// Not metered. Support is not a billable AI call: a lender on the 10,000/mo package who
// cannot get help is a lender who churns, and charging them per question would be a tax
// on not understanding our own software. The Analyst tier is what is sold.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

const VOICES = {
  "sw-KE": { languageCode: "sw-KE", name: "sw-KE-Standard-A", ssmlGender: "FEMALE" as const },
  "en-KE": { languageCode: "en-GB", name: "en-GB-Neural2-C", ssmlGender: "FEMALE" as const },
};

/** The platform's Google key. A per-org AI vault entry is the future; the seam is here. */
const apiKey = () => process.env.GOOGLE_CLOUD_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim() || null;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });

  const key = apiKey();
  if (!key) {
    // Not an error — a state. The client reads this and uses the browser's voice.
    return NextResponse.json({ success: false, reason: "no-key" });
  }

  let body: { text?: string; lang?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  // Capped hard: this is a spoken answer, not an audiobook, and the cap is also what
  // stops a pasted essay from becoming an expensive API call.
  const text = (body.text ?? "").trim().slice(0, 900);
  if (!text) return NextResponse.json({ success: false, message: "Nothing to say." }, { status: 400 });

  const voice = body.lang === "sw-KE" ? VOICES["sw-KE"] : VOICES["en-KE"];

  try {
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice,
        audioConfig: { audioEncoding: "MP3", speakingRate: 1.03, pitch: 1.2 },
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      console.error("[riri/tts] google refused:", res.status, (await res.text()).slice(0, 200));
      return NextResponse.json({ success: false, reason: "provider" });
    }

    const data = (await res.json()) as { audioContent?: string };
    if (!data.audioContent) return NextResponse.json({ success: false, reason: "provider" });

    return NextResponse.json({ success: true, audio: data.audioContent, voice: voice.name });
  } catch (e) {
    // A voice that fails must never take the ANSWER down with it — the client already
    // has the text on screen and will simply read it aloud itself.
    console.error("[riri/tts]", e);
    return NextResponse.json({ success: false, reason: "provider" });
  }
}
