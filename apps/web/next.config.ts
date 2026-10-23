import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Los motores son paquetes TypeScript del monorepo: Next los compila desde el código fuente.
  transpilePackages: [
    "@nutriduo/domain",
    "@nutriduo/menu-engine",
    "@nutriduo/nutrition-engine",
    "@nutriduo/portion-engine",
    "@nutriduo/shopping-engine",
  ],
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
