import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "EthAum Model — AI coordination engine",
  description:
    "Document organisation, qualification, provider matching, quote auditing and reminders for the EthAum marketplace. Rules-guaranteed, LLM-assisted, never diagnostic.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable} h-full`}>
      <body className="min-h-full font-sans bg-oat text-charcoal">{children}</body>
    </html>
  );
}
