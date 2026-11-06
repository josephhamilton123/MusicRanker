import assert from "node:assert/strict";
import { albumStats, computeComposite } from "./score.ts";
import type { Track } from "./types.ts";

assert.equal(computeComposite([null, null]), null);
assert.equal(computeComposite([]), null);
assert.equal(computeComposite([9, 8, 7, 4, 8, 9]), 7.5);
assert.equal(computeComposite([8, 7, 9, 6, null, 8]), 7.6);
assert.equal(computeComposite([3, 2, 4, 6, 3, 2]), 3.33);
assert.equal(computeComposite([5, 5, 6, 5, 6, 5]), 5.33);
assert.equal(computeComposite([10, 9, 10, 8, 9, 10]), 9.33);

function track(id: number, scores: Array<number | null>): Track {
  const [drums, bass, guitar, heaviness, singing, subjective] = scores;
  return {
    id,
    album_id: 1,
    track_number: id,
    title: id === 6 ? "Last Lamp" : `Track ${id}`,
    duration_seconds: null,
    drums_score: drums ?? null,
    bass_score: bass ?? null,
    guitar_score: guitar ?? null,
    heaviness_score: heaviness ?? null,
    singing_score: singing ?? null,
    subjective_score: subjective ?? null,
    notes: null,
    composite_score: computeComposite(scores),
  };
}

const stats = albumStats([
  track(1, [9, 8, 7, 4, 8, 9]),
  track(2, [8, 7, 9, 6, null, 8]),
  track(3, [null, null, null, null, null, null]),
  track(4, [3, 2, 4, 6, 3, 2]),
  track(5, [5, 5, 6, 5, 6, 5]),
  track(6, [10, 9, 10, 8, 9, 10]),
]);

assert.equal(stats.album_average, 6.62);
assert.equal(stats.heaviest_song?.title, "Last Lamp");
assert.equal(stats.standout_instrument?.label, "Guitar");
assert.equal(stats.track_count, 6);

console.log("client scoring checks passed");
