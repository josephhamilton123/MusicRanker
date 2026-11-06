<?php

declare(strict_types=1);

namespace App\Services;

use App\Database;
use App\HttpException;

final class Spotify
{
    private const AUTH = 'https://accounts.spotify.com/authorize';
    private const TOKEN = 'https://accounts.spotify.com/api/token';
    private const API = 'https://api.spotify.com/v1';
    private const SCOPES = 'playlist-read-private playlist-read-collaborative user-follow-read user-top-read';

    public function configured(): bool
    {
        return $this->clientId() !== '';
    }

    /**
     * @return array{configured: bool, connected: bool, user: ?array{id: string, name: string}}
     */
    public function status(): array
    {
        $token = $this->readToken();

        return [
            'configured' => $this->configured(),
            'connected' => $token !== null,
            'user' => $token === null ? null : [
                'id' => (string) ($token['id'] ?? ''),
                'name' => (string) ($token['display_name'] ?? 'Spotify'),
            ],
            'redirect_uri' => $this->redirectUri(),
        ];
    }

    public function authorizeUrl(string $returnTo): string
    {
        $clientId = $this->clientId();
        if ($clientId === '') {
            throw new HttpException(422, 'Add SPOTIFY_CLIENT_ID to backend/.env first.');
        }

        $verifier = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $state = bin2hex(random_bytes(16));
        $this->writeJson($this->pendingPath(), [
            'state' => $state,
            'verifier' => $verifier,
            'return_to' => $this->safeReturn($returnTo),
        ]);

        $query = http_build_query([
            'response_type' => 'code',
            'client_id' => $clientId,
            'scope' => self::SCOPES,
            'redirect_uri' => $this->redirectUri(),
            'state' => $state,
            'code_challenge_method' => 'S256',
            'code_challenge' => $challenge,
        ]);

        return self::AUTH . '?' . $query;
    }

    public function finishLogin(string $code, string $state): string
    {
        $pending = $this->readJson($this->pendingPath());
        if ($pending === null || !hash_equals((string) ($pending['state'] ?? ''), $state)) {
            throw new HttpException(400, 'Spotify login expired. Try connecting again.');
        }

        $token = $this->tokenRequest([
            'grant_type' => 'authorization_code',
            'code' => $code,
            'redirect_uri' => $this->redirectUri(),
            'client_id' => $this->clientId(),
            'code_verifier' => (string) $pending['verifier'],
        ]);
        $profile = $this->api('GET', '/me', $token['access_token']);
        $image = '';
        if (isset($profile['images'][0]['url']) && is_string($profile['images'][0]['url'])) {
            $image = $profile['images'][0]['url'];
        }
        $this->writeJson($this->tokenPath(), [
            'access_token' => $token['access_token'],
            'refresh_token' => $token['refresh_token'] ?? '',
            'expires_at' => time() + (int) ($token['expires_in'] ?? 3600) - 30,
            'display_name' => (string) ($profile['display_name'] ?? $profile['id'] ?? 'Spotify'),
            'id' => (string) ($profile['id'] ?? ''),
            'country' => (string) ($profile['country'] ?? 'US'),
            'image' => $image,
        ]);
        @unlink($this->pendingPath());

        return (string) ($pending['return_to'] ?? $this->safeReturn(''));
    }

    public function returnTarget(): string
    {
        $pending = $this->readJson($this->pendingPath());

        return $this->safeReturn((string) ($pending['return_to'] ?? ''));
    }

    public function disconnect(): void
    {
        @unlink($this->tokenPath());
        @unlink($this->pendingPath());
    }

    /**
     * @return list<array{id: string, name: string, owner: string, tracks: int, image: ?string}>
     */
    public function playlists(): array
    {
        $items = $this->collectPages('/me/playlists?limit=50', 'items');
        $playlists = [];
        foreach ($items as $playlist) {
            if (!is_array($playlist) || !isset($playlist['id'], $playlist['name'])) {
                continue;
            }
            $playlists[] = [
                'id' => (string) $playlist['id'],
                'name' => (string) $playlist['name'],
                'owner' => (string) ($playlist['owner']['display_name'] ?? ''),
                'tracks' => (int) ($playlist['items']['total'] ?? $playlist['tracks']['total'] ?? 0),
                'image' => $this->image($playlist['images'] ?? []),
            ];
        }

        return $playlists;
    }

