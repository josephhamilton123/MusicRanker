<?php

declare(strict_types=1);

namespace App\Controllers;

use App\HttpException;
use App\Json;
use App\Services\Spotify;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Psr7\Response;

final class SpotifyController
{
    public function __construct(private Spotify $spotify)
    {
    }

    public function status(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::write($response, $this->spotify->status());
    }

    public function authorize(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $returnTo = (string) ($request->getQueryParams()['return'] ?? '');

        return Json::write($response, [
            'url' => $this->spotify->authorizeUrl($returnTo),
        ]);
    }

    public function callback(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $params = $request->getQueryParams();
        $error = (string) ($params['error'] ?? '');
        if ($error !== '') {
            $returnTo = $this->spotify->returnTarget();
            $separator = str_contains($returnTo, '?') ? '&' : '?';

            return $this->redirect($returnTo . $separator . 'spotify=denied');
        }

        try {
            $returnTo = $this->spotify->finishLogin((string) ($params['code'] ?? ''), (string) ($params['state'] ?? ''));
        } catch (HttpException $exception) {
            $returnTo = $this->spotify->returnTarget();
            $separator = str_contains($returnTo, '?') ? '&' : '?';

            return $this->redirect($returnTo . $separator . 'spotify=error&message=' . rawurlencode($exception->getMessage()));
        }

        $separator = str_contains($returnTo, '?') ? '&' : '?';

        return $this->redirect($returnTo . $separator . 'spotify=connected');
    }

    public function disconnect(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $this->spotify->disconnect();

        return Json::write($response, ['connected' => false]);
    }

    public function playlists(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::write($response, $this->spotify->playlists());
    }

    public function artists(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        return Json::write($response, $this->spotify->artists());
    }

    public function search(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $query = (string) ($request->getQueryParams()['q'] ?? '');

        return Json::write($response, $this->spotify->searchArtists($query));
    }

    public function preview(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $body = $request->getParsedBody();
        if (!is_array($body)) {
            throw new HttpException(400, 'Expected a JSON object.');
        }
        $selections = $body['selections'] ?? [];
        if (!is_array($selections)) {
            throw new HttpException(422, 'Select playlists or artists.');
        }

        return Json::write($response, $this->spotify->collect(
            $selections,
            (string) ($body['depth'] ?? 'albums'),
            (bool) ($body['include_singles'] ?? false),
        ));
    }

    private function redirect(string $location): ResponseInterface
    {
        return (new Response(302))->withHeader('Location', $location);
    }

}
