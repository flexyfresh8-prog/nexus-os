import type { NextConfig } from "next";

// Local sandbox dev  → standalone server (managed dev server, port 3000)
// GitHub Pages build → fully static export under /<repo>/ (DEPLOY_TARGET=gh-pages)
const isPages = process.env.DEPLOY_TARGET === "gh-pages";
const repoName = process.env.GH_REPO_NAME || "nexus-os";

const nextConfig: NextConfig = isPages
  ? {
      output: "export",
      basePath: `/${repoName}`,
      trailingSlash: true,
      images: { unoptimized: true },
      typescript: { ignoreBuildErrors: true },
      reactStrictMode: false,
    }
  : {
      output: "standalone",
      typescript: { ignoreBuildErrors: true },
      reactStrictMode: false,
    };

export default nextConfig;
