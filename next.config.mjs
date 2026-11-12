import fs from "node:fs";
import path from "node:path";

/**
 * Paquets qui déclarent une entrée « module-sync » (fichier .mjs chargé par Node 22+ via require).
 * Le traçage du mode standalone ne les détecte pas : on les inclut explicitement.
 * (ex. async-function, generator-function : dépendances indirectes d'exceljs)
 */
function moduleSyncPackages() {
  const root = path.resolve("node_modules");
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const d of fs.readdirSync(root)) {
    const names = d.startsWith("@") ? fs.readdirSync(path.join(root, d)).map((x) => `${d}/${x}`) : [d];
    for (const name of names) {
      try {
        if (fs.readFileSync(path.join(root, name, "package.json"), "utf8").includes('"module-sync"')) out.push(`./node_modules/${name}/**/*`);
      } catch {
        /* pas un paquet */
      }
    }
  }
  return out;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // image Docker légère : serveur autonome sans node_modules complet (.next/standalone)
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["exceljs", "xlsx", "pg"],
    outputFileTracingIncludes: { "/**": moduleSyncPackages() },
  },
};
export default nextConfig;
