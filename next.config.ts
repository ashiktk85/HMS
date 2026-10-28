import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Guest ID scans are uploaded through server actions (default limit is 1MB).
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