    /**
     * @return list<array{id: string, name: string, genres: string, image: ?string, sources: list<string>}>
     */
    public function artists(): array
    {
        $merged = [];
        foreach ($this->followedArtists() as $artist) {
            $merged[$artist['id']] = $artist;
            $merged[$artist['id']]['sources'] = ['Followed'];
        }
        $top = $this->collectPages('/me/top/artists?limit=50&time_range=long_term', 'items');
        foreach ($top as $artist) {
            if (!is_array($artist) || !isset($artist['id'])) {
                continue;
            }
            $id = (string) $artist['id'];
            if (!isset($merged[$id])) {
                $merged[$id] = $this->presentArtist($artist);
                $merged[$id]['sources'] = [];
            }
            $merged[$id]['sources'][] = 'Top';
        }

        $artists = array_values($merged);
        usort($artists, static fn (array $a, array $b): int => strcasecmp($a['name'], $b['name']));

        return $artists;
    }

    /**
     * @return list<array{id: string, name: string, genres: string, image: ?string}>
     */
    public function searchArtists(string $query): array
    {
        $query = trim($query);
        if ($query === '') {
            return [];
        }
        $payload = $this->api('GET', '/search?type=artist&limit=8&q=' . rawurlencode($query));
        $items = $payload['artists']['items'] ?? [];
        if (!is_array($items)) {
            return [];
        }

        $artists = [];
        foreach ($items as $artist) {
            if (is_array($artist)) {
                $artists[] = $this->presentArtist($artist);
            }
        }

        return $artists;
    }

    /**
     * @return ?array{id: string, url: string, uri: string, title: string, artist: string}
     */
    public function searchTrack(string $title, string $artist): ?array
    {
        $title = trim($title);
        $artist = trim($artist);
        if ($title === '') {
            return null;
        }

        $queries = [
            'track:' . $title . ' artist:' . $artist,
            $title . ' ' . $artist,
            $title,
        ];

        foreach ($queries as $q) {
            try {
                $payload = $this->api('GET', '/search?type=track&limit=1&q=' . rawurlencode($q));
                $items = $payload['tracks']['items'] ?? [];
                if (is_array($items) && isset($items[0]) && is_array($items[0]) && isset($items[0]['id'])) {
                    $item = $items[0];
                    return [
                        'id' => (string) $item['id'],
                        'url' => (string) ($item['external_urls']['spotify'] ?? "https://open.spotify.com/track/{$item['id']}"),
                        'uri' => (string) ($item['uri'] ?? "spotify:track:{$item['id']}"),
                        'title' => (string) ($item['name'] ?? $title),
                        'artist' => $this->names($item['artists'] ?? []),
                    ];
                }
            } catch (\Throwable) {
                // Continue to next fallback query
            }
        }

        return null;
    }

    /**
     * @param list<array{type?: string, id?: string}> $selections
     * @return array{albums: list<array<string, mixed>>, album_count: int, track_count: int}
     */
    public function collect(array $selections, string $depth, bool $includeSingles): array
    {
        set_time_limit(180);
        if (!in_array($depth, ['tracks', 'albums', 'discography'], true)) {
            throw new HttpException(422, 'Choose songs, full albums, or a discography.');
        }
        if ($selections === []) {
            throw new HttpException(422, 'Select at least one playlist or artist.');
        }

        $albumIds = [];
        $artistIds = [];
        $loose = [];

        foreach ($selections as $selection) {
            $type = (string) ($selection['type'] ?? '');
            $id = (string) ($selection['id'] ?? '');
            if ($id === '') {
                continue;
            }
            if ($type === 'playlist') {
                $tracks = $this->playlistTracks($id);
                if ($depth === 'tracks') {
                    array_push($loose, ...$tracks);
                } elseif ($depth === 'albums') {
                    foreach ($tracks as $track) {
                        if ($track['album_id'] !== '') {
                            $albumIds[$track['album_id']] = true;
                        } else {
                            $loose[] = $track;
                        }
                    }
                } else {
                    foreach ($tracks as $track) {
                        foreach ($track['artist_ids'] as $artistId) {
                            $artistIds[$artistId] = true;
                        }
                    }
                }
            } elseif ($type === 'artist') {
                $artistIds[$id] = true;
            }
        }

        foreach (array_keys($artistIds) as $artistId) {
            foreach ($this->artistAlbumIds((string) $artistId, $depth === 'discography' && $includeSingles) as $albumId) {
                $albumIds[$albumId] = true;
            }
        }

        $albums = $albumIds === [] ? [] : $this->hydrateAlbums(array_keys($albumIds));
        if ($loose !== []) {
            array_push($albums, ...$this->groupLoose($loose));
        }
        if (count($albums) > 400) {
            throw new HttpException(422, 'That selection is ' . count($albums) . ' albums. Import a smaller batch.');
        }

        $trackCount = 0;
        foreach ($albums as $album) {
            $trackCount += count($album['tracks']);
        }

        return [
            'albums' => $albums,
            'album_count' => count($albums),
            'track_count' => $trackCount,
        ];
    }

