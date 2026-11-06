"use client";

import { FileUp } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import {
  IMPORT_FIELD_OPTIONS,
  buildImport,
  parseSheet,
  type ColumnMapping,
  type ImportAlbum,
  type ParsedSheet,
} from "@/lib/spreadsheet";

const fieldClass =
  "h-9 w-full rounded-md border border-line bg-raised px-3 text-sm text-zinc-100 placeholder:text-zinc-600";

export function SpreadsheetImport({
  onDone,
}: {
  onDone: (albumId: number | null, summary: string) => void;
}) {
  const [raw, setRaw] = useState("");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const preview = useMemo(() => {
    if (!sheet) {
      return null;
    }
    return buildImport(sheet, { artist, album, releaseYear: year });
  }, [sheet, artist, album, year]);

  function readText(text: string) {
    setError(null);
    try {
      setSheet(parseSheet(text));
      setRaw(text);
    } catch (caught) {
      setSheet(null);
      setError(caught instanceof Error ? caught.message : "Couldn't read that sheet.");
    }
  }

  function updateMapping(index: number, value: ColumnMapping) {
    setSheet((current) => {
      if (!current) {
        return current;
      }
      const mapping = current.mapping.map((entry, entryIndex) => {
        if (entryIndex === index) {
          return value;
        }
        return value !== "ignore" && entry === value ? "ignore" : entry;
      });
      return { ...current, mapping };
    });
  }

  async function submit() {
    if (!preview || preview.albums.length === 0) {
      setError("Nothing to import yet.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await api<ImportResult>("/api/import", {
        method: "POST",
        body: JSON.stringify({ albums: preview.albums }),
      });
      onDone(result.album_ids[0] ?? null, resultSummary(result));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-[1fr_220px]">
        <textarea
          value={raw}
          onChange={(event) => {
            setRaw(event.target.value);
            setSheet(null);
          }}
          rows={6}
          placeholder={"Paste from Google Sheets, including the header row.\nArtist, Album, Year, Track, Drums, Bass…"}
          className="w-full resize-y rounded-md border border-line bg-raised px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
        />
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-white/15 bg-raised px-4 py-6 text-center text-sm text-zinc-400 hover:border-white/30 hover:text-zinc-200">
          <FileUp className="h-5 w-5" />
          <span>{fileName ?? "Upload a CSV"}</span>
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              setFileName(file.name);
              void file.text().then(readText);
            }}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => readText(raw)}
          className="h-9 rounded-md bg-zinc-100 px-3 text-sm font-semibold text-zinc-900 hover:bg-white"
        >
          Read data
        </button>
        <p className="text-xs text-zinc-500">
          Copy the cells in Sheets, or File → Download → CSV. Headers can be Artist, Album, Track, Drums, and so on.
        </p>
      </div>

      {sheet ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-zinc-400">
              Artist if the sheet has none
              <input value={artist} onChange={(event) => setArtist(event.target.value)} className={`${fieldClass} mt-1.5`} />
            </label>
            <label className="text-xs font-medium text-zinc-400">
              Album if the sheet has none
              <input value={album} onChange={(event) => setAlbum(event.target.value)} className={`${fieldClass} mt-1.5`} />
            </label>
            <label className="text-xs font-medium text-zinc-400">
              Year if the sheet has none
              <input value={year} onChange={(event) => setYear(event.target.value)} placeholder="1994" className={`${fieldClass} mt-1.5`} />
            </label>
          </div>
          <div className="overflow-x-auto">
            <div className="flex min-w-max gap-2">
              {sheet.headers.map((header, index) => (
                <label key={`${header}-${index}`} className="w-36 text-xs text-zinc-500">
                  <span className="block truncate font-medium text-zinc-300">{header}</span>
                  <select
                    value={sheet.mapping[index]}
                    onChange={(event) => updateMapping(index, event.target.value as ColumnMapping)}
                    className={`${fieldClass} mt-1`}
                  >
                    {IMPORT_FIELD_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
          {preview ? <Preview albums={preview.albums} warnings={preview.warnings} /> : null}
        </>
      ) : null}

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      <div className="mt-auto flex justify-end">
        <button
          type="button"
          disabled={pending || !preview || preview.albums.length === 0}
          onClick={() => void submit()}
          className="h-9 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-40"
        >
          {pending ? "Importing…" : "Import"}
        </button>
      </div>
    </div>
  );
}

function Preview({ albums, warnings }: { albums: ImportAlbum[]; warnings: string[] }) {
  const tracks = albums.reduce((sum, album) => sum + album.tracks.length, 0);
  const sample = albums.slice(0, 4);

  return (
    <div className="rounded-md border border-line">
      <p className="border-b border-line px-3 py-2 text-sm text-zinc-300">
        {albums.length} {albums.length === 1 ? "album" : "albums"} · {tracks} tracks
      </p>
      <ul className="divide-y divide-line">
        {sample.map((album) => (
          <li key={`${album.artist}-${album.title}-${album.release_year}`} className="px-3 py-2 text-sm">
            <span className="text-zinc-100">{album.title}</span>
            <span className="text-zinc-500">
              {" "}
              · {album.artist}
              {album.release_year > 0 ? ` · ${album.release_year}` : ""} · {album.tracks.length} tracks
            </span>
          </li>
        ))}
      </ul>
      {warnings.length > 0 ? (
        <ul className="border-t border-line px-3 py-2 text-xs text-amber-300/90">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type ImportResult = {
  created_albums: number;
  created_tracks: number;
  updated_tracks: number;
  skipped_tracks: number;
  album_ids: number[];
};

export function resultSummary(result: ImportResult): string {
  return `Added ${result.created_albums} albums and ${result.created_tracks} tracks. Filled ${result.updated_tracks} existing tracks. Skipped ${result.skipped_tracks} that were already scored.`;
}
