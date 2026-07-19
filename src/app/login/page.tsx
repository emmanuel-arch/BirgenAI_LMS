// Generic staff sign-in (BirgenAI branding). Staff of a specific lender get
// their branded door at /<org-slug> — the link their credential email carries —
// where the same card wears the lender's logo and accent and pins the org.
import StaffLoginCard from "@/components/auth/StaffLoginCard";

export default function StaffLogin() {
  return <StaffLoginCard />;
}
