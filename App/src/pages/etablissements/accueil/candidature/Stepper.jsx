import { Check } from 'lucide-react'

/** Fil d'étapes : les étapes passées sont cliquables, les futures ne le sont pas. */
export default function Stepper({ etapes, courante, maxAtteinte, onAller }) {
  return (
    <nav className="wiz-stepper" aria-label="Progression de la candidature">
      <ol>
        {etapes.map((e, i) => {
          const etat = i < courante ? 'fait' : i === courante ? 'actif' : 'a-venir'
          const cliquable = i <= maxAtteinte && i !== courante
          return (
            <li key={e.id} className={`wiz-step wiz-step--${etat}`} aria-current={i === courante ? 'step' : undefined}>
              <button type="button" disabled={!cliquable} onClick={() => onAller(i)}>
                <span className="wiz-step-n">{etat === 'fait' ? <Check size={14} aria-hidden="true" /> : i + 1}</span>
                <span className="wiz-step-t">{e.titre}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="wiz-progress" role="progressbar" aria-valuemin={1} aria-valuemax={etapes.length} aria-valuenow={courante + 1}>
        <span style={{ width: `${((courante + 1) / etapes.length) * 100}%` }} />
      </div>
    </nav>
  )
}
