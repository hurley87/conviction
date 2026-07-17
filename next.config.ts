import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@conviction/mcp"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.dicebear.com" },
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "abs.twimg.com" },
    ],
  },
};

export default nextConfig;
