import { useMemo, useState } from 'react'
import PhoneInput from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { getExampleNumber } from 'libphonenumber-js'
import examples from 'libphonenumber-js/examples.mobile.json'
import flags from 'react-phone-number-input/flags'
import { CheckCircle2, Paperclip, X } from 'lucide-react'
import { acceptDepuisFormats, formatDate, tailleLisible } from './candidatureSchema'

function ChampTelephone({ id, label, required, erreur, value, onChange }) {
  const [country, setCountry] = useState('BJ')
  const exemple = useMemo(() => {
    try { return getExampleNumber(country, examples)?.formatNational() ?? '' } catch { return '' }
  }, [country])
  return (
    <div className="ap-field">
      <label className="ap-label" htmlFor={id}>{label}{required && <span className="wiz-req"> *</span>}</label>
      <div className={`ap-phone-wrap${erreur ? ' has-error' : ''}`}>
        <PhoneInput id={id} defaultCountry="BJ" flags={flags} placeholder={exemple} value={value} onChange={onChange}
          onCountryChange={(c) => c && setCountry(c)} limitMaxLength aria-invalid={!!erreur} />
      </div>
      {exemple && !erreur && <p className="ap-hint">Exemple : {exemple}</p>}
      {erreur && <p className="ap-error" role="alert">{erreur}</p>}
    </div>
  )
}

/** Un champ du schéma serveur (texte, date, choix, e-mail, téléphone, attestation). */
export function ChampDynamique({ champ, valeur, erreur, onChange }) {
  const id = `f-${champ.nom.replace(/\./g, '-')}`
  const req = champ.obligatoire && <span className="wiz-req"> *</span>

  if (champ.type === 'telephone') {
    return <ChampTelephone id={id} label={champ.label} required={champ.obligatoire} erreur={erreur} value={valeur ?? ''} onChange={(v) => onChange(v ?? '')} />
  }

  if (champ.type === 'attestation') {
    return (
      <div className={`ap-field wiz-attest${erreur ? ' has-error' : ''}`} style={{ gridColumn: '1 / -1' }}>
        <label className="wiz-check" htmlFor={id}>
          <input id={id} type="checkbox" checked={!!valeur} onChange={(e) => onChange(e.target.checked)} aria-invalid={!!erreur} />
          <span>{champ.label}{req}</span>
        </label>
        {erreur && <p className="ap-error" role="alert">{erreur}</p>}
      </div>
    )
  }

  if (champ.type === 'choix') {
    return (
      <div className="ap-field">
        <label className="ap-label" htmlFor={id}>{champ.label}{req}</label>
        <select id={id} className={`ap-input${erreur ? ' has-error' : ''}`} value={valeur ?? ''} onChange={(e) => onChange(e.target.value)} aria-invalid={!!erreur}>
          <option value="">{champ.obligatoire ? 'Sélectionner…' : '-'}</option>
          {champ.options.map((o) => <option key={o.valeur} value={o.valeur}>{o.label}</option>)}
        </select>
        {erreur && <p className="ap-error" role="alert">{erreur}</p>}
      </div>
    )
  }

  const type = champ.type === 'email' ? 'email' : champ.type === 'date' ? 'date' : 'text'
  return (
    <div className="ap-field">
      <label className="ap-label" htmlFor={id}>{champ.label}{req}</label>
      <input id={id} className={`ap-input${erreur ? ' has-error' : ''}`} type={type}
        value={valeur ?? ''} maxLength={champ.max || undefined}
        min={champ.min || undefined} max={champ.type === 'date' ? (champ.max || new Date().toISOString().slice(0, 10)) : undefined}
        autoComplete={champ.nom === 'email' ? 'email' : 'off'}
        onChange={(e) => onChange(e.target.value)} aria-invalid={!!erreur} />
      {champ.type === 'date' && (champ.min || champ.max) && !erreur && (
        <p className="ap-hint">
          {champ.min && champ.max ? `Entre le ${formatDate(champ.min)} et le ${formatDate(champ.max)} (inclus)` : champ.min ? `À partir du ${formatDate(champ.min)} (inclus)` : `Au plus tard le ${formatDate(champ.max)} (inclus)`}
        </p>
      )}
      {erreur && <p className="ap-error" role="alert">{erreur}</p>}
    </div>
  )
}

/** Une pièce à téléverser : formats, taille, obligatoire/facultative, retrait possible. */
export function ChampPiece({ piece, fichier, erreur, onChange }) {
  const id = `fichier-${piece.id}`
  return (
    <div className={`wiz-piece${erreur ? ' has-error' : ''}${fichier && !erreur ? ' is-ok' : ''}`}>
      <div className="wiz-piece-head">
        <label className="ap-label" htmlFor={id}>
          {piece.libelle}{piece.obligatoire ? <span className="wiz-req"> *</span> : <span className="wiz-muted"> (facultative)</span>}
        </label>
        <span className="wiz-chip">{piece.formats.join(' / ')} · {tailleLisible(piece.taille_max_octets)} max</span>
      </div>
      <div className="wiz-piece-row">
        <label htmlFor={id} className="wiz-filebtn"><Paperclip size={14} aria-hidden="true" />{fichier ? 'Changer le fichier' : 'Choisir un fichier'}</label>
        <input id={id} type="file" className="wiz-file" accept={acceptDepuisFormats(piece.formats)}
          onChange={(e) => { onChange(e.target.files?.[0] ?? null); e.target.value = '' }} />
        {fichier && (
          <span className="wiz-filename">
            <CheckCircle2 size={14} aria-hidden="true" /> {fichier.name} <small>({tailleLisible(fichier.size)})</small>
            <button type="button" className="wiz-x" onClick={() => onChange(null)} aria-label={`Retirer ${fichier.name}`}><X size={14} /></button>
          </span>
        )}
      </div>
      {erreur && <p className="ap-error" role="alert">{erreur}</p>}
    </div>
  )
}
