"use client";

import { ExternalLink, Music2, X } from "lucide-react";
import type { PlayTrackInfo } from "@/lib/types";

export function TrackPlayerBar({
  track,
  onClose,
}: {
  track: PlayTrackInfo | null;
  onClose: () => void;
}) {
  if (!track) {
    return null;
  }

  return (
    <aside
      aria-label="Track audio player"
      className="fixed inset-x-0 bottom-0 z-40 bg-surface px-3 py-2 sm:px-6"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {track.cover_art_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={track.cover_art_url}
              alt=""
              className="h-12 w-12 shrink-0 rounded-md object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-raised text-zinc-400">
              <Music2 className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-100">{track.title}</p>
            <p className="truncate text-xs text-zinc-400">
              {track.artist} · {track.album}
            </p>
            {track.spotify_url ? (
              <a
                href={track.spotify_url}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
              >
                <span>Open in Spotify</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center">
          {track.embed_url ? (
            <iframe
              src={track.embed_url}
              width="100%"
              height="80"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              className="h-20 w-full max-w-xl rounded-md border-0 bg-transparent"
              title={`Spotify Player — ${track.title}`}
            />
          ) : (
            <div className="flex items-center gap-3 rounded-md border border-line bg-raised px-4 py-3 text-xs text-zinc-400">
              <span>This track isn’t available for preview on Spotify.</span>
              {track.spotify_url ? (
                <a
                  href={track.spotify_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-zinc-200 hover:text-white"
                >
                  <span>Search Spotify</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close player"
            title="Close player"
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
