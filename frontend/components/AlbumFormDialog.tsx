"use client";

import { X } from "lucide-react";
import { useState } from "react";
import type { AlbumInput } from "@/lib/types";

const inputClass =
  "mt-1.5 h-9 w-full rounded-md border border-line bg-raised px-3 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-white/25";

export function AlbumFormDialog({
  heading,
  initial,
  onClose,
  onSubmit,
}: {
  heading: string;
  initial: AlbumInput;
  onClose: () => void;
  onSubmit: (value: AlbumInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial.title);
  const [artist, setArtist] = useState(initial.artist);
  const [year, setYear] = useState(String(initial.release_year || new Date().getFullYear()));
  const [cover, setCover] = useState(initial.cover_art_url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const releaseYear = Number(year);
    if (!title.trim() || !artist.trim() || !Number.isInteger(releaseYear)) {
      setError("Title, artist, and a whole release year are required.");
      return;
    }
    if (cover.trim() && !/^https?:\/\//i.test(cover.trim())) {
      setError("Cover art must be an http(s) URL.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        artist: artist.trim(),
        release_year: releaseYear,
        cover_art_url: cover.trim() || null,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't save the album.");
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={onClose}
    >
      <form
        className="w-full max-w-md rounded-lg border border-line bg-surface p-5 shadow-2xl shadow-black/60"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-50">{heading}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-zinc-400">
            Title
            <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} />
          </label>
          <label className="block text-xs font-medium text-zinc-400">
            Artist
            <input value={artist} onChange={(event) => setArtist(event.target.value)} className={inputClass} />
          </label>
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <label className="block text-xs font-medium text-zinc-400">
              Year
              <input
                inputMode="numeric"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                className={`${inputClass} tabular-nums`}
              />
            </label>
            <label className="block text-xs font-medium text-zinc-400">
              Cover art URL
              <input
                value={cover}
                onChange={(event) => setCover(event.target.value)}
                placeholder="https://"
                className={inputClass}
              />
            </label>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md px-3 text-sm text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="h-9 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
