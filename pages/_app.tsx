import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { SessionProvider, useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect } from "react";
import Layout from "@/components/layout/Layout";
import { Toaster } from "sonner";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { ThemeProvider, useTheme } from "@/lib/context/ThemeContext";
import { Inter } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const PUBLIC_PATHS = ["/login"];

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session && !PUBLIC_PATHS.includes(router.pathname)) {
      router.replace("/login");
    }
  }, [session, status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center">
        <span className="loading loading-spinner loading-sm text-base-content/40" />
      </div>
    );
  }

  if (!session && !PUBLIC_PATHS.includes(router.pathname)) return null;

  return <>{children}</>;
}

function AppWithToaster({ Component, pageProps }: { Component: any; pageProps: any }) {
  const { theme } = useTheme();
  return (
    <>
      <Component {...pageProps} />
      <Toaster theme={theme === "light" ? "light" : "dark"} position="bottom-right" />
    </>
  );
}

export default function App({ Component, pageProps: { session, ...pageProps } }: AppProps) {
  return (
    <div className={`${inter.className} ${inter.variable} min-h-screen font-sans`}>
      <SessionProvider session={session}>
        <ThemeProvider>
          <LanguageProvider>
            <AuthGuard>
              <Layout>
                <AppWithToaster Component={Component} pageProps={pageProps} />
              </Layout>
            </AuthGuard>
          </LanguageProvider>
        </ThemeProvider>
      </SessionProvider>
    </div>
  );
}
