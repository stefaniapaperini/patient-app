import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server in .next/standalone, used by the Dockerfile.
  output: "standalone",
  poweredByHeader: false,
  // Hide the Next.js "N" button shown in development; compile and runtime errors still appear.
  devIndicators: false,
};

export default nextConfig;
