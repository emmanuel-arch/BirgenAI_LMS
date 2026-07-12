// One page title, one subtitle, one place for the buttons.
//
// Every screen was rolling its own — text-xl here, text-2xl there, a zinc-500
// subtitle on one page and a zinc-400 one on the next — so the console had as many
// typographic opinions as it had pages. This is the opinion, once: a display-sized
// title in the brand's icon, a measure-limited subtitle in readable ink, and a slot
// on the right for whatever the page lets you DO.
//
// It carries no surface of its own. It doesn't need one: page content now sits on
// the canvas (see Shell), which is what makes a subtitle legible no matter where on
// the artwork it happens to land.
import type { LucideIcon } from "lucide-react";

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  /** Keep it to one sentence that tells them what this screen is FOR. */
  subtitle?: React.ReactNode;
  /** Actions — right-aligned on desktop, wrapped underneath on a phone. */
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="t-display flex items-center gap-2.5">
          {Icon && <Icon className="h-6 w-6 shrink-0" style={{ color: "var(--brand)" }} aria-hidden />}
          <span className="truncate">{title}</span>
        </h1>
        {/* ~68 characters is where a line stops being comfortable to read; the cap is
            what keeps a subtitle from running the full width of a 27" monitor. */}
        {subtitle && <p className="t-body mt-2 max-w-[68ch]">{subtitle}</p>}
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
