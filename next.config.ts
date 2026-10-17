import type { NextConfig } from "next";

// Cache Components stays off: every route is per-request (`dynamic = 'force-dynamic'`), as the spec requires.
const nextConfig: NextConfig = {};

export default nextConfig;
