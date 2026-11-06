import { formatComposite, scoreTextClass } from "@/lib/score";
import type { AlbumSummary } from "@/lib/types";

export function AlbumSummaryStats({ summary }: { summary: AlbumSummary }) {
  return (
    <section className="grid overflow-hidden rounded-lg border border-line bg-surface sm:grid-cols-3 sm:divide-x sm:divide-line">
      <Stat label="Album average">
        <p className={`text-3xl font-semibold tabular-nums tracking-tight ${scoreTextClass(summary.album_average)}`}>
          {formatComposite(summary.album_average)}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Across {summary.track_count} {summary.track_count === 1 ? "track" : "tracks"}
        </p>
      </Stat>
      <Stat label="Heaviest song">
        {summary.heaviest_song ? (
          <>
            <p className="truncate text-lg font-semibold text-zinc-100">{summary.heaviest_song.title}</p>
            <p className="mt-1 text-xs text-zinc-500">
              Heaviness{" "}
              <span className={`font-semibold tabular-nums ${scoreTextClass(summary.heaviest_song.heaviness_score)}`}>
                {summary.heaviest_song.heaviness_score}
              </span>
            </p>
          </>
        ) : (
          <p className="text-sm text-zinc-500">No heaviness scores yet</p>
        )}
      </Stat>
      <Stat label="Standout instrument">
        {summary.standout_instrument ? (
          <>
            <p className="text-lg font-semibold text-zinc-100">{summary.standout_instrument.label}</p>
            <p className="mt-1 text-xs text-zinc-500">
              Average{" "}
              <span className={`font-semibold tabular-nums ${scoreTextClass(summary.standout_instrument.average)}`}>
                {summary.standout_instrument.average.toFixed(2)}
              </span>
            </p>
          </>
        ) : (
          <p className="text-sm text-zinc-500">Score drums, bass, or guitar</p>
        )}
      </Stat>
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line px-5 py-4 last:border-b-0 sm:border-b-0">
      <p className="mb-2 text-xs font-medium text-zinc-500">{label}</p>
      {children}
    </div>
  );
}
