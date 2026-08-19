import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="es" data-theme="light">
      <Head>
        <link rel="icon" type="image/png" href="/logo-icon.png?v=2" />
        <link rel="icon" type="image/x-icon" href="/favicon.ico?v=2" />
        <link rel="shortcut icon" href="/favicon.ico?v=2" />
        <link rel="apple-touch-icon" href="/logo-icon.png?v=2" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body className="min-h-screen bg-base-100 text-base-content antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
