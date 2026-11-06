<?php

declare(strict_types=1);

use App\Services\AlbumStats;
use App\Services\ScoreCalculator;

require __DIR__ . '/../vendor/autoload.php';

$failures = 0;

function check(bool $condition, string $message): void
{
    global $failures;
    if ($condition) {
        echo "ok  {$message}\n";
        return;
    }
    $failures++;
    echo "FAIL {$message}\n";
}

check(ScoreCalculator::computeComposite([null, null]) === null, 'all null scores are N/A');
check(ScoreCalculator::computeComposite([]) === null, 'empty scores are N/A');
check(ScoreCalculator::computeComposite([9, 8, 7, 4, 8, 9]) === 7.5, 'full row averages to 7.5');
check(ScoreCalculator::computeComposite([8, 7, 9, 6, null, 8]) === 7.6, 'null metric is excluded');
check(ScoreCalculator::computeComposite([3, 2, 4, 6, 3, 2]) === 3.33, 'rounds half up to 3.33');
check(ScoreCalculator::computeComposite([5, 5, 6, 5, 6, 5]) === 5.33, 'rounds to 5.33');
check(ScoreCalculator::computeComposite([10, 9, 10, 8, 9, 10]) === 9.33, 'rounds to 9.33');
check(ScoreCalculator::computeComposite(['8', null, 6]) === 7.0, 'numeric strings count');

$tracks = [
    track(1, 1, [9, 8, 7, 4, 8, 9]),
    track(2, 2, [8, 7, 9, 6, null, 8]),
    track(3, 3, [null, null, null, null, null, null]),
    track(4, 4, [3, 2, 4, 6, 3, 2]),
    track(5, 5, [5, 5, 6, 5, 6, 5]),
    track(6, 6, [10, 9, 10, 8, 9, 10]),
];
$stats = AlbumStats::fromTracks($tracks);
check($stats['album_average'] === 6.62, 'album average ignores all-N/A tracks');
check($stats['heaviest_song']['title'] === 'Last Lamp', 'heaviest song is the highest heaviness');
check($stats['standout_instrument']['label'] === 'Guitar', 'standout instrument is the highest instrumental average');
check($stats['track_count'] === 6, 'track count includes N/A tracks');

if ($failures > 0) {
    fwrite(STDERR, "{$failures} failed\n");
    exit(1);
}

echo "All scoring checks passed.\n";

/**
 * @param list<int|null> $scores
 * @return array<string, mixed>
 */
function track(int $id, int $number, array $scores): array
{
    $fields = array_combine(ScoreCalculator::FIELDS, $scores);
    $row = [
        'id' => $id,
        'title' => $id === 6 ? 'Last Lamp' : 'Track ' . $id,
        'track_number' => $number,
        'composite_score' => ScoreCalculator::computeComposite($scores),
    ];

    return [...$row, ...$fields];
}
