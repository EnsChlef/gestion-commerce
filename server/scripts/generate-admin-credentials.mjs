import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const rl = createInterface({ input: stdin, output: stdout });
try {
  const username = (await rl.question("Identifiant administrateur : ")).trim();
  const password = await rl.question("Mot de passe (12 caractères minimum) : ");
  const confirmation = await rl.question("Confirmer le mot de passe : ");
  if (!username) throw new Error("L’identifiant ne peut pas être vide.");
  if (password.length < 12) throw new Error("Choisissez un mot de passe d’au moins 12 caractères.");
  if (password !== confirmation) throw new Error("Les deux mots de passe ne correspondent pas.");

  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  const secret = randomBytes(48).toString("hex");
  stdout.write("\nCopiez ces lignes dans server/.env (ne les publiez pas) :\n\n");
  stdout.write(`ADMIN_USERNAME=${JSON.stringify(username)}\n`);
  stdout.write(`ADMIN_PASSWORD_SALT=${JSON.stringify(salt)}\n`);
  stdout.write(`ADMIN_PASSWORD_HASH=${JSON.stringify(hash)}\n`);
  stdout.write(`SESSION_SECRET=${JSON.stringify(secret)}\n`);
} finally {
  rl.close();
}
