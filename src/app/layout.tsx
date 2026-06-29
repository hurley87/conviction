import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "Conviction — Trade across every chain";
const description =
  "Trade your Solana, Base, and Arbitrum assets from one balance — no bridging. Post the trades you believe in, and let anyone back them from any chain. Powered by Particle Network Universal Accounts.";

export const metadata: Metadata = {
  metadataBase: new URL("https://getconviction.xyz"),
  title,
  description,
  openGraph: {
    title,
    description,
    siteName: "Conviction",
    type: "website",
    images: [
      {
        url: "/conviction-og.jpg",
        width: 1731,
        height: 909,
        alt: "Conviction — trade & share convictions across Solana, Base, and Arbitrum",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/conviction-og.jpg"],
  },
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
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
