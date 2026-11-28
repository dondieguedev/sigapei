/**
 * Garde d'accès aux routes d'encaissement.
 *  - Appel serveur à serveur (Inscription, Scolarité…) : en-tête X-Internal-Secret, comparaison en temps constant.
 *  - Sinon : jeton JWT Identité obligatoire, rôle administrateur (ou super_admin), limité à SON établissement.
 * Aucune route d'encaissement n'est plus accessible sans authentification.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { JwtGuard } from './jwt.guard';

const SECRETS_PLACEHOLDERS = ['change-me', 'secret', 'your-secret', 'default-secret', 'change-me-shared-secret-gateway'];

export function secretInterneValide(recu: string | undefined, attendu: string | undefined): boolean {
  if (!recu || !attendu || attendu.length < 8 || SECRETS_PLACEHOLDERS.includes(attendu)) return false;
  const a = Buffer.from(recu);
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class InterneGuard implements CanActivate {
  constructor(protected readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const recu = req.headers['x-internal-secret'];
    if (!secretInterneValide(typeof recu === 'string' ? recu : undefined, this.config.get<string>('internalApiSecret'))) {
      throw new ForbiddenException({ code: 'ACCES_INTERNE_REQUIS', message: 'Accès réservé aux services internes.' });
    }
    (req as unknown as Record<string, unknown>).roleCode = 'systeme';
    return true;
  }
}

@Injectable()
export class AccesEncaissementGuard extends InterneGuard {
  private readonly jwt: JwtGuard;

  constructor(config: ConfigService) {
    super(config);
    this.jwt = new JwtGuard(config);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.headers['x-internal-secret'] !== undefined) return super.canActivate(ctx);

    if (!req.headers.authorization) throw new UnauthorizedException({ code: 'NON_AUTHENTIFIE', message: 'Authentification requise.' });
    this.jwt.canActivate(ctx);

    const r = req as unknown as Record<string, string | null>;
    if (r.roleCode === 'super_admin') return true;
    if (r.roleCode !== 'administrateur') {
      throw new ForbiddenException({ code: 'ROLE_INSUFFISANT', message: 'Rôle administrateur requis.' });
    }
    const etab = (req.params as Record<string, string>).etablissementUuid;
    if (!etab || !r.etablissementUuid || r.etablissementUuid !== etab) {
      throw new ForbiddenException({ code: 'ETABLISSEMENT_INTERDIT', message: "Cet établissement n'est pas le vôtre." });
    }
    return true;
  }
}
