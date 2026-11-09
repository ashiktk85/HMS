import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let the dev server (hot reload) be reached through an ngrok tunnel. Dev only; no effect in production.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.io", "*.ngrok.app"],
  experimental: {
    // Guest ID scans are uploaded through server actions (default limit is 1MB).
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
