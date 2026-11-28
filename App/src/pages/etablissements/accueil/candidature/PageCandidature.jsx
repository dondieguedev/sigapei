import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, LogOut, Send } from 'lucide-react'
// ⚠ Chemins d'import à aligner avec ceux de la page d'origine (fichier original non conservé sur le poste de travail).
import AccueilHero from '../../../../components/etablissements/AccueilHero'
import NoticeModal from '../../../../components/commun/NoticeModal'
import { useAccueil } from '../AccueilLayout'
import { lienEtablissement } from '../../../../lib/etablissements/subdomain'
import { getCaptchaToken } from '../../../../lib/identite/captcha'
import { appelsPublicsService } from '../../../../services/inscription/appelsPublics.service'
import { candidaturePubliqueService as api, ErreurCandidature } from '../../../../services/inscription/candidaturePublique.service'
import ResumeAppel from './ResumeAppel'
import Stepper from './Stepper'
import PanneauPaiement from './PanneauPaiement'
import { ChampDynamique, ChampPiece } from './ChampsDynamiques'
import {
  brouillonCle, construireFormData, ecrireBrouillon, effacerBrouillon, erreurContact,
  erreursEtape, etapeDeLErreur, lireBrouillon,
} from './candidatureSchema'
import './candidature.css'

const ETAPE_CONDITIONS = { id: 'conditions', titre: 'Conditions' }

