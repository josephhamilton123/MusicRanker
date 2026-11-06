<?php

declare(strict_types=1);

namespace App\Services;

class ScoreCalculator
{
    public const FIELDS = [
        'drums_score',
        'bass_score',
        'guitar_score',
        'heaviness_score',
        'singing_score',
        'subjective_score',
    ];

    public const INSTRUMENTS = [
        'drums_score' => 'Drums',
        'bass_score' => 'Bass Line',
        'guitar_score' => 'Guitar',
    ];

    public static function computeComposite(array $scores): ?float
    {
        $validScores = array_filter($scores, fn($val) => is_numeric($val) && $val !== null);

        if (empty($validScores)) {
            return null; // Equivalent to N/A
        }

        return round(array_sum($validScores) / count($validScores), 2);
    }
}
