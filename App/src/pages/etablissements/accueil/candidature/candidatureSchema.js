/**
 * Aide au formulaire de candidature : contrôles de confort côté navigateur.
 * L'AUTORITÉ reste le serveur (CriteresEvaluateur) ; ces contrôles évitent seulement un aller-retour inutile.
 * Aucune règle n'est codée ici : tout vient du schéma `appel.formulaire` publié par le backend.
 */
import { isValidPhoneNumber } from 'libphonenumber-js'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
}

export function formatDateHeure(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatMontant(montant, devise) {
  const d = devise === 'XOF' || !devise ? 'FCFA' : devise
  return `${Number(montant).toLocaleString('fr-FR')} ${d}`
}

export function tailleLisible(octets) {
  if (octets >= 1048576) return `${(octets / 1048576).toFixed(octets % 1048576 === 0 ? 0 : 1)} Mo`
  return `${Math.max(1, Math.round(octets / 1024))} Ko`
}

/** ['PDF','JPG'] → '.pdf,.jpg,.jpeg' pour l'attribut accept. */
export function acceptDepuisFormats(formats = []) {
  const ext = new Set()
  formats.forEach((f) => {
    const x = String(f).toLowerCase()
    ext.add(`.${x}`)
    if (x === 'jpg') ext.add('.jpeg')
  })
  return [...ext].join(',')
}

export function erreurFichier(fichier, piece) {
  if (!fichier) return null
  const nom = fichier.name.toLowerCase()
  const ext = nom.includes('.') ? nom.split('.').pop() : ''
  const formats = (piece.formats ?? []).map((f) => f.toLowerCase())
  const extNorm = ext === 'jpeg' ? 'jpg' : ext
  if (formats.length && !formats.includes(extNorm)) {
    return `Format non accepté. Formats autorisés : ${formats.join(', ').toUpperCase()}.`
  }
  if (fichier.size <= 0) return 'Le fichier est vide.'
  if (piece.taille_max_octets && fichier.size > piece.taille_max_octets) {
    return `Le fichier dépasse la taille maximale de ${tailleLisible(piece.taille_max_octets)}.`
  }
  return null
}

const vide = (v) => v === undefined || v === null || String(v).trim() === ''

/** Valide un champ du schéma ; renvoie un message ou null. */
export function erreurChamp(champ, valeur) {
  if (champ.type === 'attestation') {
    return champ.obligatoire && !valeur ? 'Vous devez confirmer cette condition pour continuer.' : null
  }
  if (vide(valeur)) return champ.obligatoire ? `${champ.label} est obligatoire.` : null
  if (champ.type === 'email' && !EMAIL_RE.test(String(valeur).trim())) return 'Adresse e-mail invalide.'
  if (champ.type === 'telephone' && !isValidPhoneNumber(String(valeur))) return 'Numéro de téléphone invalide.'
  if (champ.type === 'date') {
    const v = String(valeur)
    if (champ.min && v < champ.min) return `Date hors critère : à partir du ${formatDate(champ.min)} (inclus).`
    if (champ.max && v > champ.max) return `Date hors critère : au plus tard le ${formatDate(champ.max)} (inclus).`
    if (new Date(`${v}T00:00:00`) > new Date()) return 'La date ne peut pas être dans le futur.'
  }
  if (champ.type === 'choix' && champ.options?.length && !champ.options.some((o) => o.valeur === valeur)) {
    return 'Valeur non autorisée.'
  }
  return null
}

/** Erreurs d'une étape (champs ou pièces). Clés = noms du schéma ; pièces = `fichiers.pN`. */
export function erreursEtape(etape, form, fichiers) {
  const e = {}
  ;(etape.champs ?? []).forEach((c) => {
    const m = erreurChamp(c, form[c.nom])
    if (m) e[c.nom] = m
  })
  ;(etape.pieces ?? []).forEach((p) => {
    const f = fichiers[p.id]
    if (!f) { if (p.obligatoire) e[`fichiers.${p.id}`] = `La pièce « ${p.libelle} » est obligatoire.` }
    else {
      const m = erreurFichier(f, p)
      if (m) e[`fichiers.${p.id}`] = m
    }
  })
  return e
}

/** Contact exigé par l'appel (ou par le paiement) : au moins un téléphone ou e-mail, du candidat ou du parent. */
export function erreurContact(schema, form) {
  if (!schema?.contact_requis) return null
  const ok = ['email', 'telephone', 'parent_email', 'parent_telephone'].some((k) => !vide(form[k]))
  return ok ? null : { telephone: 'Un numéro de téléphone ou une adresse e-mail est requis.' }
}

/** Index étape → noms de champs, pour ramener le candidat sur l'étape contenant une erreur serveur. */
export function etapeDeLErreur(etapes, cle) {
  return etapes.findIndex((et) =>
    (et.champs ?? []).some((c) => c.nom === cle) || (et.pieces ?? []).some((p) => `fichiers.${p.id}` === cle),
  )
}

export function brouillonCle(slug, appelUuid) {
  return `sigapei:candidature:brouillon:${slug}:${appelUuid}`
}

/** Brouillon : texte uniquement. Jamais de fichier, jamais de donnée de paiement. */
export function lireBrouillon(cle) {
  try {
    const r = JSON.parse(window.sessionStorage.getItem(cle) || 'null')
    return r && typeof r === 'object' ? r : null
  } catch { return null }
}
export function ecrireBrouillon(cle, valeur) {
  try { window.sessionStorage.setItem(cle, JSON.stringify(valeur)) } catch { /* stockage indisponible */ }
}
export function effacerBrouillon(cle) {
  try { window.sessionStorage.removeItem(cle) } catch { /* noop */ }
}

/** FormData du dépôt à partir du schéma : noms normalisés pour le backend. */
export function construireFormData({ form, fichiers, appelUuid, captcha, piege }) {
  const fd = new FormData()
  fd.set('appel_uuid', appelUuid)
  if (captcha) fd.set('captcha_token', captcha)
  fd.set('site_web', piege || '')
  Object.entries(form).forEach(([nom, v]) => {
    if (nom.startsWith('attestations.')) {
      if (v) fd.set(`attestations[${nom.slice('attestations.'.length)}]`, '1')
    } else if (!vide(v)) {
      fd.set(nom, String(v).trim())
    }
  })
  Object.entries(fichiers).forEach(([id, f]) => { if (f) fd.set(`fichiers[${id}]`, f) })
  return fd
}
