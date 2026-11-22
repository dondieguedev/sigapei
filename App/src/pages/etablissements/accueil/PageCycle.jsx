import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  GraduationCap, CalendarDays, Clock, Users,
  CheckCircle2, FileText, Paperclip,
} from 'lucide-react'
import AccueilHero from '../../../components/etablissements/AccueilHero'
import CycleIllustration from '../../../components/etablissements/CycleIllustration'
import AppelIllustration from '../../../components/etablissements/AppelIllustration'
import PageBanner from '../../../components/etablissements/PageBanner'
import { useAccueil } from './AccueilLayout'
import { appelsPublicsService } from '../../../services/inscription/appelsPublics.service'
import usePageTitle from '../../../hooks/commun/usePageTitle'
import './PageCycle.css'

const CYCLE_LABELS = {
  maternelle:    'Maternelle',
  primaire:      'Primaire',
  secondaire:    'Secondaire',
  universitaire: 'Université',
}

function datesFr(iso) {
  if (!iso) return '-'
  // Parser sans conversion UTC→local pour éviter le décalage horaire
  const normalized = iso.replace(' ', 'T').replace(/Z$/, '').slice(0, 16) // "2026-11-19T12:31"
  const [datePart, timePart] = normalized.split('T')
  if (!datePart) return iso
  const [year, month, day] = datePart.split('-')
  const moisFr = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  const moisLabel = moisFr[parseInt(month, 10) - 1] ?? month
  const heure = timePart ? ` à ${timePart}` : ''
  return `${parseInt(day, 10)} ${moisLabel} ${year}${heure}`
}

function statutAppel(appel) {
  const now   = new Date()
  const debut = appel.date_debut ? new Date(appel.date_debut) : null
  const fin   = appel.date_fin   ? new Date(appel.date_fin)   : null
  const s     = appel.statut

  if (s === 'termine' || s === 'annule') return 'termine'
  if (fin && now > fin) return 'termine'
  if (debut && now < debut) return 'bientot'
  if (s === 'ouvert') return 'ouvert'
  if ((s === 'brouillon' || s === 'planifie') && debut && now >= debut) return 'ouvert'
  if (s === 'brouillon' || s === 'planifie') return 'bientot'
  return 'termine'
}

/* ── Rendu lisible de la VALEUR d'un critère ── */
function renderCritereValeur(critere) {
  // Le backend peut renvoyer la valeur sous différents champs
  const v =
    critere.valeur ??
    critere.value ??
    critere.valeurs ??
    critere.plage ??
    critere.date_min ??
    null

  if (v === null || v === undefined || v === '') {
    // fallback : afficher les champs utiles s'ils existent
    const fallback = []
    if (critere.type_inscription) fallback.push(critere.type_inscription)
    if (critere.date_naissance_min || critere.date_naissance_max) {
      fallback.push(
        `${critere.date_naissance_min ?? '?'} → ${critere.date_naissance_max ?? '?'}`
      )
    }
    if (critere.age_min != null || critere.age_max != null) {
      fallback.push(`${critere.age_min ?? '?'} – ${critere.age_max ?? '?'} ans`)
    }
    if (fallback.length) return fallback.join(' • ')
    return null
  }

  // Tableau de valeurs
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)))
      .join(' • ')
  }
  // Objet { min, max }
  if (typeof v === 'object') {
    if ('min' in v || 'max' in v) return `${v.min ?? '?'} → ${v.max ?? '?'}`
    if ('debut' in v || 'fin' in v) return `${v.debut ?? '?'} → ${v.fin ?? '?'}`
    return Object.entries(v).map(([k, val]) => `${k}: ${val}`).join(' • ')
  }
  return String(v)
}