    /**
     * @return list<array{album_id: string, album: string, artist: string, artist_ids: list<string>, year: int, cover: ?string, title: string, track_number: int, duration_seconds: ?int}>
     */
    private function playlistTracks(string $playlistId): array
    {
        $path = '/playlists/' . rawurlencode($playlistId) . '/items?limit=50&additional_types=track';
        $pages = $this->collectPages($path, 'items');

        $tracks = [];
        foreach ($pages as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $item = $entry['item'] ?? $entry['track'] ?? null;
            if (!is_array($item) || ($item['type'] ?? 'track') !== 'track' || (!empty($item['is_local']) && ($item['name'] ?? '') === '')) {
                continue;
            }
            if (!isset($item['name']) || !is_string($item['name']) || $item['name'] === '') {
                continue;
            }
            $album = is_array($item['album'] ?? null) ? $item['album'] : [];
            $tracks[] = [
                'album_id' => (string) ($album['id'] ?? ''),
                'album' => (string) ($album['name'] ?? 'Singles'),
                'artist' => $this->names($album['artists'] ?? $item['artists'] ?? []),
                'artist_ids' => $this->ids($item['artists'] ?? []),
                'year' => $this->year((string) ($album['release_date'] ?? '')),
                'cover' => $this->image($album['images'] ?? []),
                'title' => $item['name'],
                'track_number' => (int) ($item['track_number'] ?? 0),
                'duration_seconds' => isset($item['duration_ms']) ? (int) round(((int) $item['duration_ms']) / 1000) : null,
                'spotify_id' => (string) ($item['id'] ?? ''),
                'spotify_url' => (string) ($item['external_urls']['spotify'] ?? ''),
            ];
        }

        return $tracks;
    }

    /**
     * @return list<string>
     */
    private function artistAlbumIds(string $artistId, bool $includeSingles): array
    {
        $groups = $includeSingles ? 'album,single' : 'album';
        $market = rawurlencode($this->market());
        $path = '/artists/' . rawurlencode($artistId) . '/albums?include_groups=' . $groups . '&limit=10&market=' . $market;
        $ids = [];
        foreach ($this->collectPages($path, 'items') as $album) {
            if (is_array($album) && isset($album['id'])) {
                $ids[] = (string) $album['id'];
            }
        }

        return $ids;
    }

    /**
     * @param list<string> $ids
     * @return list<array<string, mixed>>
     */
    private function hydrateAlbums(array $ids): array
    {
        $albums = [];
        foreach ($ids as $id) {
            try {
                $album = $this->api('GET', '/albums/' . rawurlencode($id));
            } catch (HttpException $exception) {
                if ($exception->status === 404) {
                    continue;
                }
                throw $exception;
            }
            if (!isset($album['name'])) {
                continue;
            }
            $tracks = $this->albumTracks($album);
            if ($tracks === []) {
                continue;
            }
            $albums[] = [
                'title' => (string) $album['name'],
                'artist' => $this->names($album['artists'] ?? []),
                'release_year' => $this->year((string) ($album['release_date'] ?? '')),
                'cover_art_url' => $this->image($album['images'] ?? []),
                'tracks' => $tracks,
            ];
        }

        return $albums;
    }

    /**
     * @param array<string, mixed> $album
     * @return list<array<string, mixed>>
     */
    private function albumTracks(array $album): array
    {
        $container = is_array($album['tracks'] ?? null) ? $album['tracks'] : ['items' => []];
        $items = is_array($container['items'] ?? null) ? $container['items'] : [];
        $next = $container['next'] ?? null;
        while (is_string($next) && $next !== '') {
            $page = $this->api('GET', $next);
            if (is_array($page['items'] ?? null)) {
                array_push($items, ...$page['items']);
            }
            $next = $page['next'] ?? null;
        }

        $tracks = [];
        $number = 1;
        foreach ($items as $track) {
            if (!is_array($track) || !isset($track['name']) || !is_string($track['name'])) {
                continue;
            }
            $tracks[] = [
                'track_number' => (int) ($track['track_number'] ?? $number),
                'title' => $track['name'],
                'duration_seconds' => isset($track['duration_ms']) ? (int) round(((int) $track['duration_ms']) / 1000) : null,
                'drums_score' => null,
                'bass_score' => null,
                'guitar_score' => null,
                'heaviness_score' => null,
                'singing_score' => null,
                'subjective_score' => null,
                'notes' => null,
                'spotify_id' => (string) ($track['id'] ?? ''),
                'spotify_url' => (string) ($track['external_urls']['spotify'] ?? ''),
            ];
            $number++;
        }

        return $tracks;
    }

