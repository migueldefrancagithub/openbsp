import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "OpenBSP — WhatsApp Business para empresas que respeitam regras",
  description:
    "Inbox real-time, broadcasts segmentados, lembretes automáticos e RGPD em primeiro lugar. Construído sobre Convex + Next.js para performance reactive.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html
        lang="pt-PT"
        className={`${inter.variable} ${outfit.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-[#f9fafb]">
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
