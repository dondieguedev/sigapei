/**
 * Candidature publique (sans JWT) : dépôt, suivi et paiement des frais.
 * Les erreurs portent un `kind` exploitable par l'interface :
 *   validation (422, `details` par champ) | captcha | limite (429) | conflit (409) | paiement | reseau | serveur
 */
import { ENV } from '../../config/commun/env'

const BASE = (ENV.services.inscription || 'http://localhost:4003').replace(/\/+$/, '')

export class ErreurCandidature extends Error {
  constructor(message, { kind = 'serveur', code = null, status = 0, details = {} } = {}) {
    super(message)
    this.name = 'ErreurCandidature'
    this.kind = kind
    this.code = code
    this.status = status
    this.details = details
  }
}

function genre(status, code) {
  if (code === 'CAPTCHA_INVALIDE') return 'captcha'
  if (status === 429) return 'limite'
  if (status === 422) return 'validation'
  if (status === 409 || status === 410) return 'conflit'
  if (status === 502 || status === 503) return 'paiement'
  return 'serveur'
}

async function appeler(path, options = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } })
  } catch {
    throw new ErreurCandidature('Connexion impossible. Vérifiez votre réseau et réessayez.', { kind: 'reseau' })
  }
  let r = null
  try { r = await res.json() } catch { /* corps non JSON */ }
  if (!res.ok) {
    const code = r?.code_erreur ?? r?.error?.code ?? null
    const details = r?.details ?? r?.error?.details ?? {}
    throw new ErreurCandidature(
      r?.message ?? r?.error?.message ?? 'Une erreur est survenue. Veuillez réessayer.',
      { kind: genre(res.status, code), code, status: res.status, details: details && typeof details === 'object' ? details : {} },
    )
  }
  return r?.donnees ?? r?.data ?? r
}

export const candidaturePubliqueService = {
  /** Dépôt (multipart) : champs, `fichiers[pN]`, `attestations[cN]`, `captcha_token`, `slug`. */
  soumettreFd: (slug, formData) => {
    formData.set('slug', slug)
    return appeler('/v1/public/candidatures', { method: 'POST', body: formData })
  },

  suivi: (slug, reference) =>
    appeler(`/v1/public/candidatures/${encodeURIComponent(reference)}/suivi?slug=${encodeURIComponent(slug)}`),

  modesPaiement: (slug, reference) =>
    appeler(`/v1/public/candidatures/${encodeURIComponent(reference)}/paiement/modes?slug=${encodeURIComponent(slug)}`),

  payer: (slug, reference, agregateur, urlRetour) =>
    appeler(`/v1/public/candidatures/${encodeURIComponent(reference)}/paiement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, agregateur, url_retour: urlRetour }),
    }),
}