/* ── Bloc critères (libellé + valeur) ── */
function CriteresList({ criteres }) {
  if (!Array.isArray(criteres) || criteres.length === 0) return null

  return (
    <div className="pc-appel-bloc">
      <h4 className="pc-appel-bloc-titre">
        <CheckCircle2 size={14} /> Critères d'éligibilité
      </h4>
      <ul className="pc-appel-liste">
        {criteres.map((c, i) => {
          const valeur = renderCritereValeur(c)
          return (
            <li key={i}>
              <span className="pc-critere-libelle">{c.label ?? c.type ?? 'Critère'}</span>
              {valeur && (
                <span className="pc-critere-valeur">
                  <strong>{valeur}</strong>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ── Bloc pièces (libellé + format + obligatoire) ── */
function PiecesList({ pieces }) {
  if (!Array.isArray(pieces) || pieces.length === 0) return null

  return (
    <div className="pc-appel-bloc">
      <h4 className="pc-appel-bloc-titre">
        <Paperclip size={14} /> Pièces à fournir
      </h4>
      <ul className="pc-appel-liste">
        {pieces.map((p, i) => (
          <li key={i}>
            <span className="pc-piece-libelle">
              <FileText size={12} />
              {p.libelle ?? 'Document'}
              <span
                className={`pc-piece-tag ${
                  p.obligatoire
                    ? 'pc-piece-tag--obligatoire'
                    : 'pc-piece-tag--facultatif'
                }`}
              >
                {p.obligatoire ? 'Obligatoire' : 'Facultatif'}
              </span>
            </span>
            {p.format && (
              <span className="pc-piece-meta">Format : {p.format}</span>
            )}
            {p.description && (
              <span className="pc-piece-meta">{p.description}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ── Skeleton card ── */
function SkeletonCard() {
  return (
    <div className="pc-appel-card" style={{ gap: 14 }}>
      <div className="ap-skel" style={{ height: 20, width: '40%', borderRadius: 6 }} />
      <div className="ap-skel" style={{ height: 24, width: '85%', borderRadius: 6 }} />
      <div className="ap-skel" style={{ height: 16, width: '70%', borderRadius: 6 }} />
      <div className="ap-skel" style={{ height: 16, width: '55%', borderRadius: 6 }} />
      <div className="ap-skel" style={{ height: 40, width: 140, borderRadius: 8, marginTop: 8 }} />
    </div>
  )
}

export default function PageCycle() {
  const { slug, cycle } = useParams()
  const { data, connecte, lienEspace } = useAccueil()
  const navigate = useNavigate()

  const [appels,  setAppels]  = useState([])
  const [loading, setLoading] = useState(true)

  const cycleLabel = CYCLE_LABELS[cycle] ?? cycle
  usePageTitle(`${cycleLabel} - ${data?.nom ?? ''}`)

  const base = slug ? `/etablissements/${slug}` : ''

  useEffect(() => {
    if (!slug || !cycle) return
    let annule = false
    setLoading(true)
    setAppels([])

    appelsPublicsService.listerTous(null, slug)
      .then((liste) => {
        if (annule) return
        const filtres = (Array.isArray(liste) ? liste : [])
          .filter((a) => a.cycle === cycle && statutAppel(a) !== 'termine')
          .sort((a, b) => {
            const sa = statutAppel(a) === 'ouvert' ? 0 : 1
            const sb = statutAppel(b) === 'ouvert' ? 0 : 1
            return sa - sb
          })
        setAppels(filtres)
      })
      .catch(() => { if (!annule) setAppels([]) })
      .finally(() => { if (!annule) setLoading(false) })

    return () => { annule = true }
  }, [slug, cycle])

  return (
    <>
      <AccueilHero
        data={data} slug={slug} connecte={connecte} lienEspace={lienEspace}
        mode="page" titre={cycleLabel} page="formations"
      />
      <PageBanner
        titre={cycleLabel}
        fil={[
          { label: data?.nom ?? 'Accueil', href: base || '/' },
          { label: 'Formations', href: `${base}/formations` },
          { label: cycleLabel },
        ]}
        retour={`${base}/formations`}
      />

      <section className="ae2-section" style={{ minHeight: '50vh' }}>
        <div className="ae2-container">

          <div className="ae2-section-head">
            <div style={{ marginBottom: 16 }}>
              <CycleIllustration cycle={cycle} size={100} />
            </div>
            <h2 className="ae2-section-titre">
              <span className="ae2-accent">{cycleLabel}</span>
            </h2>
            <p className="ae2-section-sous">Appels à candidature disponibles pour ce cycle</p>
            <div className="ae2-section-barre" />
          </div>

          {loading ? (
            <div className="pc-appels-grid">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : appels.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--sg-text-muted)' }}>
              <GraduationCap size={40} style={{ marginBottom: 12 }} />
              <p>Aucune campagne de recrutement en cours pour ce cycle.</p>
            </div>
          ) : (
            <div className="pc-appels-grid">
              {appels.map((appel, i) => {
                const statut    = statutAppel(appel)
                const estOuvert = statut === 'ouvert'
                return (
                  <article
                    key={appel.uuid ?? i}
                    className={`pc-appel-card ${
                      estOuvert ? 'pc-appel-card--ouvert' : 'pc-appel-card--bientot'
                    }`}
                  >
                    {/* Illustration + badge statut en haut à droite */}
                    <div className="pc-appel-illu">
                      <AppelIllustration
                        titre={appel.titre ?? ''}
                        cycle={cycle}
                        index={i}
                        size={100}
                      />
                      <span
                        className={`pc-appel-badge ${
                          estOuvert ? 'pc-appel-badge--ouvert' : 'pc-appel-badge--bientot'
                        }`}
                      >
                        {estOuvert ? '● Ouvert' : '○ Bientôt disponible'}
                      </span>
                    </div>

                    <h3 className="pc-appel-titre">
                      {appel.titre ?? `Appel - ${cycleLabel}`}
                    </h3>

                    {appel.description && (
                      <p className="pc-appel-desc">{appel.description}</p>
                    )}

                    <div className="pc-appel-dates">
                      <div className="pc-appel-date">
                        <CalendarDays size={14} />
                        <span>Ouverture : <strong>{datesFr(appel.date_debut)}</strong></span>
                      </div>
                      {appel.date_fin && (
                        <div className="pc-appel-date">
                          <Clock size={14} />
                          <span>Clôture : <strong>{datesFr(appel.date_fin)}</strong></span>
                        </div>
                      )}
                    </div>

                    {/* Critères + valeurs */}
                    <CriteresList criteres={appel.criteres_eligibilite} />

                    {/* Pièces + format + obligatoire */}
                    <PiecesList pieces={appel.pieces_fournir} />

                    {appel.est_payant && appel.montant && Number(appel.montant) > 0 && (
                      <p className="pc-appel-frais">
                        Frais de dossier :{' '}
                        <strong>
                          {Number(appel.montant).toLocaleString('fr-FR')}{' '}
                          {appel.devise ?? 'FCFA'}
                        </strong>
                      </p>
                    )}

                    {estOuvert ? (
                      <button
                        type="button"
                        className="pc-appel-btn pc-appel-btn--candidater"
                        onClick={() => navigate(`${base}/candidature?appel=${appel.uuid}`)}
                      >
                        <Users size={15} /> Candidater
                      </button>
                    ) : statut === 'bientot' ? (
                      <span
                        className="pc-appel-btn pc-appel-btn--bientot"
                        aria-disabled="true"
                        title={`Ouverture le ${datesFr(appel.date_debut)}`}
                      >
                        <Clock size={15} /> Pas encore ouvert
                      </span>
                    ) : (
                      <span
                        className="pc-appel-btn pc-appel-btn--termine"
                        aria-disabled="true"
                        title="Cet appel est clôturé"
                      >
                        <Clock size={15} /> Clôturé
                      </span>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </>
  )
}