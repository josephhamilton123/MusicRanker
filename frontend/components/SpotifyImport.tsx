"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { ImportAlbum } from "@/lib/spreadsheet";
import { resultSummary } from "./SpreadsheetImport";

type SpotifyStatus = {
  configured: boolean;
  connected: boolean;
  redirect_uri: string;
  user: { id: string; name: string } | null;
};

type Playlist = { id: string; name: string; owner: string; tracks: number; image: string | null };
type Artist = { id: string; name: string; genres: string; image: string | null; sources?: string[] };
type Selection = { type: "playlist" | "artist"; id: string };

const fieldClass = "h-9 w-full rounded-md border border-line bg-raised px-3 text-sm text-zinc-100";

export function SpotifyImport({ onDone }: { onDone: (albumId: number | null, summary: string) => void }) {
  const status = useQuery({
    queryKey: ["spotify", "status"],
    queryFn: () => api<SpotifyStatus>("/api/spotify/status"),
  });
  const playlists = useQuery({
    queryKey: ["spotify", "playlists"],
    queryFn: () => api<Playlist[]>("/api/spotify/playlists"),
    enabled: status.data?.connected === true,
  });
  const artists = useQuery({
    queryKey: ["spotify", "artists"],
    queryFn: () => api<Artist[]>("/api/spotify/artists"),
    enabled: status.data?.connected === true,
  });

  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const search = useQuery({
    queryKey: ["spotify", "search", submittedQuery],
    queryFn: () => api<Artist[]>(`/api/spotify/search?q=${encodeURIComponent(submittedQuery)}`),
    enabled: submittedQuery.trim().length > 1,
  });
  const [selected, setSelected] = useState<Selection[]>([]);
  const [depth, setDepth] = useState<"tracks" | "albums" | "discography">("albums");
  const [includeSingles, setIncludeSingles] = useState(false);
  const [preview, setPreview] = useState<{ albums: ImportAlbum[]; album_count: number; track_count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"preview" | "import" | null>(null);

  const selectedKey = useMemo(() => new Set(selected.map((item) => `${item.type}:${item.id}`)), [selected]);

  function toggle(selection: Selection) {
    setPreview(null);
    setSelected((current) => {
      const key = `${selection.type}:${selection.id}`;
      if (current.some((item) => `${item.type}:${item.id}` === key)) {
        return current.filter((item) => `${item.type}:${item.id}` !== key);
      }
      return [...current, selection];
    });
  }

  async function connect() {
    const result = await api<{ url: string }>(
      `/api/spotify/authorize?return=${encodeURIComponent(window.location.origin)}`,
    );
    window.location.href = result.url;
  }

  async function loadPreview() {
    setPending("preview");
    setError(null);
    try {
      const result = await api<{ albums: ImportAlbum[]; album_count: number; track_count: number }>("/api/spotify/preview", {
        method: "POST",
        body: JSON.stringify({ selections: selected, depth, include_singles: includeSingles }),
      });
      setPreview(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Spotify didn't return that music.");
    } finally {
      setPending(null);
    }
  }

  async function submit() {
    if (!preview) {
      return;
    }
    setPending("import");
    setError(null);
    try {
      const result = await api<{ album_ids: number[]; created_albums: number; created_tracks: number; updated_tracks: number; skipped_tracks: number }>(
        "/api/import",
        { method: "POST", body: JSON.stringify({ albums: preview.albums }) },
      );
      onDone(result.album_ids[0] ?? null, resultSummary(result));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
      setPending(null);
    }
  }

  if (status.isPending) {
    return <p className="text-sm text-zinc-500">Checking Spotify…</p>;
  }

  if (!status.data?.configured) {
    return (
      <div className="max-w-lg text-sm leading-relaxed text-zinc-400">
        <p className="text-zinc-200">Spotify needs a client ID before it can see your account.</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5">
          <li>Open the Spotify developer dashboard and create an app.</li>
          <li>
            Add this redirect URI:{" "}
            <code className="text-zinc-200">{status.data?.redirect_uri ?? "http://127.0.0.1:8080/api/spotify/callback"}</code>
          </li>
          <li>
            Put the client ID in <code className="text-zinc-200">backend/.env</code> as{" "}
            <code className="text-zinc-200">SPOTIFY_CLIENT_ID</code>.
          </li>
        </ol>
        <p className="mt-3">Save the file, then come back here. The API picks it up on the next request.</p>
      </div>
    );
  }

  if (!status.data.connected) {
    return (
      <div className="max-w-lg">
        <p className="text-sm leading-relaxed text-zinc-400">
          Connect Spotify to pull albums from your playlists, followed artists, and top artists. Tracks come in unscored,
          ready for you to rate.
        </p>
        <button
          type="button"
          onClick={() => void connect().catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Couldn't start Spotify."))}
          className="mt-4 h-9 rounded-md bg-[#1ed760] px-4 text-sm font-semibold text-black hover:bg-[#3be477]"
        >
          Connect Spotify
        </button>
        {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-400">
          Connected as <span className="text-zinc-100">{status.data.user?.name}</span>
        </p>
        <button
          type="button"
          onClick={() => void api("/api/spotify/disconnect", { method: "POST" }).then(() => status.refetch())}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Disconnect
        </button>
      </div>

      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmittedQuery(query.trim());
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search artists"
          className={`${fieldClass} pl-8`}
        />
      </form>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        <Picker
          title="Playlists"
          empty={playlists.isError ? "Couldn't load playlists." : "No playlists."}
          items={(playlists.data ?? []).map((playlist) => ({
            id: playlist.id,
            type: "playlist" as const,
            name: playlist.name,
            detail: `${playlist.tracks} songs${playlist.owner ? ` · ${playlist.owner}` : ""}`,
          }))}
          selected={selectedKey}
          onToggle={toggle}
        />
        <Picker
          title="Artists"
          empty={artists.isError ? "Couldn't load artists." : "No followed or top artists."}
          items={[
            ...(search.data ?? []).map((artist) => ({
              id: artist.id,
              type: "artist" as const,
              name: artist.name,
              detail: artist.genres || "Search result",
            })),
            ...(artists.data ?? []).map((artist) => ({
              id: artist.id,
              type: "artist" as const,
              name: artist.name,
              detail: artist.sources?.join(" · ") || artist.genres,
            })),
          ].filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)}
          selected={selectedKey}
          onToggle={toggle}
        />
      </div>

      <fieldset className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-3">
        <DepthOption
          checked={depth === "tracks"}
          onChange={() => {
            setDepth("tracks");
            setPreview(null);
          }}
          label="Playlist songs"
          detail="Just the songs in the playlist."
        />
        <DepthOption
          checked={depth === "albums"}
          onChange={() => {
            setDepth("albums");
            setPreview(null);
          }}
          label="Full albums"
          detail="Every track on those albums."
        />
        <DepthOption
          checked={depth === "discography"}
          onChange={() => {
            setDepth("discography");
            setPreview(null);
          }}
          label="Discography"
          detail="Studio albums by those artists."
        />
      </fieldset>
      <label className="flex items-center gap-2 text-sm text-zinc-400">
        <input
          type="checkbox"
          checked={includeSingles}
          onChange={(event) => {
            setIncludeSingles(event.target.checked);
            setPreview(null);
          }}
          className="accent-zinc-200"
        />
        Include singles when importing a discography
      </label>

      {preview ? (
        <p className="text-sm text-zinc-300">
          {preview.album_count} albums · {preview.track_count} tracks
          {preview.albums[0] ? ` · starts with ${preview.albums[0].artist} — ${preview.albums[0].title}` : ""}
        </p>
      ) : null}
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={selected.length === 0 || pending !== null}
          onClick={() => void loadPreview()}
          className="h-9 rounded-md border border-line px-3 text-sm text-zinc-200 hover:bg-white/[0.05] disabled:opacity-40"
        >
          {pending === "preview" ? "Fetching…" : "Preview"}
        </button>
        <button
          type="button"
          disabled={!preview || preview.album_count === 0 || pending !== null}
          onClick={() => void submit()}
          className="h-9 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-40"
        >
          {pending === "import" ? "Importing…" : "Import"}
        </button>
      </div>
    </div>
  );
}

function Picker({
  title,
  items,
  empty,
  selected,
  onToggle,
}: {
  title: string;
  items: Array<{ id: string; type: "playlist" | "artist"; name: string; detail: string }>;
  empty: string;
  selected: Set<string>;
  onToggle: (selection: Selection) => void;
}) {
  return (
    <section className="flex min-h-48 flex-col overflow-hidden rounded-md border border-line">
      <h3 className="border-b border-line px-3 py-2 text-xs font-medium text-zinc-500">{title}</h3>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? <li className="px-3 py-4 text-sm text-zinc-500">{empty}</li> : null}
        {items.map((item) => {
          const key = `${item.type}:${item.id}`;
          return (
            <li key={key}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-white/[0.04]">
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => onToggle({ type: item.type, id: item.id })}
                  className="accent-zinc-200"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-zinc-100">{item.name}</span>
                  <span className="block truncate text-xs text-zinc-500">{item.detail}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DepthOption({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  detail: string;
}) {
  return (
    <label className={`cursor-pointer rounded-md border px-3 py-2 ${checked ? "border-white/30 bg-white/[0.05]" : "border-line"}`}>
      <input type="radio" name="spotify-depth" checked={checked} onChange={onChange} className="sr-only" />
      <span className="block text-sm text-zinc-100">{label}</span>
      <span className="mt-0.5 block text-xs text-zinc-500">{detail}</span>
    </label>
  );
}
