import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    // Explicitly pin the Turbopack workspace root to the project directory
    // to resolve conflicts with lockfiles in parent folders
    root: process.cwd(),
  },
};

export default nextConfig;
