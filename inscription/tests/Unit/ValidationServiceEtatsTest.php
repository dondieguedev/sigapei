<?php

namespace Tests\Unit;

use App\candidatures\CandidatureException;
use App\pieces_justificatives\PieceUploadService;
use PHPUnit\Framework\TestCase;

/**
 * Tests purs (sans base). Les scénarios de base (machine d'états, lot, concurrence, critères)
 * sont à compléter en tests Feature avec la base de test du projet.
 */
class ValidationServiceEtatsTest extends TestCase
{
    public function test_formats_de_pieces_sont_normalises(): void
    {
        $this->assertSame(['jpg', 'png'], PieceUploadService::formatsAutorises('JPEG, PNG'));
        $this->assertSame(['pdf', 'jpg'], PieceUploadService::formatsAutorises('PDF / JPG'));
        $this->assertSame(['pdf', 'jpg', 'png'], PieceUploadService::formatsAutorises(''));
        $this->assertSame(['pdf'], PieceUploadService::formatsAutorises('doc, pdf'));
    }

    public function test_exception_porte_code_http_et_details(): void
    {
        $e = new CandidatureException('x', 'CRITERES_NON_REMPLIS', 422, ['date_naissance' => 'hors bornes']);
        $this->assertSame(422, $e->http);
        $this->assertSame('hors bornes', $e->details['date_naissance']);
    }
}
