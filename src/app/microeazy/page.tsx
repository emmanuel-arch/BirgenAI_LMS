// The install door. See src/components/microeazy/InstallDoor.tsx.
//
// A SERVER component that resolves the lender and hands it to a client one.
// `lenderName` is resolved rather than imported so that when the Exchange starts
// awarding customers to a lender (blueprint §5), naming the lender-of-record on
// this screen changes in one function and not in this file. At launch the
// allocation policy is SOLE → micromart, but nothing here assumes that — this
// page never mentions Micromart.
import InstallDoor from "@/components/microeazy/InstallDoor";
import { lenderOfRecord } from "@/lib/microeazy/lender";

export default async function MicroEazyPage() {
  const lender = await lenderOfRecord();
  return <InstallDoor lenderName={lender?.name ?? null} />;
}
