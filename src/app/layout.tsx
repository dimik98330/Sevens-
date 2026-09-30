import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LanguageProvider, T } from "@/features/i18n/provider";
import { isLocale, LOCALE_COOKIE } from "@/features/i18n/locale";
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import "./sevens-system.css";
import "./sevens-home.css";
import "./sevens-header.css";
import "./sevens-auth.css";
import "./sevens-workspace.css";
import "./sevens-language.css";
import "./sevens-showcase.css";
import { WorkspaceLayout } from "@/components/ui/WorkspaceLayout";
import { NavigationSafety, NavigationBlockProvider } from "@/components/ui/NavigationSafety";
import { SiteHeader } from "@/components/ui/SiteHeader";
import { SessionProvider } from "@/features/shared/session";
import { AssistantProvider } from "@/features/assistant/context";
import { Assistant } from "@/components/assistant/Assistant";

export const metadata: Metadata = {
  icons: { icon: "/sevens/sevens-mark.svg" },
  title: { default: "Sevens — идеи для области Абай", template: "%s · Sevens" },
  description:
    "Платформа идей жителей области Абай: подача, автоматическая маршрутизация, рассмотрение органом и обратная связь.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const selected = (await cookies()).get(LOCALE_COOKIE)?.value;
  const initialLocale = isLocale(selected) ? selected : "ru";
  return (
    <html lang={initialLocale} data-scroll-behavior="smooth">
      <body>
        <LanguageProvider initialLocale={initialLocale}>
        <a className="skip-link" href="#main">
          <T>Перейти к содержанию</T>
        </a>
        <SessionProvider>
          <AssistantProvider>
            <NavigationBlockProvider>
            <NavigationSafety />
            <SiteHeader />
            <main id="main" className="page sevens-assistant-page-space" tabIndex={-1}>
              <WorkspaceLayout>{children}</WorkspaceLayout>
            </main>
            <Assistant />
            </NavigationBlockProvider>
          </AssistantProvider>
        </SessionProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
