const isDev = process.env.NODE_ENV !== "production";
// Next.js dev (React Refresh / HMR) needs 'unsafe-eval'; production does not.
const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Internal packages export TypeScript source; Next transpiles them.
  transpilePackages: [
    "@oratlas/config",
    "@oratlas/contracts",
    "@oratlas/db",
    "@oratlas/extractor",
    "@oratlas/github",
    "@oratlas/knowledge",
    "@oratlas/trust",
    "@oratlas/ui",
    "@oratlas/zenodo",
  ],
  eslint: {
    // Linting is run separately via the root eslint config in CI.
    ignoreDuringBuilds: true,
  },
  // Internal packages and app code import sibling modules with a ".js" suffix
  // (NodeNext/Bundler TS convention). Teach webpack to resolve those to the
  // real ".ts"/".tsx" source files.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src ${scriptSrc}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
