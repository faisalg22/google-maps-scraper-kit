import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth/session";
import { THEME_INIT_SCRIPT, isThemePref } from "@/lib/theme";
import { ThemeProvider } from "@/components/theme";

export const metadata: Metadata = {
  title: { default: "CutLane", template: "%s · CutLane" },
  description: "Find Whop Content Rewards campaigns, research hooks, post clips and submit them, all in one place.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d11" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Signed-in users' saved theme is rendered into <html> so every device starts correct.
  const user = await getCurrentUser().catch(() => null);
  const serverPref = user && isThemePref(user.theme_preference) ? user.theme_preference : null;
  return (
    <html lang="en" data-theme-pref={serverPref ?? undefined} suppressHydrationWarning>
      <head>
        {/* Runs before first paint: sets html.dark (or not), so there's no flash of the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-fg">
        <ThemeProvider serverPref={serverPref} signedIn={Boolean(user)}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
