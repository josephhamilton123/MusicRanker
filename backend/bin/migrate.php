<?php

declare(strict_types=1);

use App\Database;
use Dotenv\Dotenv;

if (!is_file(__DIR__ . '/../vendor/autoload.php')) {
    fwrite(STDERR, "Run composer install in the backend directory first.\n");
    exit(1);
}

require __DIR__ . '/../vendor/autoload.php';

Dotenv::createImmutable(dirname(__DIR__))->safeLoad();

$name = Database::env('DB_NAME', 'musicranker');
Database::assertIdentifier($name);
$user = Database::env('DB_USER', 'musicranker');

try {
    $server = Database::server();
    $server->exec(
        "CREATE DATABASE IF NOT EXISTS `{$name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    );
} catch (Throwable $exception) {
    fwrite(STDERR, "Could not create database {$name}.\n");
    fwrite(STDERR, $exception->getMessage() . "\n\n");
    fwrite(STDERR, "The account '{$user}' can sign in, but it cannot create or use a database yet.\n");
    fwrite(STDERR, "From a MySQL administrator account, run:\n\n");
    fwrite(STDERR, "CREATE DATABASE IF NOT EXISTS {$name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n");
    fwrite(STDERR, "GRANT ALL PRIVILEGES ON {$name}.* TO '{$user}'@'%';\n");
    fwrite(STDERR, "FLUSH PRIVILEGES;\n");
    exit(1);
}

$pdo = Database::connect();

$statements = [
    <<<SQL
    CREATE TABLE IF NOT EXISTS albums (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        release_year INT NOT NULL,
        artist VARCHAR(255) NOT NULL,
        cover_art_url VARCHAR(512) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    SQL,
    <<<SQL
    CREATE TABLE IF NOT EXISTS tracks (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        album_id BIGINT UNSIGNED NOT NULL,
        track_number INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        duration_seconds INT NULL,
        drums_score TINYINT NULL,
        bass_score TINYINT NULL,
        guitar_score TINYINT NULL,
        heaviness_score TINYINT NULL,
        singing_score TINYINT NULL,
        subjective_score TINYINT NULL,
        notes TEXT NULL,
        spotify_id VARCHAR(64) NULL,
        spotify_url VARCHAR(512) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_tracks_album FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
        INDEX idx_tracks_album_number (album_id, track_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    SQL,
];

foreach ($statements as $statement) {
    $pdo->exec($statement);
}

$columns = $pdo->query("SHOW COLUMNS FROM tracks LIKE 'spotify_id'")->fetchAll();
if (empty($columns)) {
    $pdo->exec('ALTER TABLE tracks ADD COLUMN spotify_id VARCHAR(64) NULL, ADD COLUMN spotify_url VARCHAR(512) NULL');
}

seed($pdo);
echo "Migrated {$name}.\n";

function seed(PDO $pdo): void
{
    $count = (int) $pdo->query('SELECT COUNT(*) FROM albums')->fetchColumn();
    if ($count > 0) {
        echo "Albums already present; skipped sample data.\n";
        return;
    }

    $insertAlbum = $pdo->prepare(
        'INSERT INTO albums (title, release_year, artist, cover_art_url) VALUES (?, ?, ?, ?)'
    );
    $insertTrack = $pdo->prepare(
        'INSERT INTO tracks (
            album_id, track_number, title, duration_seconds,
            drums_score, bass_score, guitar_score, heaviness_score, singing_score, subjective_score, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    $albums = [
        [
            'title' => 'Glass Weather',
            'year' => 2014,
            'artist' => 'Northline',
            'cover' => null,
            'tracks' => [
                [1, 'Salt Window', 222, 9, 8, 7, 4, 8, 9, 'Opens wide. The snare is the whole room.'],
                [2, 'Low Orbit', 245, 8, 7, 9, 6, null, 8, 'Instrumental. No vocal line to score.'],
                [3, 'Service Corridor', 47, null, null, null, null, null, null, 'Ambient interlude.'],
                [4, 'Copper Choir', 198, 3, 2, 4, 6, 3, 2, 'Thin mix. The vocal sits behind the guitars.'],
                [5, 'Harbor Static', 261, 5, 5, 6, 5, 6, 5, null],
                [6, 'Last Lamp', 314, 10, 9, 10, 8, 9, 10, 'The record earns this one.'],
            ],
        ],
        [
            'title' => 'Static Hymns',
            'year' => 2007,
            'artist' => 'Red Kiln',
            'cover' => null,
            'tracks' => [
                [1, 'Kiln Door', 187, 7, 6, 8, 9, 5, 7, 'Heaviest open on the record.'],
                [2, 'Ash Payroll', 214, 6, 8, 7, 7, 6, 6, null],
                [3, 'Hymn for a Dead Amp', 156, 4, 5, 3, 2, 8, 7, 'Almost a ballad. Guitar is the weak part.'],
            ],
        ],
    ];

    $pdo->beginTransaction();
    try {
        foreach ($albums as $album) {
            $insertAlbum->execute([$album['title'], $album['year'], $album['artist'], $album['cover']]);
            $albumId = (int) $pdo->lastInsertId();
            foreach ($album['tracks'] as $track) {
                $insertTrack->execute([$albumId, ...$track]);
            }
        }
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }

    echo "Seeded sample albums.\n";
}
