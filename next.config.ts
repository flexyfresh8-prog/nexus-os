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
      async headers() {
        return [
          {
            // Under COEP (set by middleware on the app), an embedded document
            // without its own COEP header fails the embedding check — the
            // preview shell would render as an empty frame. It still gets NO
            // CSP/XFO (see src/middleware.ts): a plain network response keeps
            // its policy container empty so sandboxed user code can run.
            source: "/preview-shell.html",
            headers: [
              { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
            ],
          },
        ];
      },
      // COOP/COEP for the app shell + the production CSP come from
      // src/middleware.ts, so dev mode can keep HMR eval while production
      // stays locked down. Headers are not duplicated for "/": double COEP
      // headers break cross-origin isolation.
    };

export default nextConfig;
