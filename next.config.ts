import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.SEVENS_BUILD_DIR || ".next",
  devIndicators: false,
  // Standalone output for the Docker runner stage (07 section 5).
  output: "standalone",
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};

export default nextConfig;
