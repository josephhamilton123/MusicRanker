<?php

declare(strict_types=1);

use App\Controllers\AlbumController;
use App\Controllers\ImportController;
use App\Controllers\SpotifyController;
use App\Controllers\TrackController;
use App\Database;
use App\HttpException;
use App\Json;
use App\Services\Spotify;
use Dotenv\Dotenv;
use Psr\Http\Message\ServerRequestInterface;
use Slim\Exception\HttpException as SlimHttpException;
use Slim\Factory\AppFactory;
use Slim\Psr7\Response;

if (!is_file(__DIR__ . '/../vendor/autoload.php')) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Backend dependencies are missing. Run composer install in the backend directory.']);
    exit(1);
}

require __DIR__ . '/../vendor/autoload.php';

Dotenv::createImmutable(dirname(__DIR__))->safeLoad();

$app = AppFactory::create();

$pdo = null;
try {
    $pdo = Database::connect();
    $pdo->query('SELECT 1 FROM albums LIMIT 1');
} catch (Throwable $exception) {
    $pdo = null;
}

$app->get('/api/health', function (ServerRequestInterface $request, $response) use ($pdo) {
    if ($pdo === null) {
        return Json::write($response, [
            'ok' => false,
            'error' => 'Database is not ready. Run php bin/migrate.php.',
        ], 503);
    }

    return Json::write($response, ['ok' => true]);
});

if ($pdo !== null) {
    $spotifyService = new Spotify();
    $albums = new AlbumController($pdo);
    $tracks = new TrackController($pdo, $spotifyService);

    $app->get('/api/albums', [$albums, 'index']);
    $app->post('/api/albums', [$albums, 'create']);
    $app->patch('/api/albums/{id:[0-9]+}', [$albums, 'update']);
    $app->delete('/api/albums/{id:[0-9]+}', [$albums, 'delete']);
    $app->get('/api/albums/{id:[0-9]+}/tracks', [$albums, 'tracks']);
    $app->post('/api/albums/{id:[0-9]+}/tracks', [$tracks, 'createBatch']);
    $app->put('/api/albums/{id:[0-9]+}/tracks/order', [$tracks, 'reorder']);
    $app->get('/api/tracks/{id:[0-9]+}/play', [$tracks, 'play']);
    $app->patch('/api/tracks/{id:[0-9]+}', [$tracks, 'update']);
    $app->delete('/api/tracks/{id:[0-9]+}', [$tracks, 'delete']);

    $imports = new ImportController($pdo);
    $spotify = new SpotifyController($spotifyService);
    $app->post('/api/import', [$imports, 'import']);
    $app->get('/api/spotify/status', [$spotify, 'status']);
    $app->get('/api/spotify/authorize', [$spotify, 'authorize']);
    $app->get('/api/spotify/callback', [$spotify, 'callback']);
    $app->post('/api/spotify/disconnect', [$spotify, 'disconnect']);
    $app->get('/api/spotify/playlists', [$spotify, 'playlists']);
    $app->get('/api/spotify/artists', [$spotify, 'artists']);
    $app->get('/api/spotify/search', [$spotify, 'search']);
    $app->post('/api/spotify/preview', [$spotify, 'preview']);
} else {
    $app->any('/api/{routes:.+}', function (ServerRequestInterface $request, $response) {
        return Json::write($response, [
            'error' => 'Database is not ready. Run php bin/migrate.php.',
        ], 503);
    });
}

$app->addRoutingMiddleware();
$app->addBodyParsingMiddleware();

$errorMiddleware = $app->addErrorMiddleware(false, false, false);
$errorMiddleware->setDefaultErrorHandler(
    function (
        ServerRequestInterface $request,
        Throwable $exception,
        bool $displayErrorDetails,
        bool $logErrors,
        bool $logErrorDetails,
    ) use ($app) {
        $status = 500;
        $message = 'Server error.';
        if ($exception instanceof HttpException) {
            $status = $exception->status;
            $message = $exception->getMessage();
        } elseif ($exception instanceof SlimHttpException) {
            $status = $exception->getCode() >= 400 ? $exception->getCode() : 500;
            $message = $exception->getMessage() !== '' ? $exception->getMessage() : 'Request failed.';
        } elseif ($exception instanceof PDOException) {
            $status = 500;
            $message = 'Database error.';
        }

        $response = $app->getResponseFactory()->createResponse();

        return Json::write($response, ['error' => $message], $status);
    }
);

$app->add(function (ServerRequestInterface $request, $handler) {
    $requestOrigin = $request->getHeaderLine('Origin');
    $origin = preg_match('#^https?://(localhost|127\.0\.0\.1)(:\d+)?$#', $requestOrigin) === 1
        ? $requestOrigin
        : 'http://localhost:3000';

    $headers = [
        'Access-Control-Allow-Origin' => $origin,
        'Access-Control-Allow-Headers' => 'Content-Type, Authorization',
        'Access-Control-Allow-Methods' => 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Vary' => 'Origin',
    ];

    if (strtoupper($request->getMethod()) === 'OPTIONS') {
        $response = new Response(204);
    } else {
        $response = $handler->handle($request);
    }

    foreach ($headers as $name => $value) {
        $response = $response->withHeader($name, $value);
    }

    return $response;
});

$app->run();
