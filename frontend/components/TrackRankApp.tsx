"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { csvEscape, downloadFile, slugify } from "@/lib/format";
import { albumStats, formatComposite, formatScore } from "@/lib/score";
import type { Album, AlbumInput, PlayTrackInfo, Track, TracksResponse } from "@/lib/types";
import { AlbumFormDialog } from "./AlbumFormDialog";
import { AlbumHeader, type SaveState } from "./AlbumHeader";
import { ImportDialog } from "./ImportDialog";
import { AlbumSummaryStats } from "./AlbumSummaryStats";
import { RatingSpreadsheet } from "./RatingSpreadsheet";
import { TrackPlayerBar } from "./TrackPlayerBar";

export function TrackRankApp() {
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const spotifyReturn = params.get("spotify");
  const albumsQuery = useQuery({
    queryKey: ["albums"],
    queryFn: () => api<Album[]>("/api/albums"),
  });
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [focusTrackId, setFocusTrackId] = useState<number | null>(null);
  const [activeTrack, setActiveTrack] = useState<PlayTrackInfo | null>(null);
  const [loadingTrackId, setLoadingTrackId] = useState<number | null>(null);
  const [year, setYear] = useState("all");
  const [dialog, setDialog] = useState<"create" | "edit" | "import" | null>(spotifyReturn ? "import" : null);
  const [importTab, setImportTab] = useState<"sheet" | "spotify">(spotifyReturn ? "spotify" : "sheet");
  const [importNotice, setImportNotice] = useState<string | null>(() => {
    if (spotifyReturn === "error") {
      return params.get("message") || "Spotify didn't connect.";
    }
    if (spotifyReturn === "denied") {
      return "Spotify access was cancelled.";
    }
    return null;
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [actionError, setActionError] = useState<string | null>(null);

  const albums = useMemo(() => albumsQuery.data ?? [], [albumsQuery.data]);
  const years = useMemo(
    () => [...new Set(albums.map((album) => album.release_year))].sort((a, b) => b - a),
    [albums],
  );
  const visible = useMemo(
    () => albums.filter((album) => year === "all" || String(album.release_year) === year),
    [albums, year],
  );
  const selectedId = visible.some((album) => album.id === pickedId) ? pickedId : (visible[0]?.id ?? null);
  const albumFromList = albums.find((album) => album.id === selectedId) ?? null;

  const tracksQuery = useQuery({
    queryKey: ["tracks", selectedId],
    queryFn: () => api<TracksResponse>(`/api/albums/${selectedId}/tracks`),
    enabled: selectedId !== null,
  });

  useEffect(() => {
    if (!spotifyReturn) {
      return;
    }
    const next = new URLSearchParams(params.toString());
    next.delete("spotify");
    next.delete("message");
    const query = next.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [params, spotifyReturn]);

  const album = tracksQuery.data?.album ?? albumFromList;
  const summary = tracksQuery.data ? albumStats(tracksQuery.data.tracks) : album?.summary;

  async function handlePlayTrack(track: Track) {
    if (activeTrack?.id === track.id) {
      setActiveTrack(null);
      return;
    }
    setLoadingTrackId(track.id);
    setActionError(null);
    try {
      const data = await api<PlayTrackInfo>(`/api/tracks/${track.id}/play`);
      setActiveTrack(data);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't load audio for that track.");
    } finally {
      setLoadingTrackId(null);
    }
  }

  async function createAlbum(input: AlbumInput) {
    const created = await api<Album>("/api/albums", {
      method: "POST",
      body: JSON.stringify(input),
    });
    queryClient.setQueryData<Album[]>(["albums"], (current) => sortAlbums([...(current ?? []), created]));
    setYear("all");
    setPickedId(created.id);
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ["albums"] });
  }

  async function editAlbum(input: AlbumInput) {
    if (selectedId === null) {
      return;
    }
    const updated = await api<Album>(`/api/albums/${selectedId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    queryClient.setQueryData<Album[]>(["albums"], (current) =>
      sortAlbums((current ?? []).map((item) => (item.id === updated.id ? updated : item))),
    );
    setDialog(null);
    void queryClient.invalidateQueries({ queryKey: ["albums"] });
    void queryClient.invalidateQueries({ queryKey: ["tracks", selectedId] });
  }

  async function deleteAlbum() {
    if (!album) {
      return;
    }
    if (!window.confirm(`Delete “${album.title}” and all of its tracks?`)) {
      return;
    }
    setActionError(null);
    try {
      await api<void>(`/api/albums/${album.id}`, { method: "DELETE" });
      queryClient.setQueryData<Album[]>(["albums"], (current) => (current ?? []).filter((item) => item.id !== album.id));
      setPickedId(null);
      void queryClient.invalidateQueries({ queryKey: ["albums"] });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Couldn't delete the album.");
    }
  }

  function exportJson() {
    if (!album || !tracksQuery.data) {
      return;
    }
    const payload = {
      album,
      tracks: tracksQuery.data.tracks,
      summary: albumStats(tracksQuery.data.tracks),
    };
    downloadFile(
      `${slugify(album.artist)}-${slugify(album.title)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json",
    );
  }

  function exportCsv() {
    if (!album || !tracksQuery.data) {
      return;
    }
    const header = [
      "track_number",
      "title",
      "duration_seconds",
      "drums",
      "bass",
      "guitar",
      "heaviness",
      "vocals",
      "quality",
      "composite",
      "notes",
    ];
    const lines = tracksQuery.data.tracks.map((track) =>
      [
        track.track_number,
        csvEscape(track.title),
        csvEscape(track.duration_seconds),
        csvEscape(scoreCsv(track.drums_score)),
        csvEscape(scoreCsv(track.bass_score)),
        csvEscape(scoreCsv(track.guitar_score)),
        csvEscape(scoreCsv(track.heaviness_score)),
        csvEscape(scoreCsv(track.singing_score)),
        csvEscape(scoreCsv(track.subjective_score)),
        csvEscape(track.composite_score === null ? "N/A" : formatComposite(track.composite_score)),
        csvEscape(track.notes),
      ].join(","),
    );
    downloadFile(
      `${slugify(album.artist)}-${slugify(album.title)}.csv`,
      [header.join(","), ...lines].join("\n"),
      "text/csv",
    );
  }

  if (albumsQuery.isPending) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-zinc-500">Loading library…</p>
      </main>
    );
  }

  if (albumsQuery.isError) {
    const message = albumsQuery.error instanceof ApiError ? albumsQuery.error.message : "The scoring API is unreachable.";
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6">
          <p className="text-[15px] font-bold tracking-tight text-zinc-50">TrackRank</p>
          <h1 className="mt-5 text-base font-semibold text-zinc-100">The library didn&apos;t load</h1>
          <p className="mt-2 rounded-md border border-rose-500/20 bg-rose-500/[0.07] px-3 py-2 text-sm text-rose-200">
            {message}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-500">
            Start the PHP API on port 8080, then confirm MySQL granted the musicranker account access to its database.
          </p>
          <button
            type="button"
            onClick={() => void albumsQuery.refetch()}
            className="mt-5 h-9 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={activeTrack ? "pb-28" : ""}>
      <AlbumHeader
        albums={visible}
        year={year}
        years={years}
        onYearChange={setYear}
        selectedId={selectedId}
        onSelect={(id) => {
          setFocusTrackId(null);
          setPickedId(id);
        }}
        onSelectTrack={(albumId, trackId) => {
          setPickedId(albumId);
          setFocusTrackId(trackId);
        }}
        onCreate={() => setDialog("create")}
        onImport={() => {
          setImportTab("sheet");
          setImportNotice(null);
          setDialog("import");
        }}
        onEdit={() => setDialog("edit")}
        onDelete={() => void deleteAlbum()}
        onExportCsv={exportCsv}
        onExportJson={exportJson}
        saveState={saveState}
        album={album && summary ? { ...album, summary } : album}
      >
        {actionError ? <p className="text-sm text-rose-300">{actionError}</p> : null}
        {summary ? <AlbumSummaryStats summary={summary} /> : null}
        {selectedId !== null && tracksQuery.isPending ? (
          <p className="text-sm text-zinc-500">Loading tracks…</p>
        ) : null}
        {tracksQuery.isError ? (
          <p className="text-sm text-rose-300">
            {tracksQuery.error instanceof Error ? tracksQuery.error.message : "Couldn't load tracks."}
          </p>
        ) : null}
        {selectedId !== null && tracksQuery.data ? (
          <RatingSpreadsheet
            albumId={selectedId}
            tracks={tracksQuery.data.tracks}
            focusTrackId={focusTrackId}
            activeTrackId={activeTrack?.id ?? null}
            loadingTrackId={loadingTrackId}
            onPlayTrack={(track) => void handlePlayTrack(track)}
            onSaveState={setSaveState}
          />
        ) : null}
      </AlbumHeader>
      <TrackPlayerBar track={activeTrack} onClose={() => setActiveTrack(null)} />
      {dialog === "create" ? (
        <AlbumFormDialog
          heading="New album"
          initial={{ title: "", artist: "", release_year: new Date().getFullYear(), cover_art_url: null }}
          onClose={() => setDialog(null)}
          onSubmit={createAlbum}
        />
      ) : null}
      {dialog === "import" ? (
        <ImportDialog
          initialTab={importTab}
          notice={importNotice}
          onClose={() => setDialog(null)}
          onImported={(albumId) => {
            setYear("all");
            if (albumId) {
              setPickedId(albumId);
            }
            setDialog(null);
            void queryClient.invalidateQueries({ queryKey: ["albums"] });
            void queryClient.invalidateQueries({ queryKey: ["tracks"] });
          }}
        />
      ) : null}
      {dialog === "edit" && album ? (
        <AlbumFormDialog
          heading="Edit album"
          initial={{
            title: album.title,
            artist: album.artist,
            release_year: album.release_year,
            cover_art_url: album.cover_art_url,
          }}
          onClose={() => setDialog(null)}
          onSubmit={editAlbum}
        />
      ) : null}
    </main>
  );
}

function sortAlbums(albums: Album[]): Album[] {
  return [...albums].sort(
    (a, b) => b.release_year - a.release_year || a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
  );
}

function scoreCsv(score: number | null): string {
  return score === null ? "N/A" : formatScore(score);
}
