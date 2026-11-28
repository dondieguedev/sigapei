import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import {
  UserCheck, CheckCircle, XCircle, Search, RefreshCw, Plus,
  Megaphone, Calendar, CalendarDays, Clock, Layers, FileText,
  DollarSign, Edit2, Trash2, AlertTriangle, StopCircle, Users,
  CheckCircle2, School, BookOpen, GraduationCap, Building2,
  ChevronRight, Eye, Phone, Mail, MapPin, User, Paperclip,
} from 'lucide-react'

import { lienEtablissement } from '../../lib/etablissements/subdomain'
import { portailService } from '../../services/identite/portail.service'
import { inscriptionService } from '../../services/inscription/inscription.service'
import { anneesService, cyclesService } from '../../services/etablissements/configurationAcademique.service'
import { monEtablissementService } from '../../services/etablissements/monEtablissement.service'
import useSlugEtablissement from '../../hooks/etablissements/useSlugEtablissement'
import usePageTitle from '../../hooks/commun/usePageTitle'
import { useNotify } from '../../context/commun/NotifyContext'

import ModuleLayout from '../../components/commun/ModuleLayout'
import Loader from '../../components/commun/Loader'
import ConfirmDialog from '../../components/commun/ConfirmDialog'
import ModalAppelCandidature from './ModalAppelCandidature'

import '../AdministrationPrincipale/admin.css'
import '../../components/administration/admin-ui.css'
import '../etablissements/ConfigurationPage.css'
import '../etablissements/ScolaritePage.css'
import './inscription.css'

const CYCLE_LABELS = {
  maternelle: 'Maternelle',
  primaire: 'Primaire',
  secondaire: 'Secondaire',
  universitaire: 'Université',
}

const CYCLE_ICONES = {
  maternelle: School,
  primaire: BookOpen,
  secondaire: GraduationCap,
  universitaire: Building2,
}

const LIBELLES_STATUT_CANDIDATURE = {
  soumise: 'Soumise',
  en_attente: 'En attente',
  en_attente_paiement: 'Paiement en attente',
  validee: 'Validée',
  rejetee: 'Rejetée',
  expiree: 'Expirée',
}
const TRAITABLE = (c) => c.statut === 'soumise' || c.statut === 'en_attente'
const LOT_MAX = 50

const LIBELLES_STATUT = {
  en_cours: 'En cours',
  a_venir: 'À venir',
  termine: 'Terminée',
  suspendu: 'Suspendue',
}

/* ── Navigation sidebar Inscription ── */
function buildNavInscription(base, section, cycleParam, cyclesActifsValides) {
  const cycleItems = cyclesActifsValides.map((c) => ({
    label: CYCLE_LABELS[c.cycle] ?? c.cycle,
    href: `${base}?cycle=${c.cycle}`,
    Icon: CYCLE_ICONES[c.cycle] ?? School,
    actif: cycleParam === c.cycle,
    enfants: [
      {
        label: 'Appels',
        href: `${base}?cycle=${c.cycle}&section=appels`,
        actif: cycleParam === c.cycle && (section === 'appels' || !section),
      },
      {
        label: 'Candidatures',
        href: `${base}?cycle=${c.cycle}&section=candidatures`,
        actif: cycleParam === c.cycle && section === 'candidatures',
      },
    ],
  }))

  return [
    {
      groupe: 'GESTION',
      items: [
        { label: "Vue d'ensemble", href: base, actif: !section && !cycleParam, Icon: UserCheck },
        { label: 'Appels à candidatures', href: `${base}?section=appels`, actif: section === 'appels' && !cycleParam, Icon: Megaphone },
        { label: 'Dossiers de candidature', href: `${base}?section=candidatures`, actif: section === 'candidatures' && !cycleParam, Icon: Users },
      ],
    },
    ...(cycleItems.length > 0 ? [{ groupe: 'PAR CYCLE', items: cycleItems }] : []),
  ]
}

