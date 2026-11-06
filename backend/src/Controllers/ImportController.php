<?php

declare(strict_types=1);

namespace App\Controllers;

use App\HttpException;
use App\Json;
use App\Services\Importer;
use PDO;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

final class ImportController
{
    public function __construct(private PDO $pdo)
    {
    }

    public function import(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $body = $request->getParsedBody();
        if (!is_array($body) || !is_array($body['albums'] ?? null)) {
            throw new HttpException(400, 'Expected an albums array.');
        }

        $stats = (new Importer($this->pdo))->import($body['albums']);

        return Json::write($response, $stats, 201);
    }
}
