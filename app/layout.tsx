import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Toaster } from "sonner";
import { DemoBar } from "@/components/demo/demo-bar";
import { DemoGuide } from "@/components/demo/demo-guide";
import { isDemo } from "@/lib/env";
import { getDemoContext } from "@/lib/db/queries";
import "./globals.css";

// Every page reads the live in-memory store, so nothing is prerendered.
export const dynamic = "force-dynamic";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  const prefix = isDemo ? "[DEMO] " : "";
  return {
    title: { default: `${prefix}${t("product")}`, template: `${prefix}%s · ${t("product")}` },
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = { themeColor: "#fafaf9", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  const demo = isDemo ? getDemoContext() : null;
  return (
    <html lang="cs" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <NextIntlClientProvider>
          {isDemo && <DemoBar />}
          {children}
          {demo?.primaryCompanyId && (
            <Suspense>
              <DemoGuide primaryCompanyId={demo.primaryCompanyId} recommendedPreset={demo.recommendedPreset} />
            </Suspense>
          )}
          <Toaster position="bottom-center" richColors={false} toastOptions={{ className: "font-sans" }} />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
