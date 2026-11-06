<?php

declare(strict_types=1);

namespace App\Controllers;

use App\HttpException;
use App\Json;
use App\Services\AlbumStats;
use App\Support\TrackPresenter;
use PDO;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;

final class AlbumController
{
    public function __construct(private PDO $pdo)
    {
    }

    public function index(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $albums = $this->pdo->query(
            'SELECT * FROM albums ORDER BY release_year DESC, artist ASC, title ASC'
        )->fetchAll();
        $tracks = $this->tracksGrouped();
        $payload = [];

        foreach ($albums as $album) {
            $presented = $tracks[(int) $album['id']] ?? [];
            $payload[] = [
                ...$this->presentAlbum($album),
                'summary' => AlbumStats::fromTracks($presented),
                'tracks' => $this->catalogTracks($presented),
            ];
        }

        return Json::write($response, $payload);
    }

    public function create(ServerRequestInterface $request, ResponseInterface $response): ResponseInterface
    {
        $fields = $this->validateAlbum($this->body($request), true);
        $stmt = $this->pdo->prepare(
            'INSERT INTO albums (title, release_year, artist, cover_art_url) VALUES (:title, :release_year, :artist, :cover_art_url)'
        );
        $stmt->execute($fields);

        return Json::write($response, $this->findOrFail((int) $this->pdo->lastInsertId()), 201);
    }

    public function update(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $id = (int) $args['id'];
        $this->requireAlbum($id);
        $fields = $this->validateAlbum($this->body($request), false);
        if ($fields === []) {
            throw new HttpException(422, 'No album fields to update.');
        }

        $sets = [];
        foreach (array_keys($fields) as $column) {
            $sets[] = $column . ' = :' . $column;
        }
        $fields['id'] = $id;
        $stmt = $this->pdo->prepare('UPDATE albums SET ' . implode(', ', $sets) . ' WHERE id = :id');
        $stmt->execute($fields);

        return Json::write($response, $this->findOrFail($id));
    }

    public function delete(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $stmt = $this->pdo->prepare('DELETE FROM albums WHERE id = :id');
        $stmt->execute(['id' => (int) $args['id']]);
        if ($stmt->rowCount() === 0) {
            throw new HttpException(404, 'Album not found.');
        }

        return $response->withStatus(204);
    }

    public function tracks(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $id = (int) $args['id'];
        $album = $this->findOrFail($id);

        return Json::write($response, [
            'album' => $album,
            'tracks' => $this->tracksFor($id),
            'summary' => $album['summary'],
        ]);
    }

    private function findOrFail(int $id): array
    {
        $album = $this->requireAlbum($id);
        $tracks = $this->tracksFor($id);

        return [
            ...$this->presentAlbum($album),
            'summary' => AlbumStats::fromTracks($tracks),
            'tracks' => $this->catalogTracks($tracks),
        ];
    }

    private function requireAlbum(int $id): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM albums WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $album = $stmt->fetch();
        if (!$album) {
            throw new HttpException(404, 'Album not found.');
        }

        return $album;
    }

    private function tracksFor(int $albumId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM tracks WHERE album_id = :album_id ORDER BY track_number ASC, id ASC'
        );
        $stmt->execute(['album_id' => $albumId]);

        return array_map([TrackPresenter::class, 'present'], $stmt->fetchAll());
    }

    private function tracksGrouped(): array
    {
        $rows = $this->pdo->query(
            'SELECT * FROM tracks ORDER BY album_id ASC, track_number ASC, id ASC'
        )->fetchAll();
        $grouped = [];
        foreach ($rows as $row) {
            $grouped[(int) $row['album_id']][] = TrackPresenter::present($row);
        }

        return $grouped;
    }

    /**
     * @param list<array<string, mixed>> $tracks
     * @return list<array{id: int, title: string, track_number: int}>
     */
    private function catalogTracks(array $tracks): array
    {
        return array_map(static fn (array $track): array => [
            'id' => (int) $track['id'],
            'title' => (string) $track['title'],
            'track_number' => (int) $track['track_number'],
        ], $tracks);
    }

    private function presentAlbum(array $album): array
    {
        return [
            'id' => (int) $album['id'],
            'title' => $album['title'],
            'release_year' => (int) $album['release_year'],
            'artist' => $album['artist'],
            'cover_art_url' => $album['cover_art_url'],
            'created_at' => $album['created_at'],
            'updated_at' => $album['updated_at'],
        ];
    }

    private function body(ServerRequestInterface $request): array
    {
        $body = $request->getParsedBody();
        if (!is_array($body)) {
            throw new HttpException(400, 'Expected a JSON object.');
        }

        return $body;
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    private function validateAlbum(array $body, bool $creating): array
    {
        $fields = [];

        if ($creating || array_key_exists('title', $body)) {
            $title = trim((string) ($body['title'] ?? ''));
            if ($title === '' || $this->length($title) > 255) {
                throw new HttpException(422, 'Album title is required and must be 255 characters or fewer.');
            }
            $fields['title'] = $title;
        }

        if ($creating || array_key_exists('artist', $body)) {
            $artist = trim((string) ($body['artist'] ?? ''));
            if ($artist === '' || $this->length($artist) > 255) {
                throw new HttpException(422, 'Artist is required and must be 255 characters or fewer.');
            }
            $fields['artist'] = $artist;
        }

        if ($creating || array_key_exists('release_year', $body)) {
            $year = $body['release_year'] ?? null;
            if (is_bool($year) || !is_numeric($year) || (int) $year != $year) {
                throw new HttpException(422, 'Release year must be a whole number.');
            }
            $year = (int) $year;
            if ($year < 1900 || $year > 2100) {
                throw new HttpException(422, 'Release year must be between 1900 and 2100.');
            }
            $fields['release_year'] = $year;
        }

        if ($creating || array_key_exists('cover_art_url', $body)) {
            $cover = trim((string) ($body['cover_art_url'] ?? ''));
            if ($cover === '') {
                $fields['cover_art_url'] = null;
            } elseif ($this->length($cover) > 512 || !preg_match('#^https?://#i', $cover)) {
                throw new HttpException(422, 'Cover art URL must be an http(s) URL up to 512 characters.');
            } else {
                $fields['cover_art_url'] = $cover;
            }
        }

        return $fields;
    }

    private function length(string $value): int
    {
        return function_exists('mb_strlen') ? mb_strlen($value) : strlen($value);
    }
}
