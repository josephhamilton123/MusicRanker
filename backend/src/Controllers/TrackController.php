<?php

declare(strict_types=1);

namespace App\Controllers;

use App\HttpException;
use App\Json;
use App\Services\ScoreCalculator;
use App\Services\Spotify;
use App\Support\TrackPresenter;
use PDO;
use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use Throwable;

final class TrackController
{
    private Spotify $spotify;

    public function __construct(private PDO $pdo, ?Spotify $spotify = null)
    {
        $this->spotify = $spotify ?? new Spotify();
    }

    public function createBatch(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $albumId = $this->requireAlbum((int) $args['id']);
        $body = $this->body($request);
        $tracks = $body['tracks'] ?? null;
        if (!is_array($tracks) || $tracks === []) {
            throw new HttpException(422, 'Provide a non-empty tracks array.');
        }

        $nextNumber = $this->nextTrackNumber($albumId);
        $created = [];

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare(
                'INSERT INTO tracks (album_id, track_number, title, duration_seconds, notes)
                 VALUES (:album_id, :track_number, :title, :duration_seconds, :notes)'
            );
            foreach ($tracks as $track) {
                if (!is_array($track)) {
                    throw new HttpException(422, 'Each track must be an object.');
                }
                $title = trim((string) ($track['title'] ?? ''));
                if ($title === '' || $this->length($title) > 255) {
                    throw new HttpException(422, 'Each track needs a title of 255 characters or fewer.');
                }
                $number = array_key_exists('track_number', $track) && $track['track_number'] !== null && $track['track_number'] !== ''
                    ? $this->positiveInt($track['track_number'], 'Track number')
                    : $nextNumber++;

                $stmt->execute([
                    'album_id' => $albumId,
                    'track_number' => $number,
                    'title' => $title,
                    'duration_seconds' => array_key_exists('duration_seconds', $track) ? $this->duration($track['duration_seconds']) : null,
                    'notes' => array_key_exists('notes', $track) ? $this->notes($track['notes']) : null,
                ]);
                $created[] = (int) $this->pdo->lastInsertId();
            }
            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }

        return Json::write($response, ['tracks' => $this->findMany($created)], 201);
    }

    public function update(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $id = (int) $args['id'];
        $this->findRow($id);
        $body = $this->body($request);
        $fields = [];

        if (array_key_exists('title', $body)) {
            $title = trim((string) $body['title']);
            if ($title === '' || $this->length($title) > 255) {
                throw new HttpException(422, 'Title is required and must be 255 characters or fewer.');
            }
            $fields['title'] = $title;
        }

        if (array_key_exists('track_number', $body)) {
            $fields['track_number'] = $this->positiveInt($body['track_number'], 'Track number');
        }

        if (array_key_exists('duration_seconds', $body)) {
            $fields['duration_seconds'] = $this->duration($body['duration_seconds']);
        }

        if (array_key_exists('notes', $body)) {
            $fields['notes'] = $this->notes($body['notes']);
        }

        foreach (ScoreCalculator::FIELDS as $field) {
            if (array_key_exists($field, $body)) {
                $fields[$field] = $this->score($body[$field]);
            }
        }

        if ($fields === []) {
            throw new HttpException(422, 'No track fields to update.');
        }

        $sets = [];
        $params = ['id' => $id];
        foreach ($fields as $column => $value) {
            $sets[] = $column . ' = :' . $column;
            $params[$column] = $value;
        }

        $stmt = $this->pdo->prepare('UPDATE tracks SET ' . implode(', ', $sets) . ' WHERE id = :id');
        $stmt->execute($params);

        return Json::write($response, TrackPresenter::present($this->findRow($id)));
    }

    public function delete(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $row = $this->findRow((int) $args['id']);
        $albumId = (int) $row['album_id'];

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare('DELETE FROM tracks WHERE id = :id');
            $stmt->execute(['id' => (int) $row['id']]);
            $this->renumber($albumId);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }

        return $response->withStatus(204);
    }

    public function play(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $id = (int) $args['id'];
        $stmt = $this->pdo->prepare(
            'SELECT t.*, a.title AS album_title, a.artist AS album_artist, a.cover_art_url
             FROM tracks t
             JOIN albums a ON a.id = t.album_id
             WHERE t.id = :id'
        );
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new HttpException(404, 'Track not found.');
        }

        $spotifyId = !empty($row['spotify_id']) ? (string) $row['spotify_id'] : null;
        $spotifyUrl = !empty($row['spotify_url']) ? (string) $row['spotify_url'] : null;

        if ($spotifyId === null && $this->spotify->configured()) {
            $match = $this->spotify->searchTrack((string) $row['title'], (string) $row['album_artist']);
            if ($match !== null) {
                $spotifyId = $match['id'];
                $spotifyUrl = $match['url'];
                $update = $this->pdo->prepare('UPDATE tracks SET spotify_id = :sid, spotify_url = :surl WHERE id = :id');
                $update->execute([
                    'sid' => $spotifyId,
                    'surl' => $spotifyUrl,
                    'id' => $id,
                ]);
            }
        }

        $embedUrl = $spotifyId !== null
            ? "https://open.spotify.com/embed/track/{$spotifyId}?utm_source=generator&theme=0"
            : null;

        if ($spotifyUrl === null) {
            $spotifyUrl = 'https://open.spotify.com/search/' . rawurlencode($row['album_artist'] . ' ' . $row['title']);
        }

        return Json::write($response, [
            'id' => (int) $row['id'],
            'album_id' => (int) $row['album_id'],
            'track_number' => (int) $row['track_number'],
            'title' => (string) $row['title'],
            'artist' => (string) $row['album_artist'],
            'album' => (string) $row['album_title'],
            'cover_art_url' => $row['cover_art_url'] !== null ? (string) $row['cover_art_url'] : null,
            'duration_seconds' => $row['duration_seconds'] === null ? null : (int) $row['duration_seconds'],
            'spotify_id' => $spotifyId,
            'spotify_url' => $spotifyUrl,
            'embed_url' => $embedUrl,
        ]);
    }

    public function reorder(ServerRequestInterface $request, ResponseInterface $response, array $args): ResponseInterface
    {
        $albumId = $this->requireAlbum((int) $args['id']);
        $body = $this->body($request);
        $ids = $body['track_ids'] ?? null;
        if (!is_array($ids) || $ids === []) {
            throw new HttpException(422, 'Provide track_ids in the desired order.');
        }

        $existing = $this->pdo->prepare('SELECT id FROM tracks WHERE album_id = :album_id');
        $existing->execute(['album_id' => $albumId]);
        $current = array_map('intval', array_column($existing->fetchAll(), 'id'));
        $requested = array_map(static fn ($id): int => (int) $id, $ids);
        $sortedCurrent = $current;
        $sortedRequested = $requested;
        sort($sortedCurrent);
        sort($sortedRequested);

        if ($sortedCurrent !== $sortedRequested || count($requested) !== count(array_unique($requested))) {
            throw new HttpException(422, 'track_ids must list each track on this album exactly once.');
        }

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare(
                'UPDATE tracks SET track_number = :track_number WHERE id = :id AND album_id = :album_id'
            );
            foreach ($requested as $index => $trackId) {
                $stmt->execute([
                    'track_number' => $index + 1,
                    'id' => $trackId,
                    'album_id' => $albumId,
                ]);
            }
            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }

        $stmt = $this->pdo->prepare(
            'SELECT * FROM tracks WHERE album_id = :album_id ORDER BY track_number ASC, id ASC'
        );
        $stmt->execute(['album_id' => $albumId]);

        return Json::write($response, [
            'tracks' => array_map([TrackPresenter::class, 'present'], $stmt->fetchAll()),
        ]);
    }

    private function requireAlbum(int $id): int
    {
        $stmt = $this->pdo->prepare('SELECT id FROM albums WHERE id = :id');
        $stmt->execute(['id' => $id]);
        if (!$stmt->fetch()) {
            throw new HttpException(404, 'Album not found.');
        }

        return $id;
    }

    private function findRow(int $id): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM tracks WHERE id = :id');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        if (!$row) {
            throw new HttpException(404, 'Track not found.');
        }

        return $row;
    }

    /**
     * @param list<int> $ids
     * @return list<array<string, mixed>>
     */
    private function findMany(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $this->pdo->prepare('SELECT * FROM tracks WHERE id IN (' . $placeholders . ')');
        $stmt->execute($ids);
        $byId = [];
        foreach ($stmt->fetchAll() as $row) {
            $byId[(int) $row['id']] = TrackPresenter::present($row);
        }

        $ordered = [];
        foreach ($ids as $id) {
            if (isset($byId[$id])) {
                $ordered[] = $byId[$id];
            }
        }

        return $ordered;
    }

    private function nextTrackNumber(int $albumId): int
    {
        $stmt = $this->pdo->prepare(
            'SELECT COALESCE(MAX(track_number), 0) + 1 FROM tracks WHERE album_id = :album_id'
        );
        $stmt->execute(['album_id' => $albumId]);

        return (int) $stmt->fetchColumn();
    }

    private function renumber(int $albumId): void
    {
        $stmt = $this->pdo->prepare(
            'SELECT id FROM tracks WHERE album_id = :album_id ORDER BY track_number ASC, id ASC'
        );
        $stmt->execute(['album_id' => $albumId]);
        $update = $this->pdo->prepare('UPDATE tracks SET track_number = :track_number WHERE id = :id');
        $number = 1;
        foreach ($stmt->fetchAll() as $row) {
            $update->execute([
                'track_number' => $number,
                'id' => (int) $row['id'],
            ]);
            $number++;
        }
    }

    private function body(ServerRequestInterface $request): array
    {
        $body = $request->getParsedBody();
        if (!is_array($body)) {
            throw new HttpException(400, 'Expected a JSON object.');
        }

        return $body;
    }

    private function score(mixed $value): ?int
    {
        if ($value === null || $value === '' || $value === 'N/A' || $value === 'n/a' || $value === 'NA') {
            return null;
        }
        if (is_bool($value) || !is_numeric($value) || (float) $value !== (float) (int) $value) {
            throw new HttpException(422, 'Scores must be whole numbers from 1 to 10, or null for N/A.');
        }
        $score = (int) $value;
        if ($score < 1 || $score > 10) {
            throw new HttpException(422, 'Scores must be whole numbers from 1 to 10, or null for N/A.');
        }

        return $score;
    }

    private function duration(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_bool($value) || !is_numeric($value) || (int) $value != $value) {
            throw new HttpException(422, 'Duration must be a whole number of seconds, or null.');
        }
        $seconds = (int) $value;
        if ($seconds < 0 || $seconds > 72000) {
            throw new HttpException(422, 'Duration must be between 0 and 72000 seconds.');
        }

        return $seconds;
    }

    private function notes(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        $notes = trim((string) $value);
        if ($notes === '') {
            return null;
        }
        if ($this->length($notes) > 10000) {
            throw new HttpException(422, 'Notes must be 10000 characters or fewer.');
        }

        return $notes;
    }

    private function positiveInt(mixed $value, string $label): int
    {
        if (is_bool($value) || !is_numeric($value) || (int) $value != $value) {
            throw new HttpException(422, $label . ' must be a whole number.');
        }
        $number = (int) $value;
        if ($number < 1 || $number > 999) {
            throw new HttpException(422, $label . ' must be between 1 and 999.');
        }

        return $number;
    }

    private function length(string $value): int
    {
        return function_exists('mb_strlen') ? mb_strlen($value) : strlen($value);
    }
}
