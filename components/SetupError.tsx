// Page affichée quand la base de données n'est pas joignable ou pas configurée (composant serveur).
import { IconAlert } from "./Icons";

export default function SetupError({ message }: { message: string }) {
  const missingUrl = /DATABASE_URL/.test(message);
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 620 }}>
        <div className="callout err" style={{ marginTop: 0 }}>
          <IconAlert size={18} />
          <span>
            <b>Base de données indisponible.</b> {message}
          </span>
        </div>
        <h2 style={{ marginTop: 18 }}>Pour démarrer</h2>
        <ol className="steps-list">
          {missingUrl && (
            <li>
              Copiez <code>.env.example</code> en <code>.env.local</code> et renseignez <code>DATABASE_URL</code> (utilisateur, mot de passe et nom de la base PostgreSQL).
            </li>
          )}
          <li>Vérifiez que le service PostgreSQL est démarré et accepte les connexions.</li>
          <li>
            Lancez <code>npm run db:init</code> : crée la base, les tables et le compte administrateur initial.
          </li>
          <li>Redémarrez l'application, puis rechargez cette page.</li>
        </ol>
      </div>
    </div>
  );
}
