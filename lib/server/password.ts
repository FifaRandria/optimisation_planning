// Hachage des mots de passe (scrypt, sel aléatoire) et règles de robustesse.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "crypto";

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));

const N = 16384;
const R = 8;
const P = 1;
const LEN = 64;

/** Format : scrypt$N$r$p$selBase64$hashBase64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Message d'erreur si le mot de passe est trop faible, sinon null. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Le mot de passe doit contenir au moins 10 caractères.";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) return "Le mot de passe doit contenir des minuscules et des majuscules.";
  if (!/\d/.test(pw)) return "Le mot de passe doit contenir au moins un chiffre.";
  return null;
}

/** Mot de passe provisoire lisible (sans caractères ambigus), conforme à passwordProblem. */
export function temporaryPassword(): string {
  const up = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const low = "abcdefghijkmnpqrstuvwxyz";
  const dig = "23456789";
  const pick = (s: string, n: number) => Array.from(randomBytes(n), (b) => s[b % s.length]).join("");
  return `${pick(up, 2)}${pick(low, 5)}-${pick(dig, 4)}`;
}
