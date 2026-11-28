import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { InterneGuard } from '../common/guards/acces-encaissement.guard';
import { EncaissementService } from './encaissement.service';

const DEVISES = ['XOF', 'XAF', 'GNF', 'CDF'];
const OBJETS = ['candidature', 'inscription', 'scolarite'];

/** Routes de lecture réservées aux autres microservices (secret interne) : /v1/interne/... */
@Controller('interne/etablissements/:etablissementUuid')
@UseGuards(InterneGuard)
export class EncaissementInterneController {
  constructor(private readonly service: EncaissementService) {}

  /** Modes d'encaissement actifs et accordés à l'établissement (filtrables par montant). */
  @Get('modes-encaissement')
  async modes(
    @Param('etablissementUuid', ParseUUIDPipe) etablissementUuid: string,
    @Query('devise') devise = 'XOF',
    @Query('montant') montant?: string,
  ) {
    if (!DEVISES.includes(devise)) throw new BadRequestException({ code: 'DEVISE_INVALIDE', message: 'Devise non prise en charge.' });
    if (montant !== undefined && !/^\d{1,15}$/.test(montant)) throw new BadRequestException({ code: 'MONTANT_INVALIDE', message: 'Montant invalide.' });
    return this.service.modesEncaissementActifs(etablissementUuid, devise, montant !== undefined ? BigInt(montant) : undefined);
  }

  /** Statut du dernier encaissement d'un objet métier (réinterroge l'agrégateur si besoin). */
  @Get('encaissements/par-objet/:objetType/:objetUuid')
  async parObjet(
    @Param('etablissementUuid', ParseUUIDPipe) etablissementUuid: string,
    @Param('objetType') objetType: string,
    @Param('objetUuid', ParseUUIDPipe) objetUuid: string,
  ) {
    if (!OBJETS.includes(objetType)) throw new BadRequestException({ code: 'OBJET_INVALIDE', message: "Type d'objet inconnu." });
    return this.service.obtenirParObjet(etablissementUuid, objetType, objetUuid);
  }
}
