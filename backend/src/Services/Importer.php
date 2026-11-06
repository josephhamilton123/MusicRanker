<?php

declare(strict_types=1);

namespace App\Services;

use App\HttpException;
use PDO;

final class Importer
{
    public function __construct(private PDO $pdo)
    {
    }

    /**
     * @param list<array<string, mixed>> $albums
     * @return array{created_albums: int, created_tracks: int, updated_tracks: int, skipped_tracks: int, album_ids: list<int>}
     */
    public function import(array $albums): array
    {
        if ($albums === []) {
            throw new HttpException(422, 'Nothing to import.');
        }
        if (count($albums) > 400) {
            throw new HttpException(422, 'Import 400 albums or fewer at a time.');
        }

        $stats = [
            'created_albums' => 0,
            'created_tracks' => 0,
            'updated_tracks' => 0,
            'skipped_tracks' => 0,
            'album_ids' => [],
        ];

        $existing = $this->existingAlbums();
        $insertAlbum = $this->pdo->prepare(
            'INSERT INTO albums (title, release_year, artist, cover_art_url) VALUES (:title, :release_year, :artist, :cover_art_url)'
        );
        $updateAlbum = $this->pdo->prepare(
            'UPDATE albums SET release_year = :release_year, cover_art_url = COALESCE(cover_art_url, :cover_art_url) WHERE id = :id'
        );
        $insertTrack = $this->pdo->prepare(
            'INSERT INTO tracks (
                album_id, track_number, title, duration_seconds,
                drums_score, bass_score, guitar_score, heaviness_score, singing_score, subjective_score, notes,
                spotify_id, spotify_url
            ) VALUES (
                :album_id, :track_number, :title, :duration_seconds,
                :drums_score, :bass_score, :guitar_score, :heaviness_score, :singing_score, :subjective_score, :notes,
                :spotify_id, :spotify_url
            )'
        );
        $updateTrack = $this->pdo->prepare(
            'UPDATE tracks SET
                duration_seconds = COALESCE(duration_seconds, :duration_seconds),
                drums_score = COALESCE(drums_score, :drums_score),
                bass_score = COALESCE(bass_score, :bass_score),
                guitar_score = COALESCE(guitar_score, :guitar_score),
                heaviness_score = COALESCE(heaviness_score, :heaviness_score),
                singing_score = COALESCE(singing_score, :singing_score),
                subjective_score = COALESCE(subjective_score, :subjective_score),
                notes = COALESCE(notes, :notes),
                spotify_id = COALESCE(spotify_id, :spotify_id),
                spotify_url = COALESCE(spotify_url, :spotify_url)
             WHERE id = :id'
        );

        $this->pdo->beginTransaction();
        try {
            foreach ($albums as $album) {
                $prepared = $this->prepareAlbum($album);
                $matchIndex = $this->matchAlbumIndex($existing, $prepared);
                if ($matchIndex === null) {
                    $insertAlbum->execute([
                        'title' => $prepared['title'],
                        'release_year' => $prepared['release_year'],
                        'artist' => $prepared['artist'],
                        'cover_art_url' => $prepared['cover_art_url'],
                    ]);
                    $albumId = (int) $this->pdo->lastInsertId();
                    $stats['created_albums']++;
                    $existing[] = [
                        'id' => $albumId,
                        'title' => $prepared['title'],
                        'artist' => $prepared['artist'],
                        'release_year' => $prepared['release_year'],
                        'tracks' => [],
                    ];
                    $matchIndex = array_key_last($existing);
                } else {
                    $albumId = $existing[$matchIndex]['id'];
                    if (($existing[$matchIndex]['release_year'] === 0 && $prepared['release_year'] !== 0) || $prepared['cover_art_url'] !== null) {
                        $year = $existing[$matchIndex]['release_year'] === 0
                            ? $prepared['release_year']
                            : $existing[$matchIndex]['release_year'];
                        $updateAlbum->execute([
                            'id' => $albumId,
                            'release_year' => $year,
                            'cover_art_url' => $prepared['cover_art_url'],
                        ]);
                        $existing[$matchIndex]['release_year'] = $year;
                    }
                }

                $stats['album_ids'][] = $albumId;
                $known = [];
                foreach ($existing[$matchIndex]['tracks'] as $track) {
                    $known[$this->normalize((string) $track['title'])] = $track;
                }
                $nextNumber = 1;
                foreach ($existing[$matchIndex]['tracks'] as $track) {
                    $nextNumber = max($nextNumber, ((int) $track['track_number']) + 1);
                }

                foreach ($prepared['tracks'] as $track) {
                    $key = $this->normalize($track['title']);
                    if (!isset($known[$key])) {
                        if ($track['track_number'] < 1) {
                            $track['track_number'] = $nextNumber;
                        }
                        $nextNumber = max($nextNumber, $track['track_number'] + 1);
                        $insertTrack->execute(['album_id' => $albumId, ...$track]);
                        $track['id'] = (int) $this->pdo->lastInsertId();
                        $existing[$matchIndex]['tracks'][] = $track;
                        $known[$key] = $track;
                        $stats['created_tracks']++;
                        continue;
                    }

                    $current = $known[$key];
                    if ($this->fillsGap($current, $track)) {
                        $updateTrack->execute(['id' => $current['id'], ...$this->scorePayload($track)]);
                        $stats['updated_tracks']++;
                    } else {
                        $stats['skipped_tracks']++;
                    }
                }
            }
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }

