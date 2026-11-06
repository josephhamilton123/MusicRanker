import type { AlbumSummary, ScoreField, Track } from "./types";

export const SCORE_FIELDS = [
  "drums_score",
  "bass_score",
  "guitar_score",
  "heaviness_score",
  "singing_score",
  "subjective_score",
] as const satisfies readonly ScoreField[];

export const SCORE_LABELS: Record<ScoreField, string> = {
  drums_score: "Drums",
  bass_score: "Bass",
  guitar_score: "Guitar",
  heaviness_score: "Heaviness",
  singing_score: "Vocals",
  subjective_score: "Quality",
};

const INSTRUMENTS: Array<{ field: ScoreField; label: string }> = [
  { field: "drums_score", label: "Drums" },
  { field: "bass_score", label: "Bass Line" },
  { field: "guitar_score", label: "Guitar" },
];

export function computeComposite(scores: Array<number | null | undefined>): number | null {
  const valid = scores.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (valid.length === 0) {
    return null;
  }
  const average = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  return Math.round(average * 100) / 100;
}

export function trackScores(track: Track): Array<number | null> {
  return SCORE_FIELDS.map((field) => track[field]);
}

export function withComposite(track: Track): Track {
  return {
    ...track,
    composite_score: computeComposite(trackScores(track)),
  };
}

export function scoreClass(score: number | null): string {
  if (score === null || Number.isNaN(score)) {
    return "bg-zinc-800/50 text-zinc-500";
  }
  if (score >= 9) {
    return "bg-emerald-400/40 text-white";
  }
  if (score >= 7) {
    return "bg-emerald-500/[0.12] text-emerald-300";
  }
  if (score >= 5) {
    return "bg-amber-400/15 text-amber-300";
  }
  return "bg-rose-500/15 text-rose-300";
}

export function scoreTextClass(score: number | null): string {
  if (score === null || Number.isNaN(score)) {
    return "text-zinc-500";
  }
  if (score >= 9) {
    return "text-emerald-200";
  }
  if (score >= 7) {
    return "text-emerald-300";
  }
  if (score >= 5) {
    return "text-amber-300";
  }
  return "text-rose-300";
}

export function scoreSwatchClass(score: number | null): string {
  if (score === null || Number.isNaN(score)) {
    return "bg-zinc-600";
  }
  if (score >= 9) {
    return "bg-emerald-300";
  }
  if (score >= 7) {
    return "bg-emerald-500";
  }
  if (score >= 5) {
    return "bg-amber-400";
  }
  return "bg-rose-400";
}

export function formatComposite(score: number | null): string {
  return score === null ? "N/A" : score.toFixed(2);
}

export function formatScore(score: number | null): string {
  return score === null ? "N/A" : String(score);
}

export function albumStats(tracks: Track[]): AlbumSummary {
  const composites = tracks
    .map((track) => track.composite_score)
    .filter((score): score is number => score !== null);

  let heaviest: AlbumSummary["heaviest_song"] = null;
  let heaviestNumber = Number.POSITIVE_INFINITY;

  for (const track of tracks) {
    const score = track.heaviness_score;
    if (score === null) {
      continue;
    }
    const replace =
      heaviest === null ||
      score > heaviest.heaviness_score ||
      (score === heaviest.heaviness_score && track.track_number < heaviestNumber);
    if (replace) {
      heaviest = { id: track.id, title: track.title, heaviness_score: score };
      heaviestNumber = track.track_number;
    }
  }

  let standout: AlbumSummary["standout_instrument"] = null;
  for (const instrument of INSTRUMENTS) {
    const values = tracks
      .map((track) => track[instrument.field])
      .filter((score): score is number => score !== null);
    if (values.length === 0) {
      continue;
    }
    const average = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
    if (standout === null || average > standout.average) {
      standout = { metric: instrument.field, label: instrument.label, average };
    }
  }

  return {
    track_count: tracks.length,
    album_average: computeComposite(composites),
    heaviest_song: heaviest,
    standout_instrument: standout,
  };
}
