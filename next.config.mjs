/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["exceljs", "xlsx"],
  },
};
export default nextConfig;
