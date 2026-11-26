import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Patient Management",
  description: "Manage patients on a FHIR R4 server",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden>✚</span> Patient Management
          </Link>
          <span className="topbar-note">FHIR R4</span>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
