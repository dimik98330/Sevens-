import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/ui/SiteHeader";
import { SessionProvider } from "@/features/shared/session";
import ru from "@/locales/ru.json";

export const metadata: Metadata = {
  title: "Идеи для региона — цифровые решения для области Абай",
  description:
    "Прототип хакатона: житель предлагает цифровое решение, сотрудник рассматривает идею. Маршруты демонстрационные.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <a className="skip-link" href="#main">
          Перейти к содержанию
        </a>
        <div className="demo-banner" role="note" aria-label="Демонстрационный баннер">
          {ru.demoBanner}
        </div>
        <SessionProvider>
          <SiteHeader />
          <main id="main" className="page">
            {children}
          </main>
          <footer className="footer">
            <div className="footer-inner">
              <p>
                <strong>Идеи для региона.</strong> {ru.tagline}
              </p>
              <p className="muted">
                Прототип хакатона. Идея регистрируется на платформе и направляется в демонстрационную очередь.
                Официальная регистрация обращения, eOtinish/eGov и ЭЦП в MVP отсутствуют.
              </p>
            </div>
          </footer>
        </SessionProvider>
      </body>
    </html>
  );
}
