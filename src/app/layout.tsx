import type { Metadata, Viewport } from "next";
import {
  Archivo,
  Audiowide,
  Geist,
  Geist_Mono,
  Orbitron,
  Press_Start_2P,
  VT323,
} from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { SKIN_INIT_SCRIPT } from "@/lib/skin";

import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/* Skin faces. `display: "swap"` so a slow font never blocks first paint. */
const pressStart = Press_Start_2P({
  variable: "--font-press-start",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});
const vt323 = VT323({
  variable: "--font-vt323",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});
const orbitron = Orbitron({
  variable: "--font-orbitron",
  subsets: ["latin"],
  display: "swap",
});
const audiowide = Audiowide({
  variable: "--font-audiowide",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Next Quest Manager",
    template: "%s · Next Quest Manager",
  },
  description:
    "A self-hostable kanban board. Postgres and nothing else — your boards, your server, your data.",
  applicationName: "Next Quest Manager",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#17171c" },
  ],
};

const FONT_VARS = [
  geistSans.variable,
  geistMono.variable,
  pressStart.variable,
  vt323.variable,
  orbitron.variable,
  audiowide.variable,
  archivo.variable,
].join(" ");

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${FONT_VARS} h-full antialiased`}
    >
      <head>
        {/*
          Stamps the skin attribute on <html> before first paint, the same way
          next-themes handles light/dark. Without it the page renders in the
          default palette for a frame and then snaps to the skin.

          It reads localStorage inside try/catch: browsers with site data
          blocked throw on access, and that must not take the page down.
        */}
        <script
          dangerouslySetInnerHTML={{ __html: SKIN_INIT_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
