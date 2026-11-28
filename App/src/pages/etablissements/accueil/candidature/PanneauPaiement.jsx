import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, Clock, CreditCard, Loader2, XCircle } from 'lucide-react'
import { candidaturePubliqueService as api } from '../../../../services/inscription/candidaturePublique.service'
import { formatMontant } from './candidatureSchema'

const INTERVALLE_MS = 5000
const FINAUX = ['payee', 'validee', 'rejetee', 'expiree', 'a_rembourser']

/**
 * Paiement des frais d'une candidature déjà enregistrée (en attente de paiement).
 * Les modes proposés viennent du serveur : uniquement agrégateurs/accords activés pour l'établissement.
 * Le dossier n'avance qu'après confirmation serveur ; ce panneau ne fait que lire le suivi.
 */
export default function PanneauPaiement({ slug, reference, urlRetour, onChange }) {
  const [suivi, setSuivi] = useState(null)
  const [modes, setModes] = useState(null)
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(null)
  const actif = useRef(true)

  const lire = useCallback(async () => {
    try {
      const s = await api.suivi(slug, reference)
      if (!actif.current) return null
      setSuivi(s)
      onChange?.(s)
      return s
    } catch (e) {
      if (actif.current) setErreur(e.message)
      return null
    }
  }, [slug, reference, onChange])

  useEffect(() => {
    actif.current = true
    let timer
    const boucle = async () => {
      const s = await lire()
      const statut = s?.statut_paiement ?? s?.statut
      if (actif.current && !(statut && FINAUX.includes(statut))) timer = setTimeout(boucle, INTERVALLE_MS)
    }
    boucle()
    return () => { actif.current = false; clearTimeout(timer) }
  }, [lire])

  const statutPaiement = suivi?.statut_paiement
  const aPayer = suivi && ['en_attente', 'non_paye', 'initie', null, undefined].includes(statutPaiement) && suivi.statut === 'en_attente_paiement'

  useEffect(() => {
    if (!aPayer || modes) return
    api.modesPaiement(slug, reference).then((m) => actif.current && setModes(Array.isArray(m) ? m : (m?.modes ?? []))).catch((e) => setErreur(e.message))
  }, [aPayer, modes, slug, reference])

  async function payer(mode) {
    setErreur('')
    setEnCours(mode.agregateur)
    try {
      const r = await api.payer(slug, reference, mode.agregateur, urlRetour)
      if (r?.url_paiement) { window.location.assign(r.url_paiement); return }
      setErreur('Ce mode de paiement ne peut pas être ouvert ici. Choisissez-en un autre.')
    } catch (e) {
      setErreur(e.message)
    } finally {
      if (actif.current) setEnCours(null)
    }
  }

  if (!suivi && !erreur) return <p className="wiz-muted"><Loader2 size={16} className="wiz-spin" /> Vérification du paiement…</p>

  if (suivi?.statut === 'expiree') {
    return <div className="wiz-alert wiz-alert--err"><XCircle size={18} /> Le délai de paiement est dépassé : cette candidature a expiré. Vous pouvez déposer un nouveau dossier.</div>
  }
  if (statutPaiement === 'a_rembourser') {
    return <div className="wiz-alert wiz-alert--err"><XCircle size={18} /> Votre paiement est bien arrivé, mais votre dossier n'a plus pu être retenu. Un remboursement sera traité ; conservez votre référence.</div>
  }
  if (statutPaiement === 'payee' || ['soumise', 'validee', 'rejetee'].includes(suivi?.statut)) {
    return <div className="wiz-alert wiz-alert--ok"><CheckCircle2 size={18} /> Paiement confirmé. Votre candidature est enregistrée et sera étudiée.</div>
  }

  return (
    <div className="wiz-pay">
      {suivi?.montant_du > 0 && <p className="wiz-pay-amount">{formatMontant(suivi.montant_du, suivi.devise_paiement)}</p>}
      {suivi?.paiement_expire_le && <p className="wiz-muted"><Clock size={14} /> À régler avant le {new Date(suivi.paiement_expire_le).toLocaleString('fr-FR')}.</p>}
      {statutPaiement === 'initie' && <p className="wiz-muted"><Loader2 size={14} className="wiz-spin" /> Paiement en cours de confirmation…</p>}
      {erreur && <p className="ap-error" role="alert">{erreur}</p>}
      {modes === null ? <p className="wiz-muted"><Loader2 size={14} className="wiz-spin" /> Chargement des modes de paiement…</p>
        : modes.length === 0 ? <p className="ap-error">Aucun mode de paiement n'est disponible pour le moment. Réessayez plus tard avec votre référence.</p>
        : (
          <ul className="wiz-modes">
            {modes.map((m) => (
              <li key={m.agregateur + (m.mode ?? '')}>
                <button type="button" className="ae2-btn" disabled={!!enCours} onClick={() => payer(m)}>
                  {enCours === m.agregateur ? <Loader2 size={16} className="wiz-spin" /> : <CreditCard size={16} />} {m.libelle ?? m.nom ?? m.agregateur}
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}