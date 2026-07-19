// Shared shapes for the console shell. These used to live in TopBar.tsx; the
// top bar itself is gone (the sidebar now runs to the very top of the screen
// and the profile floats on the artwork), but everything it described remains.

export type ShellOrg = {
  name: string;
  slug: string;
  mode: string; // "NATIVE" | "BRIDGED"
  status: string; // "PENDING" | "ACTIVE" | ...
  logoUrl: string | null;
  /** Logo render size, percent of its default slot (50–200). */
  logoScale?: number;
};

export type ShellUser = {
  name: string;
  email?: string | null;
  role?: string | null;
};