export default function PageCandidature() {
  const { slug, appelUuid: appelParam } = useParams()
  const [qs] = useSearchParams()
  const navigate = useNavigate()
  const [quitter, setQuitter] = useState(false)
  const appelUuid = appelParam ?? qs.get('appel')
  const refRetour = qs.get('ref')
  const accueil = useAccueil?.() ?? {}

  const [appel, setAppel] = useState(null)
  const [chargement, setChargement] = useState(true)
  const [panne, setPanne] = useState('')
  const [idx, setIdx] = useState(0)
  const [maxAtteinte, setMax] = useState(0)
  const [form, setForm] = useState({})
  const [fichiers, setFichiers] = useState({})
  const [erreurs, setErreurs] = useState({})
  const [piege, setPiege] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [notice, setNotice] = useState(null)
  const [depose, setDepose] = useState(refRetour ? { reference: refRetour, retour: true } : null)
  const [brouillonRestaure, setBrouillonRestaure] = useState(false)
  const haut = useRef(null)

  const cleBrouillon = useMemo(() => brouillonCle(slug, appelUuid), [slug, appelUuid])

  useEffect(() => {
    document.body.classList.add('page-public-recaptcha')
    return () => document.body.classList.remove('page-public-recaptcha')
  }, [])

  useEffect(() => {
    if (!appelUuid) { setChargement(false); return }
    let vivant = true
    setChargement(true)
    appelsPublicsService.afficher(appelUuid)
      .then((a) => { if (vivant) { setAppel(a); setPanne('') } })
      .catch((e) => vivant && setPanne(e.message))
      .finally(() => vivant && setChargement(false))
    return () => { vivant = false }
  }, [appelUuid])

  // Restauration du brouillon (texte seulement).
  useEffect(() => {
    if (!appel || depose) return
    const b = lireBrouillon(cleBrouillon)
    if (b?.form) { setForm(b.form); setIdx(Math.min(b.idx ?? 0, 0)); setBrouillonRestaure(true) }
  }, [appel, cleBrouillon, depose])

  useEffect(() => {
    if (!appel || depose) return
    ecrireBrouillon(cleBrouillon, { form, idx })
  }, [form, idx, appel, cleBrouillon, depose])

  const schema = appel?.formulaire
  const etapes = useMemo(() => (schema ? [ETAPE_CONDITIONS, ...schema.etapes] : []), [schema])
  const etape = etapes[idx]
  const ouvert = appel?.accepte_candidatures !== false

  const aller = useCallback((i) => {
    setIdx(i)
    setMax((m) => Math.max(m, i))
    haut.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const majChamp = (nom, v) => {
    setForm((f) => ({ ...f, [nom]: v }))
    setErreurs((e) => { if (!e[nom]) return e; const n = { ...e }; delete n[nom]; return n })
  }
  const majFichier = (id, f) => {
    setFichiers((x) => ({ ...x, [id]: f }))
    setErreurs((e) => { const k = `fichiers.${id}`; if (!e[k]) return e; const n = { ...e }; delete n[k]; return n })
  }

  function erreursDe(et) {
    const e = erreursEtape(et, form, fichiers)
    if (et.id === 'identite') Object.assign(e, erreurContact(schema, form) ?? {})
    return e
  }

  const aSaisi = Object.values(form).some((v) => v) || Object.values(fichiers).some(Boolean)
  function sortir() {
    if (window.history.length > 1) navigate(-1)
    else navigate(lienEtablissement(slug, '/'))
  }
  function demanderSortie() { if (aSaisi) setQuitter(true); else sortir() }

  function suivant() {
    if (etape.id === 'recapitulatif') return
    if (etape.id !== 'conditions') {
      const e = erreursDe(etape)
      if (Object.keys(e).length) { setErreurs(e); haut.current?.scrollIntoView({ behavior: 'smooth' }); return }
    }
    setErreurs({})
    aller(idx + 1)
  }

  async function soumettre() {
    // Revalidation complète avant tout envoi.
    let tout = {}
    schema.etapes.forEach((et) => { if (et.champs || et.pieces) tout = { ...tout, ...erreursDe(et) } })
    if (Object.keys(tout).length) {
      setErreurs(tout)
      const premiere = Object.keys(tout)[0]
      const i = etapeDeLErreur(etapes, premiere)
      aller(i >= 0 ? i : 1)
      return
    }
    setEnvoi(true)
    try {
      const captcha = await getCaptchaToken('candidature_publique')
      const r = await api.soumettreFd(slug, construireFormData({ form, fichiers, appelUuid, captcha, piege }))
      effacerBrouillon(cleBrouillon)
      setDepose({ reference: r.reference, statut: r.statut, paiement: r.statut === 'en_attente_paiement' })
      haut.current?.scrollIntoView({ behavior: 'smooth' })
    } catch (err) {
      if (!(err instanceof ErreurCandidature)) { setNotice({ type: 'error', message: 'Une erreur inattendue est survenue.' }); return }
      if (err.kind === 'validation') {
        const mapped = {}
        Object.entries(err.details || {}).forEach(([k, v]) => { mapped[k] = Array.isArray(v) ? v[0] : String(v) })
        setErreurs(mapped)
        const cle = Object.keys(mapped)[0]
        const i = cle ? etapeDeLErreur(etapes, cle) : -1
        if (i >= 0) aller(i)
      }
      const titre = { captcha: 'Vérification de sécurité', limite: 'Trop de tentatives', conflit: 'Candidature non enregistrée', reseau: 'Connexion' }[err.kind] ?? 'Erreur'
      setNotice({ type: 'error', title: titre, message: err.message })
    } finally {
      setEnvoi(false)
    }
  }

  const urlRetour = typeof window !== 'undefined' && depose?.reference
    ? `${window.location.origin}${window.location.pathname}?appel=${encodeURIComponent(appelUuid)}&ref=${encodeURIComponent(depose.reference)}` : ''

  let corps
  if (chargement) corps = <p className="wiz-muted"><Loader2 size={16} className="wiz-spin" /> Chargement de l'appel…</p>
  else if (panne) corps = <div className="wiz-alert wiz-alert--err">{panne}</div>
  else if (!appel && !depose) corps = <div className="wiz-alert wiz-alert--err">Cet appel à candidature est introuvable ou n'est plus ouvert.</div>
  else if (depose) {
    corps = (
      <section className="wiz-card wiz-done">
        <CheckCircle2 size={40} className="wiz-done-ico" aria-hidden="true" />
        <h2>{depose.paiement || depose.retour ? 'Candidature enregistrée' : 'Candidature envoyée'}</h2>
        <p>Votre référence : <strong className="wiz-ref">{depose.reference}</strong></p>
        <p className="wiz-muted">Conservez-la : elle permet de suivre votre dossier.</p>
        {(depose.paiement || depose.retour) && (
          <PanneauPaiement slug={slug} reference={depose.reference} urlRetour={urlRetour} />
        )}
        <a className="ae2-btn ae2-btn--ghost" href={lienEtablissement(slug, '/')}>Retour à l'accueil</a>
      </section>
    )
  } else if (!ouvert) {
    corps = <div className="wiz-alert wiz-alert--err">Les candidatures ne sont pas ouvertes pour cet appel (période terminée ou places épuisées).</div>
  } else {
    const dernier = etape.id === 'recapitulatif'
    corps = (
      <section className="wiz-card">
        <div className="wiz-topbar">
          <button type="button" className="wiz-quit" onClick={demanderSortie} disabled={envoi}><LogOut size={15} aria-hidden="true" /> Quitter la candidature</button>
        </div>
        {quitter && (
          <div className="wiz-alert wiz-alert--info wiz-confirm" role="alertdialog" aria-label="Quitter la candidature">
            <span>Votre saisie (hors pièces jointes) reste enregistrée dans ce navigateur. Quitter maintenant&nbsp;?</span>
            <span className="wiz-confirm-btns">
              <button type="button" className="ae2-btn ae2-btn--ghost" onClick={() => setQuitter(false)}>Rester</button>
              <button type="button" className="ae2-btn" onClick={sortir}>Quitter</button>
            </span>
          </div>
        )}
        <Stepper etapes={etapes} courante={idx} maxAtteinte={maxAtteinte} onAller={aller} />
        {brouillonRestaure && idx === 0 && (
          <p className="wiz-alert wiz-alert--info">Votre saisie précédente a été restaurée. Les pièces jointes doivent être sélectionnées à nouveau.</p>
        )}
        <h2 className="wiz-h2">{etape.titre}</h2>

        {etape.id === 'conditions' && <ResumeAppel appel={appel} />}

        {(etape.champs ?? []).length > 0 && (
          <div className="wiz-grid">
            {etape.champs.map((c) => <ChampDynamique key={c.nom} champ={c} valeur={form[c.nom]} erreur={erreurs[c.nom]} onChange={(v) => majChamp(c.nom, v)} />)}
          </div>
        )}

        {(etape.pieces ?? []).map((p) => (
          <ChampPiece key={p.id} piece={p} fichier={fichiers[p.id]} erreur={erreurs[`fichiers.${p.id}`]} onChange={(f) => majFichier(p.id, f)} />
        ))}

        {etape.id === 'paiement' && (
          <p>Des frais de <strong>{schema.paiement.montant.toLocaleString('fr-FR')} {schema.paiement.devise === 'XOF' ? 'FCFA' : schema.paiement.devise}</strong> sont dus. Le règlement se fait après l'envoi du dossier ; votre candidature n'est examinée qu'une fois le paiement confirmé.</p>
        )}

        {dernier && <Recapitulatif schema={schema} form={form} fichiers={fichiers} onModifier={aller} etapes={etapes} />}

        {/* Piège anti-robot : invisible, jamais rempli par un humain. */}
        <div className="wiz-hp" aria-hidden="true">
          <label>Site web<input tabIndex={-1} autoComplete="off" value={piege} onChange={(e) => setPiege(e.target.value)} /></label>
        </div>

        <div className="wiz-actions">
          <button type="button" className="ae2-btn ae2-btn--ghost" onClick={() => (idx === 0 ? demanderSortie() : aller(idx - 1))} disabled={envoi}><ArrowLeft size={16} /> {idx === 0 ? 'Retour' : 'Précédent'}</button>
          {dernier ? (
            <button type="button" className="ae2-btn" onClick={soumettre} disabled={envoi}>
              {envoi ? <Loader2 size={16} className="wiz-spin" /> : <Send size={16} />} {schema.paiement.requis ? 'Envoyer et passer au paiement' : 'Envoyer ma candidature'}
            </button>
          ) : (
            <button type="button" className="ae2-btn" onClick={suivant}>Suivant <ArrowRight size={16} /></button>
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="wiz-page" ref={haut}>
      <AccueilHero
        data={accueil?.data}
        slug={slug}
        connecte={accueil?.connecte}
        lienEspace={accueil?.lienEspace}
        mode="page"
        titre={appel?.titre ?? 'Candidature'}
        page="formations"
      />
      <main className="wiz-main">{corps}</main>
      {notice && <NoticeModal type={notice.type} title={notice.title} message={notice.message} duration={8000} onClose={() => setNotice(null)} />}
    </div>
  )
}

function Recapitulatif({ schema, form, fichiers, etapes, onModifier }) {
  return (
    <div className="wiz-recap">
      {schema.etapes.filter((e) => e.champs || e.pieces).map((e) => {
        const i = etapes.findIndex((x) => x.id === e.id)
        return (
          <div className="wiz-recap-bloc" key={e.id}>
            <div className="wiz-recap-head"><h3>{e.titre}</h3><button type="button" className="wiz-link" onClick={() => onModifier(i)}>Modifier</button></div>
            <dl>
              {(e.champs ?? []).map((c) => {
                const v = form[c.nom]
                if (v === undefined || v === '' || v === false) return null
                const aff = c.type === 'attestation' ? 'Confirmé' : c.type === 'choix' ? (c.options.find((o) => o.valeur === v)?.label ?? v) : v
                return <div key={c.nom}><dt>{c.type === 'attestation' ? '' : c.label}</dt><dd>{c.type === 'attestation' ? c.label : aff}</dd></div>
              })}
              {(e.pieces ?? []).map((p) => <div key={p.id}><dt>{p.libelle}</dt><dd>{fichiers[p.id]?.name ?? '-'}</dd></div>)}
            </dl>
          </div>
        )
      })}
    </div>
  )
}