/*
 * ─────────────────────────────────────────────────────────────────────────────
 * <riri-assistant> — Riri, in a partner's own system.
 *
 * Riri Ecosystem AI plan §02 and Sprint 6: "Publish the partner embed SDK and the web
 * component." One script tag, one element, no framework:
 *
 *   <script src="https://lms.servicesuitecloud.com/riri-embed.js" defer></script>
 *   <riri-assistant endpoint="/riri" name="Riri" lender="Micromart" accent="#3c320b"></riri-assistant>
 *
 * THE BROWSER NEVER HOLDS THE SECRET. `endpoint` is the PARTNER'S OWN server route.
 * It receives { question, context } from this element, signs the exact body and
 * forwards it to POST /api/riri/v1/ask. A minimal proxy, in Node:
 *
 *   import { createHmac } from "node:crypto";
 *   app.post("/riri", express.text({ type: "*\/*" }), async (req, res) => {
 *     const body = req.body;                           // forward the EXACT bytes
 *     const ts = String(Date.now());
 *     const sig = createHmac("sha256", process.env.RIRI_SECRET).update(`${ts}.${body}`).digest("hex");
 *     const r = await fetch("https://lms.servicesuitecloud.com/api/riri/v1/ask", {
 *       method: "POST", body,
 *       headers: { "content-type": "application/json", "x-riri-org": "KE/LENDER/<KRA PIN>", "x-riri-ts": ts, "x-riri-sig": sig },
 *     });
 *     res.status(r.status).type("json").send(await r.text());
 *   });
 *
 * What comes back always says what it stood on: the pack id and version.
 * ─────────────────────────────────────────────────────────────────────────────
 */
(() => {
  if (customElements.get("riri-assistant")) return;

  const css = (accent) => `
    :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #0a1020; }
    * { box-sizing: border-box; }
    .bubble { width: 58px; height: 58px; border-radius: 50%; border: 2px solid #fff; background: ${accent}; color: #fff; cursor: pointer;
      box-shadow: 0 12px 30px rgb(0 0 0 / .25); display: grid; place-items: center; font-weight: 700; font-size: 20px; }
    .panel { position: absolute; right: 0; bottom: 72px; width: min(380px, calc(100vw - 32px)); height: min(560px, calc(100vh - 110px));
      background: #fff; border-radius: 22px; box-shadow: 0 30px 80px -20px rgb(0 0 0 / .45), 0 0 0 1px rgb(0 0 0 / .06);
      display: none; flex-direction: column; overflow: hidden; }
    .panel.open { display: flex; }
    .head { padding: 14px 16px; background: linear-gradient(135deg, ${accent}22, transparent 70%); border-bottom: 1px solid #0a102012; }
    .head b { display: block; font-size: 14px; } .head span { font-size: 11.5px; color: #5a6480; }
    .log { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .me { align-self: flex-end; max-width: 85%; background: ${accent}; color: #fff; padding: 8px 12px; border-radius: 16px 16px 4px 16px; }
    .her { align-self: flex-start; max-width: 90%; background: #f1f4fa; border: 1px solid #0a102012; padding: 10px 12px; border-radius: 16px 16px 16px 4px; white-space: pre-wrap; }
    .src { margin-top: 6px; font-size: 10.5px; color: #8b93a8; }
    form { display: flex; gap: 6px; padding: 10px; border-top: 1px solid #0a102012; }
    input { flex: 1; border: 1px solid #0a102029; border-radius: 12px; padding: 9px 12px; font: inherit; outline: none; }
    input:focus { border-color: ${accent}; }
    button.send { border: 0; border-radius: 12px; background: ${accent}; color: #fff; padding: 0 14px; font-weight: 600; cursor: pointer; }
    .foot { text-align: center; font-size: 10px; color: #8b93a8; padding: 0 0 8px; }
  `;

  class RiriAssistant extends HTMLElement {
    connectedCallback() {
      const name = this.getAttribute("name") || "Riri";
      const lender = this.getAttribute("lender") || "";
      const accent = /^#[0-9a-f]{3,8}$/i.test(this.getAttribute("accent") || "") ? this.getAttribute("accent") : "#012863";
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `<style>${css(accent)}</style>
        <div class="panel" role="dialog" aria-label="${name}">
          <div class="head"><b></b><span></span></div>
          <div class="log" aria-live="polite"></div>
          <form><input maxlength="500" aria-label="Ask ${name}" /><button class="send" type="submit">Ask</button></form>
          <div class="foot">${name} answers from ${lender ? lender + "'s" : "your lender's"} own knowledge</div>
        </div>
        <button class="bubble" type="button" aria-label="Ask ${name}">${name.slice(0, 1)}</button>`;
      root.querySelector(".head b").textContent = name;
      root.querySelector(".head span").textContent = lender ? `Here first for ${lender}` : "Here first";
      const panel = root.querySelector(".panel");
      const log = root.querySelector(".log");
      const input = root.querySelector("input");
      const say = (cls, text, src) => {
        const el = document.createElement("div");
        el.className = cls;
        el.textContent = text;
        if (src) { const s = document.createElement("div"); s.className = "src"; s.textContent = src; el.appendChild(s); }
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
      };
      say("her", `I'm ${name}. Ask me anything${lender ? ` about ${lender}` : ""} — and if I can't answer, I'll say so.`);
      root.querySelector(".bubble").addEventListener("click", () => { panel.classList.toggle("open"); if (panel.classList.contains("open")) input.focus(); });
      root.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const question = input.value.trim();
        if (!question) return;
        input.value = "";
        say("me", question);
        try {
          const r = await fetch(this.getAttribute("endpoint") || "/riri", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question, context: { surface: "partner-embed", screen: location.pathname, lang: "auto" } }),
          });
          const j = await r.json();
          const src = (j.sources || []).map((s) => `${s.pack} v${s.version}${s.starter ? " · starter" : ""}`).join(" · ");
          say("her", j.answer || j.message || "I couldn't answer that just now.", src ? `From ${src}` : "");
        } catch {
          say("her", "I couldn't reach the server. Try again in a moment.");
        }
      });
    }
  }
  customElements.define("riri-assistant", RiriAssistant);
})();
