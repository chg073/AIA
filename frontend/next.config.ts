import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow external images from financial data sources
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
};

export default nextConfig;
