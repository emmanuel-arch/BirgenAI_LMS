import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ConversationsClient } from "./ConversationsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// What customers are actually asking, and the officer's way of answering.
//
// Until this screen the platform could TALK to a borrower — outbound SMS, a
// stage notification — and could not LISTEN to one. A customer whose liveness
// check referred them had a single route to a human: ring the office and hope
// the person who answers can find their file.
//
// ?thread=<id> opens one directly, so a stage notification or a KYC referral can
// link an officer straight at the conversation rather than at the queue.
export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const { thread } = await searchParams;
  return <ConversationsClient openId={thread ?? null} />;
}
