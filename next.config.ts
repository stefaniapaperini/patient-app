import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server in .next/standalone, used by the Dockerfile.
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
