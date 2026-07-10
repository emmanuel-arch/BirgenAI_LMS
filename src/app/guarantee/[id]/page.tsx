import { GuaranteeClient } from "./GuaranteeClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The guarantor's screen. Reached from an SMS, on a phone, by somebody who did not
// ask for any of this and may never have heard of us. So: no login, no jargon, no
// dark patterns. What they are agreeing to, what it costs them if it goes wrong, and
// two buttons of equal weight — one of which is "no".
export default async function GuaranteePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GuaranteeClient id={id} />;
}
