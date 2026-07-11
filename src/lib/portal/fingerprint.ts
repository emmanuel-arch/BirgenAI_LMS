"use client";

// Device fingerprint — a stable hash of the applying device's traits (blueprint
// §5.1 fraud control). NOT tracking: no cookie, no storage, nothing readable
// back out of the hash. Its one job is the ring pattern — the same device
// applying as five different people — which the console surfaces as a
// shared-device count on the application.
export async function deviceFingerprint(): Promise<string | null> {
  try {
    if (typeof window === "undefined" || !crypto?.subtle) return null;
    const n = navigator as Navigator & { deviceMemory?: number };
    const parts = [
      navigator.userAgent,
      navigator.language,
      (navigator.languages ?? []).join(","),
      String(navigator.hardwareConcurrency ?? ""),
      String(n.deviceMemory ?? ""),
      `${screen.width}x${screen.height}x${screen.colorDepth}`,
      String(window.devicePixelRatio ?? ""),
      Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
      navigator.platform ?? "",
      canvasSignal(),
    ].join("|");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null; // a fingerprint is a signal, never a requirement
  }
}

/** GPU/font rendering differences make the same text draw slightly differently. */
function canvasSignal(): string {
  try {
    const c = document.createElement("canvas");
    c.width = 200; c.height = 40;
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.textBaseline = "top";
    ctx.font = "15px 'Segoe UI', Arial";
    ctx.fillStyle = "#f60";
    ctx.fillRect(60, 4, 80, 24);
    ctx.fillStyle = "#069";
    ctx.fillText("BirgenAI-fp-πŊ", 2, 8);
    return c.toDataURL().slice(-64);
  } catch {
    return "";
  }
}
