import { CalendarDays, ClipboardList, FileText, Wallet, Users } from 'lucide-react'
import { formatDateHeure, formatMontant, tailleLisible } from './candidatureSchema'

/**
 * Exigences d'un appel : critères, pièces (format, caractère obligatoire), frais, dates, places.
 * Lit exclusivement `appel.formulaire`, calculé par le serveur. Réutilisable par la page du cycle.
 */
export default function ResumeAppel({ appel, compact = false }) {
  const f = appel?.formulaire
  if (!f) return null
  const vus = new Set()
  const criteres = (f.criteres ?? []).filter((c) => {
    if (/^Aucune limite d'âge\.?$/i.test(c.description || '')) return false
    const k = c.description
    if (vus.has(k)) return false
    vus.add(k)
    return true
  })
  const pieces = f.pieces ?? []

  return (
    <div className={`wiz-resume${compact ? ' wiz-resume--compact' : ''}`}>
      <div className="wiz-resume-grid">
        {(f.dates?.debut || f.dates?.fin) && (
          <div className="wiz-fact">
            <CalendarDays size={18} aria-hidden="true" />
            <div>
              <p className="wiz-fact-k">Période de candidature</p>
              <p className="wiz-fact-v">
                {f.dates.debut ? `Du ${formatDateHeure(f.dates.debut)}` : ''}
                {f.dates.fin ? ` au ${formatDateHeure(f.dates.fin)}` : ''}
              </p>
            </div>
          </div>
        )}
        <div className="wiz-fact">
          <Wallet size={18} aria-hidden="true" />
          <div>
            <p className="wiz-fact-k">Frais de dossier</p>
            <p className="wiz-fact-v">
              {f.paiement?.requis ? formatMontant(f.paiement.montant, f.paiement.devise) : 'Gratuit'}
            </p>
          </div>
        </div>
        {f.places_disponibles !== null && f.places_disponibles !== undefined && (
          <div className="wiz-fact">
            <Users size={18} aria-hidden="true" />
            <div>
              <p className="wiz-fact-k">Places restantes</p>
              <p className="wiz-fact-v">{f.places_disponibles}</p>
            </div>
          </div>
        )}
      </div>

      <section className="wiz-block">
        <h3 className="wiz-block-title"><ClipboardList size={16} aria-hidden="true" /> Conditions d'éligibilité</h3>
        {criteres.length === 0 ? (
          <p className="wiz-muted">Aucune condition particulière.</p>
        ) : (
          <ul className="wiz-list">
            {criteres.map((c) => (
              <li key={c.id}>
                <span>{c.description}</span>
                <span className={`wiz-tag ${c.obligatoire ? 'wiz-tag--req' : ''}`}>{c.obligatoire ? 'Obligatoire' : 'Facultatif'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="wiz-block">
        <h3 className="wiz-block-title"><FileText size={16} aria-hidden="true" /> Pièces à fournir</h3>
        {pieces.length === 0 ? (
          <p className="wiz-muted">Aucune pièce à joindre.</p>
        ) : (
          <ul className="wiz-list">
            {pieces.map((p) => (
              <li key={p.id}>
                <span>
                  {p.libelle}
                  <small className="wiz-muted"> · {p.formats.join(' / ')} · {tailleLisible(p.taille_max_octets)} max</small>
                </span>
                <span className={`wiz-tag ${p.obligatoire ? 'wiz-tag--req' : ''}`}>{p.obligatoire ? 'Obligatoire' : 'Facultative'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}