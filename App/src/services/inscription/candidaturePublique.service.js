/**
 * Soumission publique d'une candidature (sans JWT).
 */
import { ENV } from '../../config/commun/env'

const BASE = (ENV.services.inscription || 'http://localhost:4003').replace(/\/+$/, '')

export const candidaturePubliqueService = {
  soumettre: async (slug, donnees) => {
    const res = await fetch(`${BASE}/v1/public/candidatures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ slug, ...donnees }),
    })
    const r = await res.json()
    if (!res.ok) {
      const msg = r?.error?.message ?? r?.message ?? 'Erreur lors de la soumission.'
      throw new Error(msg)
    }
    return r
  },

  /** Soumission avec fichiers (FormData) */
  soumettreFd: async (slug, formData) => {
    const res = await fetch(`${BASE}/v1/public/candidatures`, {
      method: 'POST',
      headers: { Accept: 'application/json' }, // pas de Content-Type : laissé au navigateur pour le multipart
      body: formData,
    })
    const r = await res.json()
    if (!res.ok) {
      const msg = r?.error?.message ?? r?.message ?? 'Erreur lors de la soumission.'
      throw new Error(msg)
    }
    return r
  },
}
