// GET /api/console/crb/test — diagnose the org's CRB (Metropol) connection.
//
// Two signed round-trips, no borrower data and no billing:
//   • /health  — proves the host + port + API version path are correct.
//   • identity/verify on a Metropol dummy test ID — proves the KEY PAIR + HASH
//     are valid (a bad hash comes back E027, a bad key E003/E004).
// Returns a plain diagnosis the Settings UI can render.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { getIntegration } from "@/lib/vault/integrations";
import { health, verifyIdentity, MetropolError } from "@/lib/crb/metropol";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "settings.view");
  if (denied) return denied;

  const cfg = await getIntegration(session.user.orgId, "CRB").catch(() => null);
  if (!cfg) return NextResponse.json({ success: true, configured: false, message: "No CRB subscription saved. Checks run as a labelled simulation." });
  if (cfg.bureau !== "metropol") {
    return NextResponse.json({ success: true, configured: true, bureau: cfg.bureau, tested: false, message: `Live testing is wired for Metropol; ${cfg.bureau} runs in simulation.` });
  }

  const base = { host: cfg.host || "api.metropol.co.ke", port: cfg.port || "5555", apiVersion: cfg.apiVersion || null };
  const hasKeys = !!(cfg.publicKey || cfg.username) && !!(cfg.privateKey || cfg.password);
  if (!hasKeys) return NextResponse.json({ success: true, configured: true, bureau: "metropol", ...base, reachable: false, keysValid: false, message: "Metropol keys are missing." });
  if (!cfg.apiVersion) return NextResponse.json({ success: true, configured: true, bureau: "metropol", ...base, reachable: false, keysValid: false, message: "Metropol API version is missing (Metropol assigns it — e.g. v2_1)." });

  const out: Record<string, unknown> = { success: true, configured: true, bureau: "metropol", ...base };

  // 1. Reachability + version path.
  try {
    const h = (await health(cfg)) as Record<string, unknown>;
    out.reachable = h.has_error === false;
    out.health = h.api_code_description ?? h.api_code ?? null;
  } catch (e) {
    out.reachable = false;
    out.health = e instanceof Error ? e.message : String(e);
  }

  // 2. Key pair + hash validity (dummy ID — a signing failure surfaces as E027).
  try {
    const v = (await verifyIdentity(cfg, { identityNumber: "880000088" })) as Record<string, unknown>;
    out.keysValid = true;
    out.sample = { name: [v.first_name, v.last_name].filter(Boolean).join(" ") || null, dob: v.date_of_birth ?? v.dob ?? null };
    out.message = "Metropol is live — keys, signing and endpoint all verified.";
  } catch (e) {
    if (e instanceof MetropolError) {
      // Auth-class codes mean the keys/hash are wrong; anything else (e.g. not
      // found for a real prod account) still proves the signature was accepted.
      const authFail = ["E002", "E003", "E004", "E026", "E027", "E028", "E030"].includes(e.apiCode ?? "");
      out.keysValid = !authFail;
      out.message = authFail
        ? `Signing/keys rejected by Metropol: ${e.message}`
        : `Keys accepted; Metropol responded: ${e.message}`;
    } else {
      out.keysValid = false;
      out.message = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json(out);
}