        $stats['album_ids'] = array_values(array_unique($stats['album_ids']));

        return $stats;
    }

    /**
     * @param array<string, mixed> $album
     * @return array{title: string, artist: string, release_year: int, cover_art_url: ?string, tracks: list<array<string, mixed>>}
     */
    private function prepareAlbum(array $album): array
    {
        $title = trim((string) ($album['title'] ?? ''));
        $artist = trim((string) ($album['artist'] ?? ''));
        if ($title === '' || $artist === '' || $this->length($title) > 255 || $this->length($artist) > 255) {
            throw new HttpException(422, 'Every imported album needs an artist and a title.');
        }

        $year = $album['release_year'] ?? 0;
        if (!is_numeric($year)) {
            $year = 0;
        }
        $year = (int) $year;
        if ($year !== 0 && ($year < 1900 || $year > 2100)) {
            throw new HttpException(422, "Release year for {$artist} — {$title} must be between 1900 and 2100.");
        }

        $cover = trim((string) ($album['cover_art_url'] ?? ''));
        if ($cover !== '' && !preg_match('#^https?://#i', $cover)) {
            $cover = '';
        }

        $tracks = $album['tracks'] ?? null;
        if (!is_array($tracks) || $tracks === []) {
            throw new HttpException(422, "{$artist} — {$title} has no tracks.");
        }

        $preparedTracks = [];
        foreach ($tracks as $track) {
            if (!is_array($track)) {
                throw new HttpException(422, 'Each imported track must be an object.');
            }
            $trackTitle = trim((string) ($track['title'] ?? ''));
            if ($trackTitle === '' || $this->length($trackTitle) > 255) {
                throw new HttpException(422, 'Each imported track needs a title.');
            }
            $number = is_numeric($track['track_number'] ?? null) ? (int) $track['track_number'] : count($preparedTracks) + 1;
            $notes = trim((string) ($track['notes'] ?? ''));
            $preparedTracks[] = [
                'track_number' => max(1, min(999, $number)),
                'title' => $trackTitle,
                'duration_seconds' => $this->duration($track['duration_seconds'] ?? null),
                'drums_score' => $this->score($track['drums_score'] ?? null),
                'bass_score' => $this->score($track['bass_score'] ?? null),
                'guitar_score' => $this->score($track['guitar_score'] ?? null),
                'heaviness_score' => $this->score($track['heaviness_score'] ?? null),
                'singing_score' => $this->score($track['singing_score'] ?? null),
                'subjective_score' => $this->score($track['subjective_score'] ?? null),
                'notes' => $notes === '' ? null : $notes,
                'spotify_id' => !empty($track['spotify_id']) ? (string) $track['spotify_id'] : null,
                'spotify_url' => !empty($track['spotify_url']) ? (string) $track['spotify_url'] : null,
            ];
        }

        return [
            'title' => $title,
            'artist' => $artist,
            'release_year' => $year,
            'cover_art_url' => $cover === '' ? null : $cover,
            'tracks' => $preparedTracks,
        ];
    }

    /**
     * @return list<array{id: int, title: string, artist: string, release_year: int, tracks: list<array<string, mixed>>}>
     */
    private function existingAlbums(): array
    {
        $albums = $this->pdo->query('SELECT id, title, artist, release_year FROM albums')->fetchAll();
        $tracks = $this->pdo->query(
            'SELECT id, album_id, track_number, title, duration_seconds, drums_score, bass_score, guitar_score, heaviness_score, singing_score, subjective_score, notes FROM tracks'
        )->fetchAll();
        $byAlbum = [];
        foreach ($tracks as $track) {
            $byAlbum[(int) $track['album_id']][] = $track;
        }

        $prepared = [];
        foreach ($albums as $album) {
            $prepared[] = [
                'id' => (int) $album['id'],
                'title' => $album['title'],
                'artist' => $album['artist'],
                'release_year' => (int) $album['release_year'],
                'tracks' => $byAlbum[(int) $album['id']] ?? [],
            ];
        }

        return $prepared;
    }

    /**
     * @param list<array{id: int, title: string, artist: string, release_year: int, tracks: list<array<string, mixed>>}> $existing
     * @param array{title: string, artist: string, release_year: int} $incoming
     */
    private function matchAlbumIndex(array $existing, array $incoming): ?int
    {
        $artist = $this->normalize($incoming['artist']);
        $title = $this->normalize($incoming['title']);
        $fallback = null;
        foreach ($existing as $index => $album) {
            if ($this->normalize($album['artist']) !== $artist || $this->normalize($album['title']) !== $title) {
                continue;
            }
            if ($album['release_year'] === $incoming['release_year']) {
                return $index;
            }
            if ($album['release_year'] === 0 || $incoming['release_year'] === 0) {
                $fallback = $index;
            }
        }

        return $fallback;
    }

    /**
     * @param array<string, mixed> $current
     * @param array<string, mixed> $incoming
     */
    private function fillsGap(array $current, array $incoming): bool
    {
        foreach (['duration_seconds', ...ScoreCalculator::FIELDS, 'notes', 'spotify_id'] as $field) {
            if (($current[$field] === null || $current[$field] === '') && ($incoming[$field] ?? null) !== null) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string, mixed> $track
     * @return array<string, mixed>
     */
    private function scorePayload(array $track): array
    {
        return [
            'duration_seconds' => $track['duration_seconds'],
            'drums_score' => $track['drums_score'],
            'bass_score' => $track['bass_score'],
            'guitar_score' => $track['guitar_score'],
            'heaviness_score' => $track['heaviness_score'],
            'singing_score' => $track['singing_score'],
            'subjective_score' => $track['subjective_score'],
            'notes' => $track['notes'],
            'spotify_id' => $track['spotify_id'] ?? null,
            'spotify_url' => $track['spotify_url'] ?? null,
        ];
    }

    private function score(mixed $value): ?int
    {
        if ($value === null || $value === '' || (is_string($value) && preg_match('/^(n\/?a|na|—|-)$/i', trim($value)))) {
            return null;
        }
        if (is_bool($value) || !is_numeric($value)) {
            throw new HttpException(422, 'Imported scores must be whole numbers from 1 to 10, or blank.');
        }
        $score = (int) round((float) $value);
        if ($score < 1 || $score > 10) {
            throw new HttpException(422, 'Imported scores must be whole numbers from 1 to 10, or blank.');
        }

        return $score;
    }

    private function duration(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (!is_numeric($value)) {
            return null;
        }
        $seconds = (int) $value;
        if ($seconds < 0 || $seconds > 72000) {
            return null;
        }

        return $seconds;
    }

    private function normalize(string $value): string
    {
        $value = mb_strtolower(trim($value));
        $value = preg_replace('/\s+/', ' ', $value) ?? $value;
        $value = preg_replace('/^the /', '', $value) ?? $value;

        return $value;
    }

    private function length(string $value): int
    {
        return function_exists('mb_strlen') ? mb_strlen($value) : strlen($value);
    }
}
