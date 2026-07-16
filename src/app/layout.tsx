import type { Metadata } from "next";
import { Newsreader, Manrope, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// Pocket-Therapy type system: Newsreader (display serif, with italic accent),
// Manrope (body), JetBrains Mono (mono). Exposed as CSS variables consumed by
// globals.css.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const title = "Conviction — Back the reasoning, not the noise";
const description =
  "Discover curated tokens across crypto, read other people's revealed positions and reasoning, and decide what deserves your backing.";

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
        alt: "Conviction — back the reasoning, not the noise",
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
      className={`${newsreader.variable} ${manrope.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
