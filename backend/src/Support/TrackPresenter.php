<?php

declare(strict_types=1);

namespace App\Support;

use App\Services\ScoreCalculator;

final class TrackPresenter
{
    public static function present(array $row): array
    {
        $scores = [];
        foreach (ScoreCalculator::FIELDS as $field) {
            $scores[$field] = $row[$field] === null ? null : (int) $row[$field];
        }

        return [
            'id' => (int) $row['id'],
            'album_id' => (int) $row['album_id'],
            'track_number' => (int) $row['track_number'],
            'title' => $row['title'],
            'duration_seconds' => $row['duration_seconds'] === null ? null : (int) $row['duration_seconds'],
            'spotify_id' => $row['spotify_id'] ?? null,
            'spotify_url' => $row['spotify_url'] ?? null,
            ...$scores,
            'notes' => $row['notes'],
            'composite_score' => ScoreCalculator::computeComposite(array_values($scores)),
        ];
    }
}
