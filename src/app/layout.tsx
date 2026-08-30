import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme/useTheme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LMS",
  description:
    "AI-native loan origination & management for licensed lenders — multi-tenant, Tala-grade borrower experience.",
  // Default tab icon = the BirgenAI logo.png (the abstract mark), NOT the old
  // triangle favicon. Lender-scoped surfaces swap in their own logo at runtime.
  icons: { icon: "/images/logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The inline script below writes data-theme before React hydrates, so the
      // server's markup and the live DOM differ on this element by design.
      suppressHydrationWarning
    >
      <head>
        {/* ── THE ANTI-FLASH SCRIPT ──────────────────────────────────────────
            Runs before the bundle and before first paint. Without it a machine
            set to dark loads the console as a full-screen white rectangle for
            one to three hundred milliseconds, which is the single most visible
            defect a themed app can ship.

            It duplicates a few lines of lib/theme/useTheme.tsx on purpose: that
            module cannot run this early. The storage key is the contract between
            them — change one, change both. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(!/^\\/(console|analytics|desk|books|people|suite|platform)(\\/|$)/.test(location.pathname)){document.documentElement.setAttribute("data-theme","light");return}var s=localStorage.getItem("suite:appearance");var d=s==="dark"||((!s||s==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light")}catch(e){document.documentElement.setAttribute("data-theme","light")}})()`,
          }}
        />
      </head>
      {/* suppressHydrationWarning is here for BROWSER EXTENSIONS, not for our own
          markup. Grammarly (and Dashlane, LastPass, dark-reader…) stamp attributes
          like data-gr-ext-installed onto <body> before React hydrates, so the
          server HTML and the live DOM differ through no fault of this app.

          It is deliberately on <body> and nowhere else. The flag suppresses
          mismatches ONLY for this element's own attributes and direct text — it
          does NOT extend to descendants, so a genuine hydration bug anywhere
          inside the tree still reports normally. Do not sprinkle it further up or
          down to silence a warning; that hides real bugs. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
