import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Savoir — AI visibility",
  description: "Understand how your brand appears in AI answers.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: `try{var theme=localStorage.getItem('savoir-theme');document.documentElement.classList.toggle('dark',theme==='dark'||(!theme&&matchMedia('(prefers-color-scheme: dark)').matches))}catch{}` }} />
        {children}
      </body>
    </html>
  );
}
