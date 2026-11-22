/**
 * PanneauClasses - Classes concrètes selon la structure pédagogique par cycle.
 *
 * Corrections :
 *  - Chargements indépendants via Promise.allSettled (un échec n'efface pas le reste)
 *  - État de chargement dédié dans la modale (spinners sur chaque select)
 *  - Retry automatique sur les données du formulaire si elles sont vides
 *  - Messages d'erreur précis par type de donnée manquante
 */
import { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { Plus, X, Layers, AlertTriangle, Info, CheckCircle2, RefreshCw, AlertCircle } from 'lucide-react'
import { useNotify } from '../../../context/commun/NotifyContext'
import {
  classesService,
  niveauxService,
  subdivisionsService,
  seriesService,
} from '../../../services/etablissements/configurationAcademique.service'
import Loader from '../../../components/commun/Loader'

const CYCLE_LABEL = {
  maternelle: 'Maternelle',
  primaire: 'Primaire',
  secondaire: 'Secondaire',
  universitaire: 'Université',
}

/* ── Helpers ── */
const extraire = (r) => r?.data ?? r?.donnees ?? (Array.isArray(r) ? r : [])

export default function PanneauClasses({ anneeActive, onTerminee, cycleFiltre, cycleObj, cyclesDisponibles = [] }) {
  const notify = useNotify()

  /* ── Données principales ── */
  const [classes,     setClasses]     = useState([])
  const [niveaux,     setNiveaux]     = useState([])
  const [subs,        setSubs]        = useState([])
  const [series,      setSeries]      = useState([])
  const [filtreCycle, setFiltreCycle] = useState(cycleFiltre || '')

  /* ── États de chargement séparés ── */
  const [chargeClasses,  setChargeClasses]  = useState(false)
  const [chargeNiveaux,  setChargeNiveaux]  = useState(false)
  const [chargeSubs,     setChargeSubs]     = useState(false)
  const [chargeSeries,   setChargeSeries]   = useState(false)

  /* ── Erreurs par donnée ── */
  const [errNiveaux,  setErrNiveaux]  = useState(null)
  const [errSubs,     setErrSubs]     = useState(null)
  const [errSeries,   setErrSeries]   = useState(null)

  /* ── Modale ── */
  const [modale,  setModale]  = useState(false)
  const [enCours, setEnCours] = useState(false)

  const [form, setForm] = useState({
    annee_uuid: '',
    cycle: 'primaire',
    niveau_uuid: '',
    subdivision_uuid: '',
    serie_uuid: '',
    classe_unique_promotion: false,
    mode_numerotation: 'alphabetique',
    suffixe_classe: 'A',
    nom: '',
    sigle: '',
    effectif_previsionnel: '',
  })
  const [erreurs, setErreurs] = useState({})

  /* ════════════════════════════════════════════
     CHARGEMENTS INDÉPENDANTS
  ════════════════════════════════════════════ */

  /** Classes - indépendant */
  const chargerClasses = useCallback(async () => {
    if (!anneeActive) return
    setChargeClasses(true)
    try {
      const params = { annee_uuid: anneeActive.uuid }
      if (filtreCycle) params.cycle = filtreCycle
      const r = await classesService.lister(params)
      const cls = extraire(r)
      setClasses(cls)
      if (cls.length > 0 && typeof onTerminee === 'function') onTerminee('classes')
    } catch (err) {
      notify.fromError(err)
    } finally {
      setChargeClasses(false)
    }
  }, [anneeActive, filtreCycle, notify, onTerminee])

  /** Niveaux - indépendant, utilisé aussi dans la modale */
  const chargerNiveaux = useCallback(async () => {
    if (!anneeActive) return
    setChargeNiveaux(true)
    setErrNiveaux(null)
    try {
      const r = await niveauxService.lister(filtreCycle || {})
      setNiveaux(extraire(r))
    } catch (err) {
      setErrNiveaux(err?.message ?? 'Impossible de charger les niveaux.')
      setNiveaux([])
    } finally {
      setChargeNiveaux(false)
    }
  }, [anneeActive, filtreCycle])

  /** Subdivisions (groupes) - indépendant */
  const chargerSubs = useCallback(async () => {
    if (!anneeActive) return
    setChargeSubs(true)
    setErrSubs(null)
    try {
      const r = await subdivisionsService.lister({ annee_uuid: anneeActive.uuid })
      setSubs(extraire(r))
    } catch (err) {
      setErrSubs(err?.message ?? 'Impossible de charger les groupes.')
      setSubs([])
    } finally {
      setChargeSubs(false)
    }
  }, [anneeActive])

  /** Séries - indépendant */
  const chargerSeries = useCallback(async () => {
    if (!anneeActive) return
    setChargeSeries(true)
    setErrSeries(null)
    try {
      const r = await seriesService.lister(filtreCycle || {})
      setSeries(extraire(r))
    } catch (err) {
      setErrSeries(err?.message ?? 'Impossible de charger les séries.')
      setSeries([])
    } finally {
      setChargeSeries(false)
    }
  }, [anneeActive, filtreCycle])

  /** Tout charger en parallèle - chaque appel est indépendant */
  const chargerTout = useCallback(() => {
    chargerClasses()
    chargerNiveaux()
    chargerSubs()
    chargerSeries()
  }, [chargerClasses, chargerNiveaux, chargerSubs, chargerSeries])

  useEffect(() => {
    chargerTout()
  }, [chargerTout])

  /* ════════════════════════════════════════════
     CALCUL DYNAMIQUE SIGLE / NOM
  ════════════════════════════════════════════ */

  const niveauSelectionne   = useMemo(() => niveaux.find((n) => n.uuid === form.niveau_uuid) || null, [niveaux, form.niveau_uuid])
  const seriesPourPromotion = useMemo(() => {
    if (!niveauSelectionne || niveauSelectionne.cycle !== 'secondaire') return []
    return series.filter(
      (s) => s.promotion_id === niveauSelectionne.id ||
             s.promotion?.uuid === niveauSelectionne.uuid ||
             (!s.promotion_id && s.cycle === 'secondaire')
    )
  }, [series, niveauSelectionne])
  const serieSelectionnee = useMemo(() => series.find((s) => s.uuid === form.serie_uuid) || null, [series, form.serie_uuid])
  const groupeSelectionne = useMemo(() => subs.find((s) => s.uuid === form.subdivision_uuid) || null, [subs, form.subdivision_uuid])

  useEffect(() => {
    if (!niveauSelectionne) return
    const cycleActuel = niveauSelectionne.cycle || form.cycle
    const abr = niveauSelectionne.abreviation || niveauSelectionne.nom

    if (cycleActuel === 'maternelle' || cycleActuel === 'primaire') {
      if (form.subdivision_uuid && groupeSelectionne) {
        const codeSub = groupeSelectionne.code || groupeSelectionne.nom.replace(/^Groupe\s+/i, '').trim()
        setForm((f) => ({ ...f, sigle: `${abr} ${codeSub}`, nom: `${niveauSelectionne.nom} - ${groupeSelectionne.nom}` }))
      } else {
        setForm((f) => ({ ...f, sigle: abr, nom: niveauSelectionne.nom }))
      }
    } else if (cycleActuel === 'secondaire') {
      if (niveauSelectionne.a_series && serieSelectionnee) {
        const codeSerie = serieSelectionnee.code || serieSelectionnee.nom
        const suffixe = (form.suffixe_classe || '1').trim()
        setForm((f) => ({ ...f, sigle: `${abr} ${codeSerie}${suffixe}`, nom: `${niveauSelectionne.nom} Série ${codeSerie} ${suffixe}` }))
      } else {
        if (form.classe_unique_promotion) {
          setForm((f) => ({ ...f, nom: niveauSelectionne.nom, sigle: abr }))
        } else {
          const suffixe = (form.suffixe_classe || (form.mode_numerotation === 'numerique' ? 'M1' : 'A')).trim()
          setForm((f) => ({ ...f, sigle: `${abr} ${suffixe}`, nom: `${niveauSelectionne.nom} ${suffixe}` }))
        }
      }
    }
  }, [niveauSelectionne, serieSelectionnee, groupeSelectionne, form.classe_unique_promotion, form.mode_numerotation, form.suffixe_classe, form.subdivision_uuid, form.cycle]) // eslint-disable-line

  /* ════════════════════════════════════════════
     MODALE
  ════════════════════════════════════════════ */

  const ouvrirModale = () => {
    const cycleCourant = filtreCycle || 'primaire'
    setForm({
      annee_uuid: anneeActive?.uuid ?? '',
      cycle: cycleCourant,
      niveau_uuid: '', subdivision_uuid: '', serie_uuid: '',
      classe_unique_promotion: false,
      mode_numerotation: 'alphabetique', suffixe_classe: 'A',
      nom: '', sigle: '', effectif_previsionnel: '',
    })
    setErreurs({})
    setModale(true)
    /* Recharger les données du formulaire si elles sont vides */
    if (niveaux.length === 0) chargerNiveaux()
    if (subs.length === 0)    chargerSubs()
    if (series.length === 0)  chargerSeries()
  }

  const valider = () => {
    const e = {}
    if (!form.niveau_uuid) e.niveau_uuid = 'Sélectionnez un niveau / une promotion.'
    const cycle = niveauSelectionne?.cycle || form.cycle
    if (cycle === 'maternelle' || cycle === 'primaire') {
      const isCycleUnique = cycleObj?.cycle_unique || subs.filter((s) => s.cycle === cycle && s.actif).length === 0
      if (!isCycleUnique && !form.subdivision_uuid)
        e.subdivision_uuid = 'Sélectionnez un groupe (ou configurez en Cycle unique).'
    }
    if (cycle === 'secondaire' && niveauSelectionne?.a_series && !form.serie_uuid)
      e.serie_uuid = 'Cette promotion comporte des séries : veuillez sélectionner une série.'
    setErreurs(e)
    return Object.keys(e).length === 0
  }

  const soumettre = async (ev) => {
    ev.preventDefault()
    if (!valider()) return
    setEnCours(true)
    try {
      await classesService.creer({
        annee_uuid: form.annee_uuid,
        niveau_uuid: form.niveau_uuid,
        subdivision_uuid: form.subdivision_uuid || undefined,
        serie_uuid: form.serie_uuid || undefined,
        nom: form.nom.trim() || undefined,
        mode_numerotation: form.mode_numerotation || undefined,
        sigle: form.sigle.trim() || undefined,
        effectif_previsionnel: form.effectif_previsionnel ? Number(form.effectif_previsionnel) : undefined,
      })
      notify.success('Classe créée', `La classe ${form.sigle} est prête avec synchronisation des matières.`)
      setModale(false)
      chargerClasses()
    } catch (err) {
      notify.fromError(err)
    } finally {
      setEnCours(false)
    }
  }

  /* ════════════════════════════════════════════
     RENDU
  ════════════════════════════════════════════ */

  if (!anneeActive) {
    return (
      <div className="ap-card ap-empty">
        <AlertTriangle size={32} />
        <p>Sélectionnez d'abord une année académique.</p>
      </div>
    )
  }

  const isSecondaire        = filtreCycle === 'secondaire' || niveauSelectionne?.cycle === 'secondaire'
  const isMaternellePrimaire = filtreCycle === 'maternelle' || filtreCycle === 'primaire' ||
    niveauSelectionne?.cycle === 'maternelle' || niveauSelectionne?.cycle === 'primaire'

  const chargeGlobal = chargeClasses

  /* Bandeau règles pédagogiques */
  const bandeauRegles = {
    maternelle: 'Structure par groupes (ex : M1 Groupe A, M1 Groupe B) ou classe unique, avec synchronisation automatique des matières.',
    primaire:   'Toute classe appartient à un groupe (ex : CM2 A, CM2 B) ou au Cycle unique (ex : CM2). Les matières sont synchronisées entre classes homologues.',
    secondaire: 'Promotions sans série (numérotation alphabétique ou numérique) · Promotions à séries (Série obligatoire, ex : 2nde B1) avec isolation stricte des matières.',
  }[filtreCycle] ?? 'Les classes héritent automatiquement des matières pédagogiques de leur niveau.'

  return (
    <div className="cfg-tab">
      <div className="ap-page-head">
        <div>
          <h2 className="ap-page-title">
            {filtreCycle === 'secondaire' ? 'Classes du Secondaire'
              : filtreCycle ? 'Classes Pédagogiques'
              : 'Classes'}
          </h2>
          <p className="ap-page-sub">
            Année : <strong>{anneeActive.libelle}</strong>
            {filtreCycle ? ` - Cycle ${CYCLE_LABEL[filtreCycle] ?? filtreCycle}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="ap-btn ap-btn--ghost ap-btn--sm" onClick={chargerTout} disabled={chargeGlobal}>
            <RefreshCw size={14} className={chargeGlobal ? 'spin' : ''} /> Actualiser
          </button>
          <button type="button" className="ap-btn ap-btn--sm" onClick={ouvrirModale}>
            <Plus size={14} /> Nouvelle classe
          </button>
        </div>
      </div>

      {/* Bandeau règles */}
      <div className="ap-alert ap-alert--info" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16 }}>
        <Info size={18} style={{ flexShrink: 0, marginTop: 2, color: 'var(--primary, #047857)' }} />
        <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
          <strong>Règle pédagogique {CYCLE_LABEL[filtreCycle] ?? ''} :</strong>
          <p style={{ margin: '4px 0 0' }}>{bandeauRegles}</p>
        </div>
      </div>

      {/* Filtre cycle si pas de filtre fixe */}
      {!cycleFiltre && (
        <div className="ap-filters">
          {['', 'maternelle', 'primaire', 'secondaire', 'universitaire'].map((c) => (
            <button key={c} type="button"
              className={`ap-tab${filtreCycle === c ? ' is-active' : ''}`}
              onClick={() => setFiltreCycle(c)}>
              {c ? CYCLE_LABEL[c] : 'Tous les cycles'}
            </button>
          ))}
        </div>
      )}

      {/* Liste des classes */}
      {chargeGlobal ? (
        <div className="ap-card" style={{ padding: '2.5rem', display: 'flex', justifyContent: 'center' }}>
          <Loader mode="inline" label="Chargement des classes…" />
        </div>
      ) : classes.length === 0 ? (
        <div className="ap-card ap-empty">
          <Layers size={36} />
          <p>Aucune classe configurée pour cette sélection.</p>
          <button type="button" className="ap-btn ap-btn--sm" onClick={ouvrirModale}>
            <Plus size={14} /> Créer la première classe
          </button>
        </div>
      ) : (
        <div className="ap-card ap-card--flush">
          <table className="ap-table">
            <thead>
              <tr>
                <th>Sigle</th>
                <th>Nom de la classe</th>
                <th>{filtreCycle === 'secondaire' ? 'Promotion' : 'Niveau scolaire'}</th>
                {isMaternellePrimaire && <th>Groupe</th>}
                {isSecondaire && <th>Série</th>}
                <th>Effectif</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.uuid}>
                  <td><span className="ap-code" style={{ fontWeight: 700, color: 'var(--primary, #047857)' }}>{c.sigle || '-'}</span></td>
                  <td><strong>{c.nom || c.sigle || '-'}</strong></td>
                  <td><span className="ap-badge ap-badge--neutral">{c.niveau?.nom ?? '-'}{c.niveau?.abreviation ? ` (${c.niveau.abreviation})` : ''}</span></td>
                  {isMaternellePrimaire && (
                    <td>{c.subdivision
                      ? <span className="ap-badge ap-badge--info">{c.subdivision.nom}</span>
                      : <span style={{ color: 'var(--sg-text-muted)', fontSize: '0.82rem' }}>Cycle unique</span>}
                    </td>
                  )}
                  {isSecondaire && (
                    <td>{c.serie
                      ? <span className="ap-badge ap-badge--warning" style={{ fontWeight: 600 }}>{c.serie.code || c.serie.nom}</span>
                      : <span style={{ color: 'var(--sg-text-muted)' }}>-</span>}
                    </td>
                  )}
                  <td>{c.effectif_previsionnel ?? <span style={{ color: 'var(--sg-text-muted)' }}>-</span>}</td>
                  <td><span className={`ap-badge ${c.actif ? 'ap-badge--success' : 'ap-badge--neutral'}`}>{c.actif ? 'Active' : 'Inactive'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ════ MODALE NOUVELLE CLASSE ════ */}
      {modale && (
        <div className="cfg-modale-fond" role="dialog" aria-modal="true" aria-labelledby="m-cls">
          <div className="cfg-modale" style={{ maxWidth: 560 }}>
            <div className="cfg-modale-tete">
              <h3 id="m-cls">
                {isSecondaire ? 'Créer une classe du Secondaire'
                  : filtreCycle ? `Nouvelle classe (${CYCLE_LABEL[filtreCycle] ?? filtreCycle})`
                  : 'Nouvelle classe'}
              </h3>
              <button type="button" className="ap-drawer-close" onClick={() => setModale(false)} aria-label="Fermer">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={soumettre}>
              <div className="cfg-modale-corps">

                {/* 1. Niveau / Promotion */}
                <div className={`ap-field${erreurs.niveau_uuid ? ' has-error' : ''}`}>
                  <label className="ap-label" htmlFor="cls-niv">
                    {filtreCycle === 'secondaire' ? 'Promotion *' : 'Niveau scolaire *'}
                    {chargeNiveaux && <Loader mode="button" style={{ marginLeft: 8 }} />}
                  </label>

                  {/* Alerte si erreur de chargement */}
                  {errNiveaux && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#c0392b', marginBottom: 4 }}>
                      <AlertCircle size={14} />
                      {errNiveaux}
                      <button type="button" className="ap-btn ap-btn--ghost ap-btn--sm" onClick={chargerNiveaux} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>
                        Réessayer
                      </button>
                    </div>
                  )}

                  <select id="cls-niv" className="ap-input"
                    value={form.niveau_uuid}
                    disabled={chargeNiveaux}
                    onChange={(e) => setForm((f) => ({ ...f, niveau_uuid: e.target.value, serie_uuid: '', classe_unique_promotion: false }))}>
                    <option value="">{chargeNiveaux ? 'Chargement…' : '-- Sélectionner --'}</option>
                    {niveaux.filter((n) => !filtreCycle || n.cycle === filtreCycle).map((n) => (
                      <option key={n.uuid} value={n.uuid}>
                        {n.nom} {n.abreviation ? `(${n.abreviation})` : ''}
                        {!filtreCycle ? ` - ${CYCLE_LABEL[n.cycle]}` : ''}
                      </option>
                    ))}
                  </select>
                  {erreurs.niveau_uuid && <p className="ap-error">{erreurs.niveau_uuid}</p>}
                </div>

                {/* 2. Logique SECONDAIRE */}
                {isSecondaire && niveauSelectionne && (
                  <>
                    {niveauSelectionne.a_series ? (
                      <div className="ap-card" style={{ padding: 14, background: 'var(--sg-surface-2,#f8fafc)', marginBottom: 14, border: '1px solid var(--border-color,#e2e8f0)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                          <CheckCircle2 size={16} color="var(--primary,#047857)" />
                          <strong style={{ fontSize: '0.88rem' }}>Promotion à séries (ex. Seconde, Terminale)</strong>
                        </div>

                        {errSeries && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#c0392b', marginBottom: 6 }}>
                            <AlertCircle size={14} /> {errSeries}
                            <button type="button" className="ap-btn ap-btn--ghost ap-btn--sm" onClick={chargerSeries} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>Réessayer</button>
                          </div>
                        )}

                        <div className={`ap-field${erreurs.serie_uuid ? ' has-error' : ''}`}>
                          <label className="ap-label" htmlFor="cls-ser">
                            Série associée *
                            {chargeSeries && <Loader mode="button" style={{ marginLeft: 8 }} />}
                          </label>
                          <select id="cls-ser" className="ap-input"
                            value={form.serie_uuid}
                            disabled={chargeSeries}
                            onChange={(e) => setForm((f) => ({ ...f, serie_uuid: e.target.value }))}>
                            <option value="">{chargeSeries ? 'Chargement…' : '-- Sélectionner la série --'}</option>
                            {seriesPourPromotion.map((s) => (
                              <option key={s.uuid} value={s.uuid}>{s.code} - {s.nom}</option>
                            ))}
                          </select>
                          {erreurs.serie_uuid && <p className="ap-error">{erreurs.serie_uuid}</p>}
                        </div>

                        <div className="ap-field" style={{ marginTop: 10 }}>
                          <label className="ap-label" htmlFor="cls-suf">Numéro / Index de classe</label>
                          <input id="cls-suf" className="ap-input ap-input--mono"
                            value={form.suffixe_classe}
                            onChange={(e) => setForm((f) => ({ ...f, suffixe_classe: e.target.value }))}
                            placeholder="Ex: 1 pour 2nde B1, 2 pour 2nde B2" />
                          <p className="ap-hint">Exemple : Série B + index 1 → Sigle <strong>2nde B1</strong>.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="ap-card" style={{ padding: 14, background: 'var(--sg-surface-2,#f8fafc)', marginBottom: 14, border: '1px solid var(--border-color,#e2e8f0)' }}>
                        <label className="ap-label" style={{ marginBottom: 8, display: 'block' }}>
                          Une seule classe à créer pour cette promotion ?
                        </label>
                        <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                          {[true, false].map((val) => (
                            <label key={String(val)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.88rem' }}>
                              <input type="radio" name="unique_prom"
                                checked={form.classe_unique_promotion === val}
                                onChange={() => setForm((f) => ({ ...f, classe_unique_promotion: val }))} />
                              {val ? 'Oui (Classe unique)' : 'Non (Plusieurs classes)'}
                            </label>
                          ))}
                        </div>
                        {!form.classe_unique_promotion && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            <div className="ap-field">
                              <label className="ap-label" htmlFor="cls-mod">Numérotation</label>
                              <select id="cls-mod" className="ap-input"
                                value={form.mode_numerotation}
                                onChange={(e) => setForm((f) => ({ ...f, mode_numerotation: e.target.value, suffixe_classe: e.target.value === 'numerique' ? 'M1' : 'A' }))}>
                                <option value="alphabetique">Alphabétique (ex: 6ème A)</option>
                                <option value="numerique">Numérique (ex: 6ème M1)</option>
                              </select>
                            </div>
                            <div className="ap-field">
                              <label className="ap-label" htmlFor="cls-suf-alpha">Suffixe / Lettre</label>
                              <input id="cls-suf-alpha" className="ap-input ap-input--mono"
                                value={form.suffixe_classe}
                                onChange={(e) => setForm((f) => ({ ...f, suffixe_classe: e.target.value }))}
                                placeholder={form.mode_numerotation === 'numerique' ? 'M1, M2…' : 'A, B, C…'} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* 3. Logique MATERNELLE / PRIMAIRE */}
                {isMaternellePrimaire && (
                  <div className={`ap-field${erreurs.subdivision_uuid ? ' has-error' : ''}`}>
                    <label className="ap-label" htmlFor="cls-sub">
                      Groupe associé
                      <span style={{ fontWeight: 400, marginLeft: 6, color: 'var(--sg-text-muted)' }}>(Groupe A, Groupe B…)</span>
                      {chargeSubs && <Loader mode="button" style={{ marginLeft: 8 }} />}
                    </label>

                    {errSubs && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: '#c0392b', marginBottom: 4 }}>
                        <AlertCircle size={14} /> {errSubs}
                        <button type="button" className="ap-btn ap-btn--ghost ap-btn--sm" onClick={chargerSubs} style={{ padding: '2px 8px', fontSize: '0.75rem' }}>Réessayer</button>
                      </div>
                    )}

                    <select id="cls-sub" className="ap-input"
                      value={form.subdivision_uuid}
                      disabled={chargeSubs}
                      onChange={(e) => setForm((f) => ({ ...f, subdivision_uuid: e.target.value }))}>
                      <option value="">{chargeSubs ? 'Chargement…' : '-- Aucun (Cycle unique / Classe sans groupe) --'}</option>
                      {subs.filter((s) => s.actif && (!filtreCycle || (s.cycle ?? s.cycleConfig?.cycle ?? s.cycle_config?.cycle) === filtreCycle)).map((s) => (
                        <option key={s.uuid} value={s.uuid}>{s.nom} {s.code ? `(${s.code})` : ''}</option>
                      ))}
                    </select>
                    <p className="ap-hint">Laissez vide si votre établissement fonctionne en <strong>Cycle unique</strong>.</p>
                    {erreurs.subdivision_uuid && <p className="ap-error">{erreurs.subdivision_uuid}</p>}
                  </div>
                )}

                {/* 4. Nom & Sigle */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
                  <div className="ap-field">
                    <label className="ap-label" htmlFor="cls-nom">Nom complet de la classe</label>
                    <input id="cls-nom" className="ap-input" value={form.nom}
                      onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))}
                      placeholder="Généré automatiquement" />
                  </div>
                  <div className="ap-field">
                    <label className="ap-label" htmlFor="cls-sig">Sigle (ex: CM2 A)</label>
                    <input id="cls-sig" className="ap-input ap-input--mono" style={{ fontWeight: 700 }}
                      value={form.sigle}
                      onChange={(e) => setForm((f) => ({ ...f, sigle: e.target.value }))}
                      placeholder="Sigle" />
                  </div>
                </div>

                {/* 5. Effectif */}
                <div className="ap-field">
                  <label className="ap-label" htmlFor="cls-eff">Effectif prévisionnel (élèves)</label>
                  <input id="cls-eff" type="number" min={1} className="ap-input"
                    style={{ maxWidth: 140 }} value={form.effectif_previsionnel}
                    onChange={(e) => setForm((f) => ({ ...f, effectif_previsionnel: e.target.value }))}
                    placeholder="30" />
                </div>

                <div className="ap-alert ap-alert--success" style={{ marginTop: 10, padding: '10px 12px', fontSize: '0.82rem' }}>
                  Les matières déjà configurées pour ce niveau seront automatiquement rattachées à cette classe dès sa création.
                </div>
              </div>

              <div className="cfg-modale-pied">
                <button type="button" className="ap-btn ap-btn--ghost" onClick={() => setModale(false)}>Annuler</button>
                <button type="submit" className="ap-btn" disabled={enCours}>
                  {enCours ? <><Loader mode="button" /> Création en cours…</> : 'Créer la classe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