    /**
     * @param list<array<string, mixed>> $tracks
     * @return list<array<string, mixed>>
     */
    private function groupLoose(array $tracks): array
    {
        $groups = [];
        foreach ($tracks as $track) {
            $key = ($track['album_id'] !== '' ? $track['album_id'] : $this->slug($track['artist'] . '|' . $track['album']));
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'title' => $track['album'],
                    'artist' => $track['artist'] !== '' ? $track['artist'] : 'Unknown artist',
                    'release_year' => $track['year'],
                    'cover_art_url' => $track['cover'],
                    'tracks' => [],
                ];
            }
            $groups[$key]['tracks'][] = [
                'track_number' => $track['track_number'] > 0 ? $track['track_number'] : count($groups[$key]['tracks']) + 1,
                'title' => $track['title'],
                'duration_seconds' => $track['duration_seconds'],
                'drums_score' => null,
                'bass_score' => null,
                'guitar_score' => null,
                'heaviness_score' => null,
                'singing_score' => null,
                'subjective_score' => null,
                'notes' => null,
                'spotify_id' => $track['spotify_id'] ?? null,
                'spotify_url' => $track['spotify_url'] ?? null,
            ];
        }

        return array_values($groups);
    }

    /**
     * @return list<array{id: string, name: string, genres: string, image: ?string}>
     */
    private function followedArtists(): array
    {
        $artists = [];
        $after = null;
        $guard = 0;
        do {
            $guard++;
            $path = '/me/following?type=artist&limit=50';
            if ($after !== null) {
                $path .= '&after=' . rawurlencode($after);
            }
            $payload = $this->api('GET', $path);
            $container = is_array($payload['artists'] ?? null) ? $payload['artists'] : [];
            $items = is_array($container['items'] ?? null) ? $container['items'] : [];
            foreach ($items as $artist) {
                if (is_array($artist)) {
                    $artists[] = $this->presentArtist($artist);
                }
            }
            $after = isset($container['cursors']['after']) && is_string($container['cursors']['after'])
                ? $container['cursors']['after']
                : null;
        } while ($after !== null && $guard < 20);

        return $artists;
    }

    /**
     * @param array<string, mixed> $artist
     * @return array{id: string, name: string, genres: string, image: ?string}
     */
    private function presentArtist(array $artist): array
    {
        $genres = $artist['genres'] ?? [];

        return [
            'id' => (string) ($artist['id'] ?? ''),
            'name' => (string) ($artist['name'] ?? 'Unknown artist'),
            'genres' => is_array($genres) ? implode(', ', array_slice($genres, 0, 3)) : '',
            'image' => $this->image($artist['images'] ?? []),
        ];
    }

    /**
     * @return list<mixed>
     */
    private function collectPages(string $path, string $key): array
    {
        $items = [];
        $next = $path;
        $guard = 0;
        while (is_string($next) && $next !== '' && $guard < 40) {
            $payload = $this->api('GET', $next);
            if (is_array($payload[$key] ?? null)) {
                array_push($items, ...$payload[$key]);
            }
            $next = $payload['next'] ?? null;
            $guard++;
        }

        return $items;
    }

    /**
     * @return array<string, mixed>
     */
    private function api(string $method, string $path, ?string $accessToken = null, bool $retried = false): array
    {
        $token = $accessToken ?? $this->accessToken();
        $url = str_starts_with($path, 'https://') ? $path : self::API . $path;
        $response = Http::request($method, $url, [
            'Authorization: Bearer ' . $token,
            'Accept: application/json',
        ]);

        if ($response['status'] === 401 && !$retried && $accessToken === null) {
            $this->refresh();

            return $this->api($method, $path, null, true);
        }
        if ($response['status'] === 429 && !$retried) {
            sleep(2);

            return $this->api($method, $path, $token, true);
        }
        if ($response['status'] >= 400) {
            $message = (string) ($response['body']['error']['message'] ?? $response['body']['error_description'] ?? 'Spotify request failed.');
            throw new HttpException($response['status'] === 401 ? 401 : 502, $message);
        }

        return $response['body'];
    }

    private function refresh(): void
    {
        $stored = $this->readToken();
        if ($stored === null || ($stored['refresh_token'] ?? '') === '') {
            $this->disconnect();
            throw new HttpException(401, 'Reconnect Spotify.');
        }
        $token = $this->tokenRequest([
            'grant_type' => 'refresh_token',
            'refresh_token' => (string) $stored['refresh_token'],
            'client_id' => $this->clientId(),
        ]);
        $stored['access_token'] = $token['access_token'];
        $stored['expires_at'] = time() + (int) ($token['expires_in'] ?? 3600) - 30;
        if (!empty($token['refresh_token'])) {
            $stored['refresh_token'] = $token['refresh_token'];
        }
        $this->writeJson($this->tokenPath(), $stored);
    }

    /**
     * @param array<string, string> $fields
     * @return array<string, mixed>
     */
    private function tokenRequest(array $fields): array
    {
        $response = Http::request('POST', self::TOKEN, [
            'Content-Type: application/x-www-form-urlencoded',
        ], http_build_query($fields));
        if ($response['status'] >= 400 || !isset($response['body']['access_token'])) {
            $message = (string) ($response['body']['error_description'] ?? 'Spotify rejected the login.');
            throw new HttpException(401, $message);
        }

        return $response['body'];
    }

    private function accessToken(): string
    {
        $stored = $this->readToken();
        if ($stored === null) {
            throw new HttpException(401, 'Connect Spotify first.');
        }
        if ((int) ($stored['expires_at'] ?? 0) <= time()) {
            $this->refresh();
            $stored = $this->readToken();
        }
        if ($stored === null) {
            throw new HttpException(401, 'Connect Spotify first.');
        }

        return (string) $stored['access_token'];
    }

    private function market(): string
    {
        $stored = $this->readToken();
        $country = strtoupper((string) ($stored['country'] ?? 'US'));

        return preg_match('/^[A-Z]{2}$/', $country) ? $country : 'US';
    }

    /**
     * @param mixed $artists
     */
    private function names(mixed $artists): string
    {
        if (!is_array($artists)) {
            return '';
        }
        $names = [];
        foreach ($artists as $artist) {
            if (is_array($artist) && isset($artist['name']) && is_string($artist['name'])) {
                $names[] = $artist['name'];
            }
        }

        return implode(', ', $names);
    }

    /**
     * @param mixed $artists
     * @return list<string>
     */
    private function ids(mixed $artists): array
    {
        if (!is_array($artists)) {
            return [];
        }
        $ids = [];
        foreach ($artists as $artist) {
            if (is_array($artist) && isset($artist['id']) && is_string($artist['id']) && $artist['id'] !== '') {
                $ids[] = $artist['id'];
            }
        }

        return $ids;
    }

    private function image(mixed $images): ?string
    {
        if (!is_array($images)) {
            return null;
        }
        foreach ($images as $image) {
            if (is_array($image) && isset($image['url']) && is_string($image['url']) && preg_match('#^https?://#', $image['url'])) {
                return $image['url'];
            }
        }

        return null;
    }

    private function year(string $releaseDate): int
    {
        if (preg_match('/^(\d{4})/', $releaseDate, $match)) {
            $year = (int) $match[1];
            if ($year >= 1900 && $year <= 2100) {
                return $year;
            }
        }

        return 0;
    }

    private function slug(string $value): string
    {
        $value = strtolower(trim($value));

        return preg_replace('/\s+/', ' ', $value) ?? $value;
    }

    /**
     * @return ?array<string, mixed>
     */
    private function readToken(): ?array
    {
        return $this->readJson($this->tokenPath());
    }

    private function clientId(): string
    {
        return Database::env('SPOTIFY_CLIENT_ID');
    }

    private function redirectUri(): string
    {
        return 'http://127.0.0.1:8080/api/spotify/callback';
    }

    private function safeReturn(string $returnTo): string
    {
        if (preg_match('#^https?://(localhost|127\.0\.0\.1)(:\d+)?$#', $returnTo)) {
            return $returnTo;
        }

        return Database::env('FRONTEND_URL', 'http://127.0.0.1:3000');
    }

    private function tokenPath(): string
    {
        return $this->storage() . '/spotify-token.json';
    }

    private function pendingPath(): string
    {
        return $this->storage() . '/spotify-pending.json';
    }

    private function storage(): string
    {
        $directory = dirname(__DIR__, 2) . '/storage';
        if (!is_dir($directory)) {
            mkdir($directory, 0775, true);
        }

        return $directory;
    }

    /**
     * @return ?array<string, mixed>
     */
    private function readJson(string $path): ?array
    {
        if (!is_file($path)) {
            return null;
        }
        $decoded = json_decode((string) file_get_contents($path), true);

        return is_array($decoded) ? $decoded : null;
    }

    /**
     * @param array<string, mixed> $data
     */
    private function writeJson(string $path, array $data): void
    {
        file_put_contents($path, json_encode($data, JSON_UNESCAPED_SLASHES));
    }
}
