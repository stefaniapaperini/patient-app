import type { Metadata } from "next";
import Link from "next/link";
import { InspectorPanel } from "@/components/inspector/InspectorPanel";
import { InspectorToggle } from "@/components/inspector/InspectorToggle";
import { OverviewButton } from "@/components/OverviewDialog";
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
            {/* A pulse line rather than a cross: a "+" here reads as the "+ New patient" button. */}
            <svg className="brand-mark" aria-hidden viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="2 12 6 12 9 5 13 19 16 12 22 12" />
            </svg>
            Patient Management
          </Link>
          <div className="topbar-tools">
            <OverviewButton />
            <InspectorToggle />
          </div>
        </header>
        <main className="container">{children}</main>
        <InspectorPanel />
      </body>
    </html>
  );
}
