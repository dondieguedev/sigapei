/**
 * Appels à candidature - lecture publique (sans authentification).
 * Utilise fetch() natif directement vers le microservice inscription.
 * CORS autorisé côté backend (Access-Control-Allow-Origin: *).
 */
import { ENV } from '../../config/commun/env'

const BASE = (ENV.services.inscription || 'http://localhost:4003').replace(/\/+$/, '')

/** `null` = introuvable (404) ; une panne réseau ou serveur LÈVE une erreur (au lieu d'afficher « aucun appel »). */
async function getPublic(path) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } })
  } catch {
    throw new Error('Impossible de joindre le service. Vérifiez votre connexion.')
  }
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Le service est momentanément indisponible. Réessayez dans un instant.')
  return res.json()
}

export const appelsPublicsService = {
  /** Lister tous les appels d'un établissement par slug ou UUID */
  listerTous: async (etablissementUuid, slug) => {
    const params = new URLSearchParams()
    if (etablissementUuid) params.set('etablissement_uuid', etablissementUuid)
    else if (slug) params.set('slug', slug)
    const r = await getPublic(`/v1/public/appels-candidatures?${params}`)
    return Array.isArray(r?.data) ? r.data : []
  },

  /** Lister par cycle */
  listerParCycle: async (etablissementUuid, cycle) => {
    const params = new URLSearchParams({ etablissement_uuid: etablissementUuid, cycle })
    const r = await getPublic(`/v1/public/appels-candidatures?${params}`)
    return Array.isArray(r?.data) ? r.data : []
  },

  /** Détail d'un appel */
  afficher: async (uuid) => {
    const r = await getPublic(`/v1/public/appels-candidatures/${uuid}`)
    return r?.data ?? null
  },
}
