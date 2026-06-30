import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['172.20.10.2'],
  turbopack: {
    // Explicitly pin the Turbopack workspace root to the project directory
    // to resolve conflicts with lockfiles in parent folders
    root: process.cwd(),
  },
};

export default nextConfig;
