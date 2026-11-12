// Usage : npm run db:init
// 1) crée la base indiquée dans DATABASE_URL si elle n'existe pas (connexion à la base « postgres »)
// 2) crée les tables et l'admin initial (ADMIN_USERNAME / ADMIN_PASSWORD, changement obligatoire à la 1re connexion)
import fs from "fs";
import { Client } from "pg";

for (const f of [".env.local", ".env"]) if (fs.existsSync(f)) process.loadEnvFile(f);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant : copiez .env.example en .env.local et renseignez la connexion PostgreSQL.");
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) throw new Error(`Nom de base invalide : « ${dbName} »`);

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
  if (!exists.rowCount) {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Base « ${dbName} » créée.`);
  } else console.log(`Base « ${dbName} » déjà présente.`);
  await admin.end();

  const { initSchema, pool } = await import("../lib/server/db");
  const { adminCreated } = await initSchema();
  console.log("Tables prêtes.");
  if (adminCreated)
    console.log(`Admin initial créé : identifiant « ${adminCreated} », mot de passe = ADMIN_PASSWORD (ou « Admin@2026! » par défaut). Il devra le changer à la première connexion.`);
  else console.log("Un administrateur existe déjà : aucun compte créé.");
  await pool().end();
}

main().catch((e) => {
  console.error("Échec :", e.message);
  process.exit(1);
});
