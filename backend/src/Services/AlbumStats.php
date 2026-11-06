<?php

declare(strict_types=1);

namespace App\Services;

final class AlbumStats
{
    /**
     * @param list<array<string, mixed>> $tracks
     * @return array{
     *     track_count: int,
     *     album_average: float|null,
     *     heaviest_song: array{id: int, title: string, heaviness_score: int}|null,
     *     standout_instrument: array{metric: string, label: string, average: float}|null
     * }
     */
    public static function fromTracks(array $tracks): array
    {
        $composites = [];
        $heaviest = null;
        $sums = [];
        foreach (ScoreCalculator::INSTRUMENTS as $field => $label) {
            $sums[$field] = [0, 0];
        }

        foreach ($tracks as $track) {
            if ($track['composite_score'] !== null) {
                $composites[] = $track['composite_score'];
            }

            $heaviness = $track['heaviness_score'];
            if ($heaviness !== null) {
                $replace = $heaviest === null
                    || $heaviness > $heaviest['heaviness_score']
                    || ($heaviness === $heaviest['heaviness_score'] && $track['track_number'] < $heaviest['track_number']);
                if ($replace) {
                    $heaviest = [
                        'id' => $track['id'],
                        'title' => $track['title'],
                        'heaviness_score' => $heaviness,
                        'track_number' => $track['track_number'],
                    ];
                }
            }

            foreach (ScoreCalculator::INSTRUMENTS as $field => $label) {
                if ($track[$field] !== null) {
                    $sums[$field][0] += $track[$field];
                    $sums[$field][1]++;
                }
            }
        }

        $standout = null;
        $bestAverage = null;
        foreach (ScoreCalculator::INSTRUMENTS as $field => $label) {
            if ($sums[$field][1] === 0) {
                continue;
            }
            $average = round($sums[$field][0] / $sums[$field][1], 2);
            if ($bestAverage === null || $average > $bestAverage) {
                $bestAverage = $average;
                $standout = [
                    'metric' => $field,
                    'label' => $label,
                    'average' => $average,
                ];
            }
        }

        return [
            'track_count' => count($tracks),
            'album_average' => ScoreCalculator::computeComposite($composites),
            'heaviest_song' => $heaviest === null ? null : [
                'id' => $heaviest['id'],
                'title' => $heaviest['title'],
                'heaviness_score' => $heaviest['heaviness_score'],
            ],
            'standout_instrument' => $standout,
        ];
    }
}
