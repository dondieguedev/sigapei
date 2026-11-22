/**
 * AppFooter - Pied de page collé en bas de la zone de contenu.
 *
 * Affiche par défaut le nom de l'application SIGAPEI.
 * Passe `etabNom` pour afficher aussi le nom de l'établissement.
 *
 * Colle au bas : le parent doit être display:flex + flex-direction:column,
 * le footer utilise margin-top:auto pour toujours rester en bas.
 */
import { ENV } from '../../config/commun/env'
import './AppFooter.css'

export default function AppFooter({ etabNom = null }) {
  const year    = new Date().getFullYear()
  const appName = ENV.appName || 'SIGAPEI'

  return (
    <footer className="apf">
      {/* Gauche : app + année */}
      <span className="apf-left">
        <span className="apf-app">{appName}</span>
        {etabNom && (
          <>
            <span className="apf-sep" aria-hidden="true">·</span>
            <span className="apf-etab">{etabNom}</span>
          </>
        )}
        <span className="apf-sep" aria-hidden="true">·</span>
        <span>© {year}</span>
      </span>

      {/* Droite : version / mention */}
      <span className="apf-right">
        Système Intégré de Gestion et d'Administration des Établissements Privés d'Enseignement
      </span>
    </footer>
  )
}