export default function InscriptionPage() {
  usePageTitle('Inscriptions')
  const slug   = useSlugEtablissement()
  const notify = useNotify()
  const [searchParams, setSearchParams] = useSearchParams()

  const section = searchParams.get('section') ?? ''
  const cycleParam = searchParams.get('cycle') ?? ''
  const anneeUuidParam = searchParams.get('annee_uuid') ?? ''

  // 1. Contrôle d'accès & permission de rôle via portailService.lire()
  const [acces, setAcces] = useState('chargement')

  useEffect(() => {
    let cancel = false
    portailService.lire()
      .then((r) => {
        if (cancel) return
        const svc = r?.services?.find((s) => s.code === 'inscription')
        if (!svc || !svc.accessible) {
          setAcces('refuse')
          return
        }
        setAcces('autorise')
      })
      .catch(() => {
        if (!cancel) setAcces('refuse')
      })
    return () => { cancel = true }
  }, [])

  // 2. Années académiques et cycles autorisés
  const [toutesAnnees, setToutesAnnees] = useState([])
  const [anneeActive, setAnneeActive] = useState(null)
  const [cyclesAutorises, setCyclesAutorises] = useState([])
  const [cyclesActifs, setCyclesActifs] = useState([])

  useEffect(() => {
    if (acces !== 'autorise') return
    let cancel = false

    Promise.all([anneesService.lister(), monEtablissementService.lire()])
      .then(([rAnnees, profil]) => {
        if (cancel) return
        const liste = Array.isArray(rAnnees?.data) ? rAnnees.data : Array.isArray(rAnnees) ? rAnnees : []
        setToutesAnnees(liste)

        let annee = null
        if (anneeUuidParam) {
          annee = liste.find((a) => a.uuid === anneeUuidParam) ?? null
        }
        if (!annee) {
          annee = liste.find((a) => a.statut === 'en_cours') ?? liste[0] ?? null
        }
        setAnneeActive(annee)

        if (annee && !anneeUuidParam) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev)
            next.set('annee_uuid', annee.uuid)
            return next
          }, { replace: true })
        }

        const autorises = (profil?.cyclesAutorises ?? [])
          .filter((x) => x.statut === 'actif')
          .map((x) => x.cycle)
        setCyclesAutorises(autorises)
      })
      .catch(() => {})

    return () => { cancel = true }
  }, [acces]) // eslint-disable-line

  // 3. Charger les cycles actifs pour l'année
  useEffect(() => {
    if (!anneeActive?.uuid) return
    let cancel = false
    cyclesService.lister(anneeActive.uuid)
      .then((r) => {
        if (!cancel) {
          setCyclesActifs((r?.data ?? r ?? []).filter((x) => x.actif))
        }
      })
      .catch(() => {})
    return () => { cancel = true }
  }, [anneeActive?.uuid])

  // Cycles valides (autorisés ET actifs pour l'année en cours)
  const cyclesActifsValides = useMemo(() => {
    return cyclesActifs.filter((c) => cyclesAutorises.includes(c.cycle))
  }, [cyclesActifs, cyclesAutorises])

  const cyclesDisponiblesIds = useMemo(() => {
    return cyclesActifsValides.map((c) => c.cycle)
  }, [cyclesActifsValides])

  // --- Données Appels à candidatures ---
  const [appels, setAppels] = useState([])
  const [chargementAppels, setChargementAppels] = useState(false)
  const [filtreCycleAppel, setFiltreCycleAppel] = useState(cycleParam || '')
  const [filtreStatutAppel, setFiltreStatutAppel] = useState('')
  const [rechercheAppel, setRechercheAppel] = useState('')
  const [modalAppelOuverte, setModalAppelOuverte] = useState(false)
  const [appelEnEdition, setAppelEnEdition] = useState(null)
  const [actionEnCoursAppel, setActionEnCoursAppel] = useState(false)

  // Synchroniser le filtre de cycle si cycleParam est dans l'URL
  useEffect(() => {
    if (cycleParam) {
      setFiltreCycleAppel(cycleParam)
    }
  }, [cycleParam])

  // --- Données Candidatures ---
  const [candidatures, setCandidatures] = useState([])
  const [chargementCandidatures, setChargementCandidatures] = useState(true)
  const [erreurCandidatures, setErreurCandidatures] = useState('')
  const [filtreStatutCandidature, setFiltreStatutCandidature] = useState('tous')
  const [rechercheCandidature, setRechercheCandidature] = useState('')
  const [actionLoadingCandidature, setActionLoadingCandidature] = useState(null)
  const [filtreAppelCandidature, setFiltreAppelCandidature] = useState('')

  // ── Sélection multiple et traitement par lot ──
  const [selection, setSelection] = useState(() => new Set())
  const [confirmLot, setConfirmLot] = useState(null) // 'valider' | 'rejeter'
  const [motifLot, setMotifLot] = useState('')
  const [lotEnCours, setLotEnCours] = useState(false)
  const [resultatLot, setResultatLot] = useState(null)

  // ── Modales candidatures ──
  const [candidatureDetail, setCandidatureDetail]       = useState(null) // modal détails
  const [loadingDetail, setLoadingDetail]               = useState(false)
  const [confirmValidation, setConfirmValidation]       = useState(null) // { uuid, nom }
  const [confirmRejet, setConfirmRejet]                 = useState(null) // { uuid, nom }
  const [motifRejet, setMotifRejet]                     = useState('')
  const [confirmTerminer, setConfirmTerminer]           = useState(null) // { uuid }
  const [confirmSupprimer, setConfirmSupprimer]         = useState(null) // { uuid }

  // Charger les appels
  const chargerAppels = useCallback(async () => {
    setChargementAppels(true)
    try {
      const filtres = {}
      const cycleAChercher = cycleParam || filtreCycleAppel
      if (cycleAChercher) filtres.cycle = cycleAChercher
      if (filtreStatutAppel) filtres.statut = filtreStatutAppel
      const res = await inscriptionService.listerAppels(filtres)
      setAppels(Array.isArray(res) ? res : res?.data ?? [])
    } catch (err) {
      console.error('Erreur chargement appels:', err)
    } finally {
      setChargementAppels(false)
    }
  }, [cycleParam, filtreCycleAppel, filtreStatutAppel])

  // Charger les candidatures
  const chargerCandidatures = useCallback(async () => {
    setChargementCandidatures(true)
    setErreurCandidatures('')
    try {
      const filtres = {}
      if (cycleParam) filtres.cycle = cycleParam
      if (filtreAppelCandidature) filtres.appel_uuid = filtreAppelCandidature
      // Les dossiers « paiement en attente » / « expirés » ne figurent pas dans la file par défaut : on les demande explicitement.
      if (['en_attente_paiement', 'expiree'].includes(filtreStatutCandidature)) filtres.statut = filtreStatutCandidature
      const data = await inscriptionService.listerCandidatures(filtres)
      const liste = Array.isArray(data) ? data : data?.data ?? []
      setCandidatures(liste)
      // Une sélection ne survit pas à un rechargement : on ne garde que les dossiers encore traitables.
      setSelection((prev) => new Set([...prev].filter((u) => liste.some((c) => c.uuid === u && TRAITABLE(c)))))
    } catch (err) {
      notify.fromError(err)
    } finally {
      setChargementCandidatures(false)
    }
  }, [cycleParam, filtreAppelCandidature, filtreStatutCandidature])

  useEffect(() => {
    if (acces === 'autorise') {
      chargerAppels()
      chargerCandidatures()
    }
  }, [acces, chargerAppels, chargerCandidatures])

  const changerAnnee = useCallback((annee) => {
    setAnneeActive(annee)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('annee_uuid', annee.uuid)
      return next
    })
  }, [setSearchParams])

  // Actions appels
  const handleOuvrirCreationAppel = () => {
    setAppelEnEdition(null)
    setModalAppelOuverte(true)
  }

  const handleEditerAppel = (appel) => {
    setAppelEnEdition(appel)
    setModalAppelOuverte(true)
  }

  const handleEnregistrerAppel = async (donnees) => {
    setActionEnCoursAppel(true)
    try {
      if (appelEnEdition?.uuid) {
        await inscriptionService.modifierAppel(appelEnEdition.uuid, donnees)
      } else {
        await inscriptionService.creerAppel(donnees)
      }
      setModalAppelOuverte(false)
      await chargerAppels()
    } catch (err) {
      notify.fromError(err)
    } finally {
      setActionEnCoursAppel(false)
    }
  }

  const handleTerminerAppel = async (uuid) => {
    setConfirmTerminer({ uuid })
  }

  const handleSupprimerAppel = async (uuid) => {
    setConfirmSupprimer({ uuid })
  }

  // Actions candidatures

  // Ouvrir la modale de détails en chargeant le dossier complet (pièces, tests)
  const ouvrirDetailCandidature = async (c) => {
    setCandidatureDetail(c) // afficher d'abord les données de base
    setLoadingDetail(true)
    try {
      const detail = await inscriptionService.afficherCandidature(c.uuid)
      // Le détail renvoie le parent en objet ; la modale lit des champs à plat. On conserve aussi classe/appel de la liste.
      setCandidatureDetail(detail ? {
        ...c, ...detail,
        parent_nom: detail.parent?.nom, parent_prenom: detail.parent?.prenom, parent_lien: detail.parent?.lien,
        parent_telephone: detail.parent?.telephone, parent_email: detail.parent?.email,
      } : c)
    } catch {
      // garder les données de base en cas d'erreur
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleValiderCandidature = (c) => {
    setConfirmValidation({ uuid: c.uuid, nom: `${c.nom} ${c.prenom}` })
  }

  const handleRejeterCandidature = (c) => {
    setMotifRejet('')
    setConfirmRejet({ uuid: c.uuid, nom: `${c.nom} ${c.prenom}` })
  }

  const confirmerValidation = async () => {
    if (!confirmValidation) return
    setActionLoadingCandidature(confirmValidation.uuid)
    try {
      await inscriptionService.validerCandidature(confirmValidation.uuid)
      notify.success('Candidature validée', `L'admission de ${confirmValidation.nom} a été confirmée.`)
      await chargerCandidatures()
    } catch (err) {
      notify.fromError(err)
    } finally {
      setActionLoadingCandidature(null)
      setConfirmValidation(null)
    }
  }

  const confirmerRejet = async () => {
    if (!confirmRejet || !motifRejet.trim()) return
    setActionLoadingCandidature(confirmRejet.uuid)
    try {
      await inscriptionService.rejeterCandidature(confirmRejet.uuid, motifRejet.trim())
      notify.success('Candidature rejetée', `Le dossier de ${confirmRejet.nom} a été rejeté.`)
      await chargerCandidatures()
    } catch (err) {
      notify.fromError(err)
    } finally {
      setActionLoadingCandidature(null)
      setConfirmRejet(null)
      setMotifRejet('')
    }
  }

  // ── Lot ──
  const basculerSelection = (uuid) =>
    setSelection((prev) => {
      const n = new Set(prev)
      if (n.has(uuid)) n.delete(uuid)
      else if (n.size < LOT_MAX) n.add(uuid)
      else notify.error('Limite atteinte', `Un lot ne peut pas dépasser ${LOT_MAX} dossiers.`)
      return n
    })

  const ouvrirLot = (action) => {
    setMotifLot('')
    setConfirmLot(action)
  }

  const confirmerLot = async () => {
    if (!confirmLot || selection.size === 0) return
    if (confirmLot === 'rejeter' && motifLot.trim().length < 5) return
    setLotEnCours(true)
    try {
      const uuids = [...selection]
      const r = confirmLot === 'valider'
        ? await inscriptionService.validerLot(uuids)
        : await inscriptionService.rejeterLot(uuids, motifLot.trim())
      const noms = new Map(candidatures.map((c) => [c.uuid, `${c.nom} ${c.prenom}`]))
      const echecs = (r?.resultats ?? []).filter((x) => !x.succes).map((x) => ({ ...x, nom: noms.get(x.uuid) ?? x.uuid }))
      if (echecs.length === 0) {
        notify.success(
          confirmLot === 'valider' ? 'Candidatures validées' : 'Candidatures rejetées',
          `${r?.reussis ?? uuids.length} dossier(s) traité(s).`,
        )
      } else {
        setResultatLot({ action: confirmLot, reussis: r?.reussis ?? 0, echecs })
      }
      setSelection(new Set())
      await chargerCandidatures()
    } catch (err) {
      notify.fromError(err)
    } finally {
      setLotEnCours(false)
      setConfirmLot(null)
      setMotifLot('')
    }
  }

  const confirmerTerminer = async () => {
    if (!confirmTerminer) return
    try {
      await inscriptionService.terminerAppel(confirmTerminer.uuid)
      await chargerAppels()
    } catch (err) { notify.fromError(err) }
    finally { setConfirmTerminer(null) }
  }

  const confirmerSupprimer = async () => {
    if (!confirmSupprimer) return
    try {
      await inscriptionService.supprimerAppel(confirmSupprimer.uuid)
      await chargerAppels()
    } catch (err) { notify.fromError(err) }
    finally { setConfirmSupprimer(null) }
  }

  const base = lienEtablissement(slug, '/inscription')

  if (acces === 'refuse') {
    return <Navigate to={lienEtablissement(slug, '/portail')} replace />
  }

  if (acces === 'chargement') {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <Loader mode="inline" label="Vérification de l'accès aux inscriptions…" />
      </div>
    )
  }

  const navInscription = buildNavInscription(base, section, cycleParam, cyclesActifsValides)

  // Filtrages locaux
  const filteredAppels = appels.filter((a) => {
    const s = rechercheAppel.toLowerCase()
    const matchCycle = !filtreCycleAppel || a.cycle === filtreCycleAppel
    const matchStatut = !filtreStatutAppel || a.statut === filtreStatutAppel
    const matchRecherche =
      !s ||
      (a.titre || '').toLowerCase().includes(s) ||
      (a.description || '').toLowerCase().includes(s) ||
      (a.cycle || '').toLowerCase().includes(s)
    return matchCycle && matchStatut && matchRecherche
  })

  const filteredCandidatures = candidatures.filter((c) => {
    const matchStatut =
      filtreStatutCandidature === 'tous' ||
      (filtreStatutCandidature === 'soumise' ? TRAITABLE(c) : c.statut === filtreStatutCandidature)
    const s = rechercheCandidature.toLowerCase()
    const matchSearch =
      !s ||
      `${c.nom ?? ''} ${c.prenom ?? ''}`.toLowerCase().includes(s) ||
      (c.reference ?? '').toLowerCase().includes(s) ||
      (c.uuid ?? '').toLowerCase().includes(s)
    return matchStatut && matchSearch
  })
  const traitables = filteredCandidatures.filter(TRAITABLE)
  const toutSelectionne = traitables.length > 0 && traitables.every((c) => selection.has(c.uuid))
  const basculerTout = () =>
    setSelection(toutSelectionne ? new Set() : new Set(traitables.slice(0, LOT_MAX).map((c) => c.uuid)))

  const formaterDateHeure = (dStr) => {
    if (!dStr) return '-'
    // Parser manuellement pour éviter la conversion UTC→local (+1h)
    // Format attendu : "2026-11-19T12:31:00" ou "2026-11-19 12:31:00"
    const normalized = dStr.replace(' ', 'T').replace(/Z$/, '').slice(0, 16) // "2026-11-19T12:31"
    const [datePart, timePart] = normalized.split('T')
    if (!datePart) return dStr
    const [year, month, day] = datePart.split('-')
    const moisFr = ['jan.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.']
    const moisLabel = moisFr[parseInt(month, 10) - 1] ?? month
    const heure = timePart ? ` à ${timePart}` : ''
    return `${parseInt(day, 10)} ${moisLabel} ${year}${heure}`
  }

  // Fil d'ariane
  const migettes = [
    <Link key="p" to={lienEtablissement(slug, '/portail')}>Portail</Link>,
    <span key="s1" className="ap-bread-sep">/</span>,
    <Link key="sc" to={base}>Inscriptions</Link>,
  ]

  if (cycleParam) {
    migettes.push(<span key="s2" className="ap-bread-sep">/</span>)
    migettes.push(<span key="cy">{CYCLE_LABELS[cycleParam] ?? cycleParam}</span>)
    if (section) {
      const labels = { appels: 'Appels', candidatures: 'Candidatures' }
      migettes.push(<span key="s3" className="ap-bread-sep">/</span>)
      migettes.push(<span key="sec">{labels[section] ?? section}</span>)
    }
  } else if (section) {
    const labels = { appels: 'Appels à candidatures', candidatures: 'Dossiers de candidature' }
    migettes.push(<span key="s2" className="ap-bread-sep">/</span>)
    migettes.push(<span key="sec">{labels[section] ?? section}</span>)
  }

  const estVueEnsemble = !section && !cycleParam

  // Rendu de la vue
  function renduContenu() {
    // Si cycle demandé dans l'URL mais pas autorisé / actif
    if (cycleParam) {
      const cycleTrouve = cyclesActifsValides.find((c) => c.cycle === cycleParam)
      if (!cycleTrouve) {
        return (
          <div className="ap-card ap-empty" style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
            <AlertTriangle size={40} style={{ color: 'var(--sg-warning, #d97706)', margin: '0 auto 12px' }} />
            <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 700 }}>
              Cycle non autorisé ou inactif pour cette année
            </h3>
            <p style={{ maxWidth: 540, margin: '0 auto 16px', color: 'var(--sg-text-muted)' }}>
              Le cycle <strong>{CYCLE_LABELS[cycleParam] ?? cycleParam}</strong> n'est pas autorisé pour votre établissement ou n'a pas été activé pour l'année académique <strong>{anneeActive?.libelle}</strong>.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <Link to={base} className="ap-btn ap-btn--ghost ap-btn--sm">
                Retour à la vue d'ensemble
              </Link>
              <Link to={lienEtablissement(slug, '/scolarite?section=cycles')} className="ap-btn ap-btn--sm">
                Activer des cycles dans Scolarité
              </Link>
            </div>
          </div>
        )
      }
    }

    // Vue 1 : Appels à candidatures (explicite ou par sous-onglet de cycle)
    if (section === 'appels' || (cycleParam && section !== 'candidatures')) {
      return (
        <div>
          <div className="ap-page-head">
            <div>
              <h2 className="ap-page-title">
                Appels à candidatures {cycleParam ? `${CYCLE_LABELS[cycleParam]}` : ''}
              </h2>
              <p className="ap-page-sub">
                Campagnes de recrutement ouvertes aux futurs apprenants et critères d'admission
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleOuvrirCreationAppel}
                className="ap-btn ap-btn--sm"
                style={{ gap: 6 }}
              >
                <Plus size={16} /> Lancer un appel
              </button>
              <button
                type="button"
                onClick={() => {
                  chargerAppels()
                  chargerCandidatures()
                }}
                className="ap-btn ap-btn--ghost ap-btn--sm"
                title="Actualiser les données"
              >
                <RefreshCw size={15} className={chargementAppels ? 'spin' : ''} /> Actualiser
              </button>
            </div>
          </div>

          {/* Outils & Filtres */}
          <div className="module-toolbar" style={{ marginBottom: 20 }}>
            <div className="module-search">
              <Search size={18} />
              <input
                type="text"
                placeholder="Rechercher par titre, description..."
                value={rechercheAppel}
                onChange={(e) => setRechercheAppel(e.target.value)}
              />
            </div>
            <div className="module-filters" style={{ flexWrap: 'wrap' }}>
              {!cycleParam && (
                <>
                  <button
                    type="button"
                    className={`module-filter-btn ${!filtreCycleAppel ? 'active' : ''}`}
                    onClick={() => setFiltreCycleAppel('')}
                  >
                    Tous les cycles
                  </button>
                  {cyclesActifsValides.map((c) => (
                    <button
                      key={c.cycle}
                      type="button"
                      className={`module-filter-btn ${filtreCycleAppel === c.cycle ? 'active' : ''}`}
                      onClick={() => setFiltreCycleAppel(c.cycle)}
                    >
                      {CYCLE_LABELS[c.cycle]}
                    </button>
                  ))}
                </>
              )}
              <select
                className="ap-input"
                style={{ maxWidth: 150, padding: '0.4rem 0.6rem', fontSize: '0.8125rem' }}
                value={filtreStatutAppel}
                onChange={(e) => setFiltreStatutAppel(e.target.value)}
                aria-label="Filtrer par statut"
              >
                <option value="">Tous les statuts</option>
                <option value="ouvert">Ouvert</option>
                <option value="brouillon">Brouillon</option>
                <option value="termine">Terminé</option>
                <option value="annule">Annulé</option>
              </select>
            </div>
          </div>

          {/* Liste des appels */}
          {chargementAppels ? (
            <div className="ap-card" style={{ padding: '3.5rem', display: 'flex', justifyContent: 'center' }}>
              <Loader mode="inline" label="Chargement des appels à candidature…" />
            </div>
          ) : filteredAppels.length === 0 ? (
            <div className="ap-card ap-empty" style={{ padding: '3.5rem', textAlign: 'center' }}>
              <Megaphone size={40} style={{ color: 'var(--sg-text-muted)', margin: '0 auto 12px' }} />
              <h3 style={{ margin: '0 0 6px', fontWeight: 600 }}>Aucun appel à candidature</h3>
              <p style={{ margin: '0 0 16px', color: 'var(--sg-text-muted)', fontSize: '0.9rem' }}>
                Créez une nouvelle campagne de recrutement selon les règles de votre cycle.
              </p>
              <button type="button" onClick={handleOuvrirCreationAppel} className="ap-btn ap-btn--sm">
                <Plus size={16} /> Lancer le premier appel
              </button>
            </div>
          ) : (
            <div className="appel-grid">
              {filteredAppels.map((appel) => {
                const criteres = Array.isArray(appel.criteres_eligibilite) ? appel.criteres_eligibilite : []
                const pieces = Array.isArray(appel.pieces_a_fournir) ? appel.pieces_a_fournir
                  : Array.isArray(appel.pieces_fournir) ? appel.pieces_fournir
                  : []
                const critereAdmission = criteres.find((c) => c.type === 'type_inscription')

                return (
                  <div key={appel.uuid} className="appel-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <span className="ap-badge ap-badge--info" style={{ textTransform: 'capitalize', fontWeight: 700 }}>
                            {CYCLE_LABELS[appel.cycle] ?? appel.cycle}
                          </span>
                          <span className={`status-pill status-pill--${appel.statut}`}>
                            {appel.statut}
                          </span>
                        </div>
                        <h3 style={{ margin: '4px 0 2px', fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {appel.titre}
                        </h3>
                      </div>
                    </div>

                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {appel.description ? (
                        <p style={{ margin: '0 0 8px', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {appel.description}
                        </p>
                      ) : null}

                      {critereAdmission && (
                        <div style={{ background: 'var(--sg-surface-2, #f8fafc)', padding: '6px 10px', borderRadius: 6, marginBottom: 8, fontSize: '0.82rem' }}>
                          <strong>Modalité : </strong>
                          <span style={{ textTransform: 'capitalize' }}>{critereAdmission.mode || 'Libre'}</span>
                          {critereAdmission.matieres_composees && critereAdmission.matieres_composees.length > 0 && (
                            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              <span style={{ fontWeight: 600 }}>Épreuves :</span>
                              {critereAdmission.matieres_composees.map((m, idx) => (
                                <span key={idx} className="ap-badge ap-badge--neutral" style={{ fontSize: '0.72rem' }}>
                                  {m}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.8rem', color: 'var(--sg-text-muted)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Clock size={13} color="var(--primary, #047857)" />
                          <span>Du : <strong>{formaterDateHeure(appel.date_debut)}</strong></span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Clock size={13} color="#b91c1c" />
                          <span>Au : <strong>{formaterDateHeure(appel.date_fin)}</strong></span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border-color, #e5e7eb)' }}>
                        <div>
                          {appel.est_payant ? (
                            <span style={{ fontWeight: 700, color: 'var(--primary, #047857)', fontSize: '0.88rem' }}>
                              {Number(appel.frais_dossier).toLocaleString('fr-FR')} FCFA
                            </span>
                          ) : (
                            <span className="ap-badge ap-badge--success" style={{ fontSize: '0.75rem' }}>
                              Gratuit
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem' }}>
                          <FileText size={14} />
                          <span>{pieces.length} pièce(s) requise(s)</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 'auto', paddingTop: 8 }}>
                      <button
                        type="button"
                        onClick={() => handleEditerAppel(appel)}
                        className="btn-action"
                        style={{ background: 'var(--sg-surface-2, #f1f5f9)', color: 'var(--text-primary)' }}
                        title="Modifier cet appel"
                      >
                        <Edit2 size={14} /> Modifier
                      </button>

                      {appel.statut !== 'termine' && (
                        <button
                          type="button"
                          onClick={() => handleTerminerAppel(appel.uuid)}
                          className="btn-action"
                          style={{ background: '#fef3c7', color: '#b45309' }}
                          title="Clôturer l'appel"
                        >
                          <StopCircle size={14} /> Clôturer
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleSupprimerAppel(appel.uuid)}
                        className="btn-action btn-action--danger"
                        title="Supprimer définitivement"
                      >
                        <Trash2 size={14} /> Supprimer
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )
    }
   
    if (section === 'candidatures') {
      return (
        <div>
          <div className="ap-page-head">
            <div>
              <h2 className="ap-page-title">
                Dossiers de candidature {cycleParam ? `${CYCLE_LABELS[cycleParam]}` : ''}
              </h2>
              <p className="ap-page-sub">
                Instruction des dossiers déposés et validation des admissions
              </p>
            </div>
            <button
              type="button"
              onClick={chargerCandidatures}
              className="ap-btn ap-btn--ghost ap-btn--sm"
              title="Actualiser les candidatures"
            >
              <RefreshCw size={15} className={chargementCandidatures ? 'spin' : ''} /> Actualiser
            </button>
          </div>

          <div className="module-toolbar">
            <div className="module-search">
              <Search size={18} />
              <input
                type="text"
                placeholder="Rechercher par nom, prénom ou identifiant..."
                value={rechercheCandidature}
                onChange={(e) => setRechercheCandidature(e.target.value)}
              />
            </div>
            <div className="module-filters">
              {['tous', 'soumise', 'validee', 'rejetee', 'en_attente_paiement'].map((st) => (
                <button
                  key={st}
                  type="button"
                  className={`module-filter-btn ${filtreStatutCandidature === st ? 'active' : ''}`}
                  onClick={() => { setFiltreStatutCandidature(st); setSelection(new Set()) }}
                >
                  {st === 'tous' ? 'Tous' : st === 'soumise' ? 'À traiter' : LIBELLES_STATUT_CANDIDATURE[st]}
                </button>
              ))}
            </div>
            <select
              className="module-select"
              value={filtreAppelCandidature}
              onChange={(e) => { setFiltreAppelCandidature(e.target.value); setSelection(new Set()) }}
              aria-label="Filtrer par appel à candidature"
            >
              <option value="">Tous les appels</option>
              {appels.filter((a) => !cycleParam || a.cycle === cycleParam).map((a) => (
                <option key={a.uuid} value={a.uuid}>{a.titre || `Appel ${a.cycle}`}</option>
              ))}
            </select>
          </div>

          {selection.size > 0 && (
            <div className="sel-bar" role="region" aria-label="Actions sur la sélection">
              <strong>{selection.size} dossier{selection.size > 1 ? 's' : ''} sélectionné{selection.size > 1 ? 's' : ''}</strong>
              <button type="button" className="btn-action btn-action--success" onClick={() => ouvrirLot('valider')}>
                <CheckCircle size={15} /> Valider la sélection
              </button>
              <button type="button" className="btn-action btn-action--danger" onClick={() => ouvrirLot('rejeter')}>
                <XCircle size={15} /> Rejeter la sélection
              </button>
              <button type="button" className="btn-action" onClick={() => setSelection(new Set())}>Désélectionner</button>
            </div>
          )}

          <div className="ap-card ap-card--flush">
            {chargementCandidatures ? (
              <div style={{ padding: '3.5rem', display: 'flex', justifyContent: 'center' }}>
                <Loader mode="inline" label="Chargement des candidatures…" />
              </div>
            ) : filteredCandidatures.length === 0 ? (
              <div className="ap-empty" style={{ padding: '3rem', textAlign: 'center' }}>
                Aucune candidature trouvée.
              </div>
            ) : (
              <div className="module-table-wrap">
                <table className="ap-table" style={{ minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th className="sel-col">
                        <input
                          type="checkbox"
                          className="sel-box"
                          checked={toutSelectionne}
                          disabled={traitables.length === 0}
                          onChange={basculerTout}
                          aria-label="Sélectionner tous les dossiers à traiter"
                        />
                      </th>
                      <th>Candidat</th>
                      <th>Classe / Formation visée</th>
                      <th>Contact parent</th>
                      <th>Statut</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCandidatures.map((c) => (
                      <tr key={c.uuid ?? c.id} className={selection.has(c.uuid) ? 'sel-row--on' : ''}>
                        <td className="sel-col">
                          <input
                            type="checkbox"
                            className="sel-box"
                            checked={selection.has(c.uuid)}
                            disabled={!TRAITABLE(c)}
                            onChange={() => basculerSelection(c.uuid)}
                            aria-label={`Sélectionner ${c.nom} ${c.prenom}`}
                            title={TRAITABLE(c) ? undefined : 'Dossier déjà traité ou non finalisé'}
                          />
                        </td>
                        <td>
                          <div style={{ fontWeight: 700 }}>{c.nom} {c.prenom}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--sg-text-muted)' }}>
                            {[c.sexe === 'M' ? 'Masculin' : c.sexe === 'F' ? 'Féminin' : null, c.date_naissance ? `Né(e) le ${c.date_naissance}` : null].filter(Boolean).join(' • ') || '-'}
                            {c.reference ? ` • ${c.reference}` : ''}
                          </div>
                        </td>
                        <td>
                          <div>{c.classe_visee?.nom ?? 'Non assignée'}</div>
                          {c.appel?.titre && <div style={{ fontSize: '0.78rem', color: 'var(--sg-text-muted)' }}>{c.appel.titre}</div>}
                        </td>
                        <td>
                          <div>{[c.parent_prenom, c.parent_nom].filter(Boolean).join(' ') || c.nom_parent || '-'}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--sg-text-muted)' }}>{c.parent_telephone ?? c.telephone_parent ?? '-'}</div>
                        </td>
                        <td>
                          <span className={`status-pill status-pill--${c.statut}`}>
                            {LIBELLES_STATUT_CANDIDATURE[c.statut] ?? c.statut}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {TRAITABLE(c) ? (
                            <div style={{ display: 'inline-flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                onClick={() => ouvrirDetailCandidature(c)}
                                className="btn-action"
                                title="Voir les détails"
                              >
                                <Eye size={15} /> Détails
                              </button>
                              <button
                                type="button"
                                onClick={() => handleValiderCandidature(c)}
                                disabled={actionLoadingCandidature === c.uuid}
                                className="btn-action btn-action--success"
                                title="Valider l'admission"
                              >
                                <CheckCircle size={15} /> Valider
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRejeterCandidature(c)}
                                disabled={actionLoadingCandidature === c.uuid}
                                className="btn-action btn-action--danger"
                                title="Rejeter"
                              >
                                <XCircle size={15} /> Rejeter
                              </button>
                            </div>
                          ) : (
                            <div style={{ display: 'inline-flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                onClick={() => ouvrirDetailCandidature(c)}
                                className="btn-action"
                                title="Voir les détails"
                              >
                                <Eye size={15} /> Détails
                              </button>
                              <span style={{ fontSize: '0.8rem', color: 'var(--sg-text-muted)', alignSelf: 'center' }}>
                                {c.statut === 'en_attente_paiement' ? 'Paiement non confirmé' : c.statut === 'expiree' ? 'Délai dépassé' : 'Dossier traité'}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )
    }

    // Vue 3 : Vue d'ensemble (Dashboard Inscriptions)
    return (
      <VueEnsembleInscription
        anneeActive={anneeActive}
        cyclesActifsValides={cyclesActifsValides}
        cyclesAutorises={cyclesAutorises}
        appels={appels}
        candidatures={candidatures}
        chargementAppels={chargementAppels}
        chargementCandidatures={chargementCandidatures}
        base={base}
        handleOuvrirCreationAppel={handleOuvrirCreationAppel}
      />
    )
  }

  return (
    <ModuleLayout titre="Inscriptions" icone={UserCheck} nav={navInscription}>
      <div className="ap cfg">
        {/* Fil d'ariane + bandeau année : comme Scolarité */}
        {!estVueEnsemble && (
          <>
            <nav className="ap-bread" aria-label="Fil d'ariane">{migettes}</nav>

            <div className="cfg-annee-bandeau" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CalendarDays size={14} aria-hidden="true" />
                <span>Année :</span>
                <strong>{anneeActive?.libelle ?? '-'}</strong>
                {anneeActive && (
                  <span className={`cfg-statut-badge ${anneeActive.statut}`}>
                    {LIBELLES_STATUT[anneeActive.statut] ?? anneeActive.statut}
                  </span>
                )}
              </div>
              {toutesAnnees.length > 1 && (
                <select
                  className="ap-input"
                  style={{ maxWidth: 160, fontSize: '0.82rem', padding: '4px 8px', height: 'auto' }}
                  value={anneeActive?.uuid ?? ''}
                  onChange={(e) => {
                    const a = toutesAnnees.find((x) => x.uuid === e.target.value)
                    if (a) changerAnnee(a)
                  }}
                  aria-label="Choisir une année académique"
                >
                  {toutesAnnees.map((a) => (
                    <option key={a.uuid} value={a.uuid}>
                      {a.libelle} {a.statut === 'en_cours' ? '(En cours)' : a.statut === 'a_venir' ? '(À venir)' : '(Terminée)'}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </>
        )}

        {renduContenu()}
      </div>

      {/* Modale institutionnelle de création / édition d'appel */}
      <ModalAppelCandidature
        ouvert={modalAppelOuverte}
        onFermer={() => setModalAppelOuverte(false)}
        onEnregistrer={handleEnregistrerAppel}
        appelInitial={appelEnEdition}
        enCours={actionEnCoursAppel}
        cyclesDisponibles={cyclesDisponiblesIds}
        anneeActive={anneeActive}
      />

      {/* ── Modale détails candidature ── */}
      {candidatureDetail && (
        <div className="cfg-modale-fond" role="dialog" aria-modal="true" onClick={() => setCandidatureDetail(null)}>
          <div className="cfg-modale" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="cfg-modale-tete">
              <h3>Dossier de candidature</h3>
              <button type="button" className="ap-drawer-close" onClick={() => setCandidatureDetail(null)} aria-label="Fermer">
                <XCircle size={16} />
              </button>
            </div>
            <div className="cfg-modale-corps" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Spinner pendant chargement détail complet */}
              {loadingDetail && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.84rem', color: 'var(--sg-text-muted)' }}>
                  <Loader mode="button" /> Chargement du dossier complet…
                </div>
              )}

              {/* Statut */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className={`status-pill status-pill--${candidatureDetail.statut}`} style={{ fontSize: '0.88rem', padding: '4px 14px' }}>
                  {candidatureDetail.statut}
                </span>
                {candidatureDetail.motif_rejet && (
                  <span style={{ fontSize: '0.82rem', color: '#c0392b', fontStyle: 'italic' }}>
                    Motif : {candidatureDetail.motif_rejet}
                  </span>
                )}
              </div>

              {/* Identité candidat */}
              <div className="ap-card" style={{ padding: 16 }}>
                <p className="ap-label" style={{ marginBottom: 10, color: 'var(--primary,#047857)', fontWeight: 700 }}>
                  <User size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Identité du candidat
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {[
                    ['Nom', candidatureDetail.nom],
                    ['Prénom', candidatureDetail.prenom],
                    ['Sexe', candidatureDetail.sexe === 'M' ? 'Masculin' : candidatureDetail.sexe === 'F' ? 'Féminin' : '-'],
                    ['Date de naissance', candidatureDetail.date_naissance || '-'],
                    ['Téléphone', candidatureDetail.telephone || '-'],
                    ['Email', candidatureDetail.email || '-'],
                    ['Adresse', candidatureDetail.adresse || '-'],
                    ['Modalité d\'admission', candidatureDetail.type_inscription || '-'],
                    ['Niveau précédent', candidatureDetail.niveau_precedent || '-'],
                    ['Établissement précédent', candidatureDetail.etablissement_precedent || '-'],
                  ].map(([label, val]) => val && val !== '-' ? (
                    <div key={label}>
                      <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--sg-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                      <p style={{ margin: '2px 0 0', fontSize: '0.88rem', fontWeight: 600 }}>{val}</p>
                    </div>
                  ) : null)}
                </div>
              </div>

              {/* Parent / Tuteur */}
              {(candidatureDetail.parent_nom || candidatureDetail.parent_telephone) && (
                <div className="ap-card" style={{ padding: 16 }}>
                  <p className="ap-label" style={{ marginBottom: 10, color: 'var(--primary,#047857)', fontWeight: 700 }}>
                    <Users size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Parent / Tuteur
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {[
                      ['Nom', candidatureDetail.parent_nom],
                      ['Prénom', candidatureDetail.parent_prenom],
                      ['Lien', candidatureDetail.parent_lien],
                      ['Téléphone', candidatureDetail.parent_telephone],
                      ['Email', candidatureDetail.parent_email],
                    ].map(([label, val]) => val ? (
                      <div key={label}>
                        <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--sg-text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                        <p style={{ margin: '2px 0 0', fontSize: '0.88rem', fontWeight: 600 }}>{val}</p>
                      </div>
                    ) : null)}
                  </div>
                </div>
              )}

              {/* Classe / Formation */}
              <div className="ap-card" style={{ padding: 16 }}>
                <p className="ap-label" style={{ marginBottom: 6, color: 'var(--primary,#047857)', fontWeight: 700 }}>
                  <School size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Formation visée
                </p>
                <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>
                  {candidatureDetail.classe_visee?.nom ?? candidatureDetail.classe_nom ?? 'Non assignée'}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--sg-text-muted)' }}>
                  Soumis le {formaterDateHeure(candidatureDetail.date_soumission)}
                </p>
              </div>

              {/* Pièces justificatives */}
              {Array.isArray(candidatureDetail.pieces_justificatives) && candidatureDetail.pieces_justificatives.length > 0 && (
                <div className="ap-card" style={{ padding: 16 }}>
                  <p className="ap-label" style={{ marginBottom: 10, color: 'var(--primary,#047857)', fontWeight: 700 }}>
                    <Paperclip size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                    Pièces justificatives ({candidatureDetail.pieces_justificatives.length})
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {candidatureDetail.pieces_justificatives.map((p) => (
                      <div key={p.uuid} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 10, padding: '8px 12px', borderRadius: 8,
                        background: 'var(--sg-surface-2,#f8fafc)',
                        border: '1px solid var(--sg-border,#e2e8f0)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <FileText size={15} style={{ color: 'var(--primary,#047857)', flexShrink: 0 }} />
                          <div style={{ minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.nom_original}
                            </p>
                            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--sg-text-muted)' }}>
                              {p.libelle || p.type} · {p.statut_validation ?? 'en attente'}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="ap-btn ap-btn--ghost ap-btn--sm"
                          style={{ flexShrink: 0 }}
                          onClick={async () => {
                            try {
                              const r = await inscriptionService.urlPiece(p.uuid)
                              window.open(r?.url ?? r, '_blank', 'noopener')
                            } catch {
                              notify.error('Erreur', 'Impossible d\'accéder à ce fichier.')
                            }
                          }}
                        >
                          <Eye size={13} /> Voir
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
            <div className="cfg-modale-pied">
              {(candidatureDetail.statut === 'soumise' || candidatureDetail.statut === 'en_attente') && (
                <>
                  <button type="button" className="ap-btn ap-btn--danger"
                    onClick={() => { setCandidatureDetail(null); handleRejeterCandidature(candidatureDetail) }}>
                    <XCircle size={15} /> Rejeter
                  </button>
                  <button type="button" className="ap-btn"
                    onClick={() => { setCandidatureDetail(null); handleValiderCandidature(candidatureDetail) }}>
                    <CheckCircle size={15} /> Valider l'admission
                  </button>
                </>
              )}
              {!['soumise','en_attente'].includes(candidatureDetail.statut) && (
                <button type="button" className="ap-btn ap-btn--ghost" onClick={() => setCandidatureDetail(null)}>Fermer</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmation validation ── */}
      <ConfirmDialog
        open={!!confirmValidation}
        tone="primary"
        title="Valider l'admission"
        message={`Confirmez-vous la validation de la candidature de ${confirmValidation?.nom} ? Cette action créera l'apprenant dans la scolarité.`}
        confirmLabel="Valider l'admission"
        cancelLabel="Annuler"
        loading={actionLoadingCandidature === confirmValidation?.uuid}
        onConfirm={confirmerValidation}
        onCancel={() => setConfirmValidation(null)}
      />

      {/* ── Confirmation rejet avec motif ── */}
      <ConfirmDialog
        open={!!confirmRejet}
        tone="danger"
        title="Rejeter la candidature"
        message={`Vous êtes sur le point de rejeter le dossier de ${confirmRejet?.nom}.`}
        confirmLabel="Confirmer le rejet"
        cancelLabel="Annuler"
        loading={actionLoadingCandidature === confirmRejet?.uuid}
        onConfirm={confirmerRejet}
        onCancel={() => { setConfirmRejet(null); setMotifRejet('') }}
      >
        <div style={{ marginTop: 12 }}>
          <label className="cd-label" htmlFor="motif-rejet">Motif du rejet *</label>
          <textarea
            id="motif-rejet"
            className="cd-field"
            rows={3}
            maxLength={500}
            placeholder="Expliquez la raison du rejet (5 caractères minimum)…"
            value={motifRejet}
            onChange={(e) => setMotifRejet(e.target.value)}
          />
        </div>
      </ConfirmDialog>

      {/* ── Lot : validation ── */}
      <ConfirmDialog
        open={confirmLot === 'valider'}
        tone="primary"
        title={`Valider ${selection.size} candidature${selection.size > 1 ? 's' : ''}`}
        message="Chaque admission créera l'apprenant dans la scolarité. Un dossier déjà rejeté ou dont la classe est complète sera ignoré et signalé."
        confirmLabel="Valider la sélection"
        loading={lotEnCours}
        onConfirm={confirmerLot}
        onCancel={() => setConfirmLot(null)}
      />

      {/* ── Lot : rejet (motif unique) ── */}
      <ConfirmDialog
        open={confirmLot === 'rejeter'}
        tone="danger"
        title={`Rejeter ${selection.size} candidature${selection.size > 1 ? 's' : ''}`}
        message="Le même motif sera enregistré pour tous les dossiers sélectionnés. Un dossier déjà validé ne peut pas être rejeté."
        confirmLabel={motifLot.trim().length < 5 ? 'Saisissez un motif' : 'Confirmer le rejet'}
        loading={lotEnCours}
        onConfirm={confirmerLot}
        onCancel={() => { setConfirmLot(null); setMotifLot('') }}
      >
        <div style={{ marginTop: 12 }}>
          <label className="cd-label" htmlFor="motif-lot">Motif du rejet (commun au lot) *</label>
          <textarea
            id="motif-lot"
            className="cd-field"
            rows={3}
            maxLength={500}
            placeholder="Expliquez la raison du rejet (5 caractères minimum)…"
            value={motifLot}
            onChange={(e) => setMotifLot(e.target.value)}
          />
        </div>
      </ConfirmDialog>

      {/* ── Lot : résultat avec dossiers non traités ── */}
      <ConfirmDialog
        open={!!resultatLot}
        tone="warning"
        hideCancel
        title="Traitement partiel"
        message={`${resultatLot?.reussis ?? 0} dossier(s) traité(s), ${resultatLot?.echecs?.length ?? 0} non traité(s) :`}
        confirmLabel="Fermer"
        onConfirm={() => setResultatLot(null)}
        onCancel={() => setResultatLot(null)}
      >
        <ul className="cd-list">
          {(resultatLot?.echecs ?? []).map((e) => (
            <li key={e.uuid}><strong>{e.nom}</strong> : {e.message}</li>
          ))}
        </ul>
      </ConfirmDialog>

      {/* ── Confirmation clôture appel ── */}
      <ConfirmDialog
        open={!!confirmTerminer}
        tone="warning"
        title="Clôturer l'appel à candidature"
        message="Cette action est définitive. L'appel sera marqué comme terminé et aucune nouvelle candidature ne sera acceptée."
        confirmLabel="Clôturer définitivement"
        cancelLabel="Annuler"
        onConfirm={confirmerTerminer}
        onCancel={() => setConfirmTerminer(null)}
      />

      {/* ── Confirmation suppression appel ── */}
      <ConfirmDialog
        open={!!confirmSupprimer}
        tone="danger"
        title="Supprimer l'appel à candidature"
        message="Cette suppression est irréversible. Toutes les candidatures associées seront perdues."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        onConfirm={confirmerSupprimer}
        onCancel={() => setConfirmSupprimer(null)}
      />
    </ModuleLayout>
  )
}

/* ── Vue d'ensemble du module Inscriptions ── */
function VueEnsembleInscription({
  anneeActive,
  cyclesActifsValides,
  cyclesAutorises,
  appels,
  candidatures,
  chargementAppels,
  chargementCandidatures,
  base,
  handleOuvrirCreationAppel,
}) {
  const appelsOuverts = appels.filter((a) => a.statut === 'ouvert').length
  const candidaturesAttente = candidatures.filter((c) => c.statut === 'soumise' || c.statut === 'en_attente').length
  const candidaturesValidees = candidatures.filter((c) => c.statut === 'validee' || c.statut === 'admis').length

  const inactifs = cyclesAutorises.filter((id) => !cyclesActifsValides.some((c) => c.cycle === id))

  return (
    <>
      {/* Bandeau accueil institutionnel */}
      <section className="sc-welcome">
        <div>
          <h2 className="sc-welcome-title">Inscriptions & Admissions</h2>
          <p className="sc-welcome-sub">
            {anneeActive
              ? `Campagnes de recrutement pour l'année académique ${anneeActive.libelle}`
              : 'Gérez vos campagnes de recrutement et dossiers de candidature'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="ap-btn ap-btn--ghost ap-btn--sm"
          >
            <RefreshCw size={14} /> Actualiser
          </button>
          <button
            type="button"
            onClick={handleOuvrirCreationAppel}
            className="ap-btn ap-btn--gold ap-btn--sm"
          >
            <Plus size={16} /> Lancer un appel
          </button>
        </div>
      </section>

      {/* Statistiques clés */}
      <div className="sc-stats">
        <div className="sc-stat sc-stat--success">
          <div className="sc-stat-icon"><Megaphone size={20} aria-hidden="true" /></div>
          <div>
            <p className="sc-stat-val">
              {chargementAppels ? <span className="ap-skel" style={{ display: 'inline-block', width: 32, height: 22, borderRadius: 4 }} /> : appels.length}
            </p>
            <p className="sc-stat-lbl">Campagnes au total</p>
          </div>
        </div>
        <div className="sc-stat sc-stat--info">
          <div className="sc-stat-icon"><CheckCircle2 size={20} aria-hidden="true" /></div>
          <div>
            <p className="sc-stat-val">
              {chargementAppels ? <span className="ap-skel" style={{ display: 'inline-block', width: 32, height: 22, borderRadius: 4 }} /> : appelsOuverts}
            </p>
            <p className="sc-stat-lbl">Campagnes ouvertes</p>
          </div>
        </div>
        <div className="sc-stat sc-stat--warn">
          <div className="sc-stat-icon"><Users size={20} aria-hidden="true" /></div>
          <div>
            <p className="sc-stat-val">
              {chargementCandidatures ? <span className="ap-skel" style={{ display: 'inline-block', width: 32, height: 22, borderRadius: 4 }} /> : candidatures.length}
            </p>
            <p className="sc-stat-lbl">Candidatures reçues</p>
          </div>
        </div>
        <div className="sc-stat sc-stat--danger">
          <div className="sc-stat-icon"><Clock size={20} aria-hidden="true" /></div>
          <div>
            <p className="sc-stat-val">
              {chargementCandidatures ? <span className="ap-skel" style={{ display: 'inline-block', width: 32, height: 22, borderRadius: 4 }} /> : candidaturesAttente}
            </p>
            <p className="sc-stat-lbl">En attente d'instruction</p>
          </div>
        </div>
      </div>

      {/* Alertes d'information */}
      {!anneeActive && (
        <div className="sc-info">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <strong>Aucune année académique active</strong>
            <p>Veuillez configurer ou activer une année dans Scolarité avant de lancer des appels.</p>
          </div>
        </div>
      )}

      {cyclesActifsValides.length === 0 && (
        <div className="sc-info">
          <AlertTriangle size={17} aria-hidden="true" />
          <div>
            <strong>Aucun cycle actif pour cette année</strong>
            <p>
              Rendez-vous dans <Link to={lienEtablissement(slug, '/scolarite?section=cycles')}>Scolarité • Activer des cycles</Link> pour activer les cycles de votre établissement.
            </p>
          </div>
        </div>
      )}

      {/* Cycles actifs - Campagnes par cycle */}
      {cyclesActifsValides.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h3 className="sc-section-title">Campagnes par cycle d'enseignement</h3>
          <div className="sc-grid">
            {cyclesActifsValides.map((c) => {
              const Icon = CYCLE_ICONES[c.cycle] ?? School
              const nbAppelsCycle = appels.filter((a) => a.cycle === c.cycle).length
              return (
                <Link
                  key={c.uuid}
                  to={`${base}?cycle=${c.cycle}&section=appels`}
                  className="sc-card"
                >
                  <div className="sc-card-icon"><Icon size={26} aria-hidden="true" /></div>
                  <p className="sc-card-label">{CYCLE_LABELS[c.cycle]}</p>
                  <p className="sc-card-desc">
                    {nbAppelsCycle > 0 ? `${nbAppelsCycle} appel(s) configuré(s)` : 'Aucun appel actif'}
                  </p>
                  <ChevronRight size={15} className="sc-card-arrow" aria-hidden="true" />
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* Gestion globale */}
      <section style={{ marginBottom: 28 }}>
        <h3 className="sc-section-title">Gestion des recrutements</h3>
        <div className="sc-grid">
          <Link to={`${base}?section=appels`} className="sc-card">
            <div className="sc-card-icon"><Megaphone size={26} aria-hidden="true" /></div>
            <p className="sc-card-label">Appels à candidatures</p>
            <p className="sc-card-desc">Consulter, créer et paramétrer les appels</p>
            <ChevronRight size={15} className="sc-card-arrow" aria-hidden="true" />
          </Link>
          <Link to={`${base}?section=candidatures`} className="sc-card">
            <div className="sc-card-icon"><Users size={26} aria-hidden="true" /></div>
            <p className="sc-card-label">Dossiers de candidature</p>
            <p className="sc-card-desc">Examiner, valider ou rejeter les postulants</p>
            <ChevronRight size={15} className="sc-card-arrow" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </>
  )
}
