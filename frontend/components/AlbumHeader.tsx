"use client";

import { ChevronRight, Download, FileJson, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { scoreTextClass } from "@/lib/score";
import type { Album, CatalogTrack } from "@/lib/types";

export type SaveState = "idle" | "saving" | "saved" | "error";

const saveLabel: Record<SaveState, string> = {
  idle: "",
  saving: "Saving",
  saved: "Saved",
  error: "Couldn't save",
};

const saveDot: Record<SaveState, string> = {
  idle: "",
  saving: "bg-zinc-400 animate-pulse",
  saved: "bg-emerald-400",
  error: "bg-rose-400",
};

export function AlbumHeader({
  albums,
  year,
  years,
  onYearChange,
  selectedId,
  onSelect,
  onSelectTrack,
  onCreate,
  onImport,
  onEdit,
  onDelete,
  onExportCsv,
  onExportJson,
  saveState,
  album,
  children,
}: {
  albums: Album[];
  year: string;
  years: number[];
  onYearChange: (year: string) => void;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onSelectTrack: (albumId: number, trackId: number) => void;
  onCreate: () => void;
  onImport: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  saveState: SaveState;
  album: Album | null;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  const selectedArtist = artistKey(albums.find((item) => item.id === selectedId)?.artist ?? "");
  const groups = useMemo(() => groupAlbums(albums, query), [albums, query]);
  const searching = query.trim() !== "";

  function artistOpen(key: string): boolean {
    if (searching) {
      return true;
    }
    if (key in manualOpen) {
      return manualOpen[key];
    }
    return key === selectedArtist;
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="flex max-h-[45vh] flex-col border-b border-line bg-surface lg:sticky lg:top-0 lg:h-screen lg:max-h-none lg:border-r lg:border-b-0">
        <div className="flex h-14 items-center justify-between px-4">
          <p className="text-[15px] font-bold tracking-tight text-zinc-50">TrackRank</p>
          <span className="flex items-center">
            <button
              type="button"
              onClick={onImport}
              aria-label="Import"
              title="Import"
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
            >
              <Upload className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onCreate}
              aria-label="New album"
              title="New album"
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
            >
              <Plus className="h-4 w-4" />
            </button>
          </span>
        </div>
        <div className="space-y-2 px-3 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              aria-label="Search artists or tracks"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Artist or track"
              className="h-9 w-full rounded-md border border-line bg-raised pr-8 pl-8 text-sm text-zinc-100 placeholder:text-zinc-500"
            />
            {query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-zinc-500 hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <select
            aria-label="Filter by release year"
            value={year}
            onChange={(event) => onYearChange(event.target.value)}
            className="h-9 w-full rounded-md border border-line bg-raised px-2.5 text-sm text-zinc-200"
          >
            <option value="all">All years</option>
            {years.map((value) => (
              <option key={value} value={value}>
                {value > 0 ? value : "Unknown year"}
              </option>
            ))}
          </select>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {albums.length === 0 ? (
            <p className="px-2 py-6 text-sm text-zinc-500">No albums yet.</p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-6 text-sm text-zinc-500">No artists or tracks match.</p>
          ) : (
            groups.map((group) => {
              const open = artistOpen(group.key);
              return (
                <section key={group.key} className="mb-1">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setManualOpen((current) => ({ ...current, [group.key]: !open }))}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-white/[0.04]"
                  >
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${open ? "rotate-90" : ""}`} />
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-200">{group.artist}</span>
                    <span className="text-[11px] tabular-nums text-zinc-600">{group.albums.length}</span>
                  </button>
                  {open
                    ? group.albums.map((entry) => (
                        <div key={entry.album.id} className="ml-3">
                          <AlbumRow album={entry.album} selected={entry.album.id === selectedId} onSelect={onSelect} />
                          {entry.tracks.map((track) => (
                            <button
                              key={track.id}
                              type="button"
                              onClick={() => onSelectTrack(entry.album.id, track.id)}
                              className="flex w-full items-baseline gap-2 rounded-md py-1 pr-2 pl-12 text-left hover:bg-white/[0.04]"
                            >
                              <span className="w-4 shrink-0 text-[11px] tabular-nums text-zinc-600">{track.track_number}</span>
                              <span className="truncate text-xs text-zinc-400">{track.title}</span>
                            </button>
                          ))}
                        </div>
                      ))
                    : null}
                </section>
              );
            })
          )}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <header>
          {album ? (
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div className="flex items-center gap-4">
                <AlbumMark artist={album.artist} cover={album.cover_art_url} size="lg" />
                <div className="min-w-0">
                  <p className="text-sm text-zinc-400">{album.artist}</p>
                  <h1 className="truncate text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">{album.title}</h1>
                  <p className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
                    <span>
                      {album.release_year > 0 ? album.release_year : "Unknown"} · {album.summary.track_count} tracks
                    </span>
                    {saveLabel[saveState] ? (
                      <span className="inline-flex items-center gap-1.5 text-zinc-400">
                        <span className={`h-1.5 w-1.5 rounded-full ${saveDot[saveState]}`} />
                        {saveLabel[saveState]}
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <IconButton onClick={onExportCsv} label="Export CSV" icon={<Download className="h-4 w-4" />} text="CSV" />
                <IconButton onClick={onExportJson} label="Export JSON" icon={<FileJson className="h-4 w-4" />} text="JSON" />
                <span className="mx-1 h-5 w-px bg-line" />
                <IconButton onClick={onEdit} label="Edit album" icon={<Pencil className="h-4 w-4" />} />
                <IconButton onClick={onDelete} label="Delete album" icon={<Trash2 className="h-4 w-4" />} danger />
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-50">No album selected</h1>
              <p className="mt-1 text-sm text-zinc-500">Create an album to start scoring.</p>
            </div>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}

function AlbumRow({ album, selected, onSelect }: { album: Album; selected: boolean; onSelect: (id: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(album.id)}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
        selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
      }`}
    >
      <AlbumMark artist={album.artist} cover={album.cover_art_url} size="sm" />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm font-semibold ${selected ? "text-zinc-50" : "text-zinc-300"}`}>
          {album.title}
        </span>
        <span className="block truncate text-xs text-zinc-500">{album.release_year > 0 ? album.release_year : "Unknown"}</span>
      </span>
      <span className={`text-xs font-semibold tabular-nums ${scoreTextClass(album.summary.album_average)}`}>
        {album.summary.album_average === null ? "N/A" : album.summary.album_average.toFixed(2)}
      </span>
    </button>
  );
}

type ArtistGroup = {
  key: string;
  artist: string;
  albums: Array<{ album: Album; tracks: CatalogTrack[] }>;
};

function groupAlbums(albums: Album[], query: string): ArtistGroup[] {
  const needle = query.trim().toLowerCase();
  const groups = new Map<string, ArtistGroup>();
  const ordered = [...albums].sort(
    (a, b) => artistKey(a.artist).localeCompare(artistKey(b.artist)) || b.release_year - a.release_year || a.title.localeCompare(b.title),
  );

  for (const album of ordered) {
    const tracks = needle === "" ? [] : matchingTracks(album, needle);
    const artistHit = needle !== "" && artistMatches(album.artist, needle);
    const albumHit = needle !== "" && album.title.toLowerCase().includes(needle);
    if (needle !== "" && !artistHit && !albumHit && tracks.length === 0) {
      continue;
    }
    const key = artistKey(album.artist);
    const group = groups.get(key) ?? { key, artist: album.artist, albums: [] };
    group.albums.push({ album, tracks: artistHit ? [] : tracks });
    groups.set(key, group);
  }

  return [...groups.values()];
}

function matchingTracks(album: Album, needle: string): CatalogTrack[] {
  return (album.tracks ?? []).filter((track) => track.title.toLowerCase().includes(needle));
}

function artistMatches(artist: string, needle: string): boolean {
  const name = artist.trim().toLowerCase();
  if (name.includes(needle)) {
    return true;
  }
  const bareNeedle = needle.replace(/^the\s+/, "");
  return bareNeedle !== "" && bareNeedle !== needle && artistKey(artist).includes(bareNeedle);
}

function artistKey(artist: string): string {
  return artist.trim().toLowerCase().replace(/^the\s+/, "").replace(/\s+/g, " ");
}

function IconButton({
  onClick,
  label,
  icon,
  text,
  danger = false,
}: {
  onClick: () => void;
  label: string;
  icon: ReactNode;
  text?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-zinc-400 transition-colors hover:bg-white/[0.06] ${
        danger ? "hover:text-rose-300" : "hover:text-zinc-100"
      }`}
    >
      {icon}
      {text ? <span>{text}</span> : null}
    </button>
  );
}

function AlbumMark({ artist, cover, size }: { artist: string; cover: string | null; size: "sm" | "lg" }) {
  const box = size === "lg" ? "h-16 w-16 rounded-md text-xl" : "h-9 w-9 rounded text-sm";
  if (cover) {
    return (
      // User-supplied cover URLs are not known at build time, so the browser loads them directly.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={cover} alt="" className={`${box} shrink-0 object-cover`} />
    );
  }

  return (
    <div className={`${box} flex shrink-0 items-center justify-center bg-raised font-bold text-zinc-400 ring-1 ring-line ring-inset`}>
      {artist.slice(0, 1).toUpperCase()}
    </div>
  );
}
