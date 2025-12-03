import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // 🚫 Don’t run ESLint during `next build` (Vercel deploys)
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
