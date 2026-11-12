import type { NextConfig } from "next";
import { apiOrigin } from "./lib/api-origin";
const origin = apiOrigin(process.env.API_ORIGIN, process.env.SAVOIR_CLOUDFLARE_BUILD === "1");
const config: NextConfig = {
  poweredByHeader: false,
  // Studio generation and independent fact checking can each take 60 seconds.
  experimental: { proxyTimeout: 180000 },
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${origin}/v1/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
