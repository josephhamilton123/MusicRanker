"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type Row,
  type SortingState,
  type Table,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { formatDuration, parseDuration } from "@/lib/format";
import {
  SCORE_FIELDS,
  SCORE_LABELS,
  formatComposite,
  formatScore,
  scoreClass,
  scoreSwatchClass,
  scoreTextClass,
  withComposite,
} from "@/lib/score";
import type { ScoreField, Track, TrackDraft, TracksResponse } from "@/lib/types";
import type { SaveState } from "./AlbumHeader";
import { ScoreCell } from "./ScoreCell";

const columnHelper = createColumnHelper<Track>();

const legend = [
  { label: "9–10", score: 10 },
  { label: "7–8.9", score: 8 },
  { label: "5–6.9", score: 6 },
  { label: "1–4.9", score: 3 },
  { label: "N/A", score: null },
] as const;

export function RatingSpreadsheet({
  albumId,
  tracks,
  focusTrackId = null,
  activeTrackId = null,
  loadingTrackId = null,
  onPlayTrack,
  onSaveState,
}: {
  albumId: number;
  tracks: Track[];
  focusTrackId?: number | null;
  activeTrackId?: number | null;
  loadingTrackId?: number | null;
  onPlayTrack?: (track: Track) => void;
  onSaveState: (state: SaveState) => void;
}) {
  const queryClient = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([{ id: "track_number", desc: false }]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const saveSeq = useRef<Record<number, number>>({});
  const playTrackRef = useRef(onPlayTrack);
  playTrackRef.current = onPlayTrack;
  const pendingDigit = useRef<{ id: number; field: ScoreField; timer: number } | null>(null);
  const tableRef = useRef<Table<Track> | null>(null);
  const scoreKeyRef = useRef<
    (event: React.KeyboardEvent<HTMLButtonElement>, track: Track, field: ScoreField, colIndex: number) => void
  >(() => undefined);
  const actionsRef = useRef<{
    patch: (id: number, body: Partial<Track>) => void;
    move: (id: number, direction: -1 | 1) => void;
    place: (id: number, position: number) => void;
    remove: (track: Track) => void;
    commitScore: (track: Track, field: ScoreField, raw: string) => void;
  }>({
    patch: () => undefined,
    move: () => undefined,
    place: () => undefined,
    remove: () => undefined,
    commitScore: () => undefined,
  });

  const mutation = useMutation({
    mutationFn: async (input: { id: number; body: Partial<Track>; seq: number }) => {
      const updated = await api<Track>(`/api/tracks/${input.id}`, {
        method: "PATCH",
        body: JSON.stringify(input.body),
      });
      return { updated, seq: input.seq };
    },
    onMutate: async (input) => {
      onSaveState("saving");
      await queryClient.cancelQueries({ queryKey: ["tracks", albumId] });
      const previous = queryClient.getQueryData<TracksResponse>(["tracks", albumId]);
      queryClient.setQueryData<TracksResponse>(["tracks", albumId], (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          tracks: current.tracks.map((track) =>
            track.id === input.id ? withComposite({ ...track, ...input.body }) : track,
          ),
        };
      });
      return { previous };
    },
    onSuccess: ({ updated, seq }) => {
      if (saveSeq.current[updated.id] !== seq) {
        return;
      }
      queryClient.setQueryData<TracksResponse>(["tracks", albumId], (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          tracks: current.tracks.map((track) => (track.id === updated.id ? updated : track)),
        };
      });
      onSaveState("saved");
      void queryClient.invalidateQueries({ queryKey: ["albums"] });
    },
    onError: (_error, input, context) => {
      if (saveSeq.current[input.id] !== input.seq) {
        return;
      }
      if (context?.previous) {
        queryClient.setQueryData(["tracks", albumId], context.previous);
      }
      onSaveState("error");
    },
  });

  function patch(id: number, body: Partial<Track>) {
    const seq = (saveSeq.current[id] ?? 0) + 1;
    saveSeq.current[id] = seq;
    mutation.mutate({ id, body, seq });
  }

  async function reorder(ids: number[]) {
    onSaveState("saving");
    const previous = queryClient.getQueryData<TracksResponse>(["tracks", albumId]);
    queryClient.setQueryData<TracksResponse>(["tracks", albumId], (current) => {
      if (!current) {
        return current;
      }
      const byId = new Map(current.tracks.map((track) => [track.id, track]));
      return {
        ...current,
        tracks: ids.flatMap((id, index) => {
          const track = byId.get(id);
          return track ? [{ ...track, track_number: index + 1 }] : [];
        }),
      };
    });
    try {
      const result = await api<{ tracks: Track[] }>(`/api/albums/${albumId}/tracks/order`, {
        method: "PUT",
        body: JSON.stringify({ track_ids: ids }),
      });
      queryClient.setQueryData<TracksResponse>(["tracks", albumId], (current) =>
        current ? { ...current, tracks: result.tracks } : current,
      );
      onSaveState("saved");
      void queryClient.invalidateQueries({ queryKey: ["albums"] });
    } catch (error) {
      if (previous) {
        queryClient.setQueryData(["tracks", albumId], previous);
      }
      onSaveState("error");
      setAddError(error instanceof Error ? error.message : "Couldn't reorder tracks.");
    }
  }

  function orderedIds(): number[] {
    return [...tracks].sort((a, b) => a.track_number - b.track_number || a.id - b.id).map((track) => track.id);
  }

  function move(trackId: number, direction: -1 | 1) {
    const ids = orderedIds();
    const index = ids.indexOf(trackId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) {
      return;
    }
    const current = ids[index];
    const swapped = ids[target];
    if (current === undefined || swapped === undefined) {
      return;
    }
    ids[index] = swapped;
    ids[target] = current;
    void reorder(ids);
  }

  function place(trackId: number, position: number) {
    const ids = orderedIds();
    const index = ids.indexOf(trackId);
    const target = Math.min(ids.length, Math.max(1, position)) - 1;
    if (index < 0 || index === target) {
      return;
    }
    const [id] = ids.splice(index, 1);
    if (id === undefined) {
      return;
    }
    ids.splice(target, 0, id);
    void reorder(ids);
  }

  function commitScore(track: Track, field: ScoreField, raw: string) {
    const trimmed = raw.trim();
    const next = trimmed === "" || /^(n\/?a|na|—|-)$/i.test(trimmed) ? null : Number(trimmed);
    if (next !== null && (!Number.isInteger(next) || next < 1 || next > 10)) {
      setAddError("Scores are whole numbers from 1 to 10, or blank for N/A.");
      return;
    }
    setAddError(null);
    if (track[field] !== next) {
      patch(track.id, { [field]: next });
    }
  }

  async function remove(track: Track) {
    if (!window.confirm(`Remove “${track.title}” from this album?`)) {
      return;
    }
    onSaveState("saving");
    const previous = queryClient.getQueryData<TracksResponse>(["tracks", albumId]);
    queryClient.setQueryData<TracksResponse>(["tracks", albumId], (current) => {
      if (!current) {
        return current;
      }
      const remaining = current.tracks
        .filter((item) => item.id !== track.id)
        .sort((a, b) => a.track_number - b.track_number || a.id - b.id)
        .map((item, index) => ({ ...item, track_number: index + 1 }));
      return { ...current, tracks: remaining };
    });
    try {
      await api<void>(`/api/tracks/${track.id}`, { method: "DELETE" });
      onSaveState("saved");
      void queryClient.invalidateQueries({ queryKey: ["albums"] });
    } catch (error) {
      if (previous) {
        queryClient.setQueryData(["tracks", albumId], previous);
      }
      onSaveState("error");
      setAddError(error instanceof Error ? error.message : "Couldn't remove the track.");
    }
  }

  async function addTracks(drafts: TrackDraft[]) {
    setAddError(null);
    onSaveState("saving");
    try {
      await api(`/api/albums/${albumId}/tracks`, {
        method: "POST",
        body: JSON.stringify({ tracks: drafts }),
      });
      await queryClient.invalidateQueries({ queryKey: ["tracks", albumId] });
      await queryClient.invalidateQueries({ queryKey: ["albums"] });
      onSaveState("saved");
    } catch (error) {
      onSaveState("error");
      setAddError(error instanceof Error ? error.message : "Couldn't add tracks.");
      throw error;
    }
  }

  actionsRef.current = { patch, move, place, remove, commitScore };

  function clearPending() {
    if (pendingDigit.current) {
      window.clearTimeout(pendingDigit.current.timer);
      pendingDigit.current = null;
    }
  }

  function focusAt(rowIndex: number, colIndex: number) {
    const rows = tableRef.current?.getRowModel().rows ?? [];
    if (rowIndex < 0 || rowIndex >= rows.length || colIndex < 0 || colIndex >= SCORE_FIELDS.length) {
      return;
    }
    const row = rows[rowIndex];
    const field = SCORE_FIELDS[colIndex];
    if (!row || !field) {
      return;
    }
    document.getElementById(`score-${row.original.id}-${field}`)?.focus();
  }

  function onScoreKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, track: Track, field: ScoreField, colIndex: number) {
    const rows = tableRef.current?.getRowModel().rows ?? [];
    const rowIndex = rows.findIndex((row) => row.original.id === track.id);
    const key = event.key;

    if (key === "ArrowRight" || (key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      if (colIndex === SCORE_FIELDS.length - 1) {
        focusAt(rowIndex + 1, 0);
      } else {
        focusAt(rowIndex, colIndex + 1);
      }
      return;
    }
    if (key === "ArrowLeft" || (key === "Tab" && event.shiftKey)) {
      event.preventDefault();
      if (colIndex === 0) {
        focusAt(rowIndex - 1, SCORE_FIELDS.length - 1);
      } else {
        focusAt(rowIndex, colIndex - 1);
      }
      return;
    }
    if (key === "ArrowDown" || key === "Enter") {
      event.preventDefault();
      focusAt(rowIndex + 1, colIndex);
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      focusAt(rowIndex - 1, colIndex);
      return;
    }
    if (key === "0") {
      event.preventDefault();
      const pending = pendingDigit.current;
      if (pending && pending.id === track.id && pending.field === field) {
        clearPending();
        actionsRef.current.patch(track.id, { [field]: 10 });
        return;
      }
      clearPending();
      actionsRef.current.patch(track.id, { [field]: null });
      return;
    }
    if (key === "n" || key === "N" || key === "Backspace" || key === "Delete") {
      event.preventDefault();
      clearPending();
      actionsRef.current.patch(track.id, { [field]: null });
      return;
    }
    if (key >= "1" && key <= "9") {
      event.preventDefault();
      clearPending();
      const score = Number(key);
      actionsRef.current.patch(track.id, { [field]: score });
      if (score === 1) {
        const timer = window.setTimeout(() => {
          pendingDigit.current = null;
        }, 450);
        pendingDigit.current = { id: track.id, field, timer };
      }
    }
  }

  scoreKeyRef.current = onScoreKeyDown;

  const canReorder =
    globalFilter.trim() === "" && sorting.length === 1 && sorting[0]?.id === "track_number" && sorting[0]?.desc === false;

  const columns = useMemo(
    () => [
      columnHelper.accessor("track_number", {
        header: ({ column }) => <SortHeader column={column} label="#" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <TrackNumberCell
              track={row.original}
              editable={canReorder}
              onPlace={(id, position) => actionsRef.current.place(id, position)}
            />
            {canReorder ? (
              <span className="flex flex-col opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  aria-label={`Move ${row.original.title} up`}
                  className="rounded text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-30"
                  disabled={row.original.track_number === 1}
                  onClick={() => actionsRef.current.move(row.original.id, -1)}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${row.original.title} down`}
                  className="rounded text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
                  onClick={() => actionsRef.current.move(row.original.id, 1)}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </span>
            ) : null}
          </div>
        ),
      }),
      columnHelper.accessor("title", {
        header: ({ column }) => <SortHeader column={column} label="Title" />,
        cell: ({ row }) => {
          const track = row.original;
          const isCurrent = activeTrackId === track.id;
          const isThisLoading = loadingTrackId === track.id;
          return (
            <div className="flex items-center gap-1.5">
              {playTrackRef.current ? (
                <button
                  type="button"
                  onClick={() => playTrackRef.current?.(track)}
                  title={isCurrent ? "Active track" : `Play ${track.title}`}
                  aria-label={isCurrent ? `Active track ${track.title}` : `Play ${track.title}`}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${
                    isCurrent
                      ? "bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40"
                      : "text-zinc-500 hover:bg-white/10 hover:text-zinc-100"
                  }`}
                >
                  {isThisLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-300" />
                  ) : isCurrent ? (
                    <span className="flex h-3 w-3 items-end justify-center gap-0.5">
                      <span className="h-2 w-0.5 animate-pulse bg-emerald-400" />
                      <span className="h-3 w-0.5 animate-pulse bg-emerald-400 delay-75" />
                      <span className="h-1.5 w-0.5 animate-pulse bg-emerald-400 delay-150" />
                    </span>
                  ) : (
                    <Play className="h-3.5 w-3.5 translate-x-0.5 fill-current" />
                  )}
                </button>
              ) : null}
              <input
                aria-label={`Title for track ${row.original.track_number}`}
                defaultValue={row.original.title}
                key={`${row.original.id}-${row.original.title}`}
                onBlur={(event) => {
                  const next = event.target.value.trim();
                  if (next && next !== row.original.title) {
                    actionsRef.current.patch(row.original.id, { title: next });
                  }
                }}
                className="h-9 w-full min-w-40 rounded-md border border-transparent bg-transparent px-2 font-semibold text-zinc-100 transition-colors hover:border-line focus:border-white/20 focus:bg-raised"
              />
            </div>
          );
        },
      }),
      columnHelper.accessor("duration_seconds", {
        header: "Time",
        enableSorting: false,
        cell: ({ row }) => (
          <input
            aria-label={`Duration for ${row.original.title}`}
            defaultValue={row.original.duration_seconds === null ? "" : formatDuration(row.original.duration_seconds)}
            key={`${row.original.id}-${row.original.duration_seconds ?? "x"}`}
            placeholder="m:ss"
            onBlur={(event) => {
              try {
                const next = parseDuration(event.target.value);
                if (next !== row.original.duration_seconds) {
                  actionsRef.current.patch(row.original.id, { duration_seconds: next });
                }
              } catch (error) {
                event.target.value =
                  row.original.duration_seconds === null ? "" : formatDuration(row.original.duration_seconds);
                setAddError(error instanceof Error ? error.message : "Invalid duration.");
              }
            }}
            className="h-9 w-16 rounded-md border border-transparent bg-transparent px-2 text-center text-sm tabular-nums text-zinc-400 placeholder:text-zinc-700 transition-colors hover:border-line focus:border-white/20 focus:bg-raised focus:text-zinc-100"
          />
        ),
      }),
      ...SCORE_FIELDS.map((field, colIndex) =>
        columnHelper.accessor(field, {
          header: ({ column }) => <SortHeader column={column} label={SCORE_LABELS[field]} />,
          sortingFn: nullsLast,
          sortDescFirst: true,
          cell: ({ row, getValue }) => {
            const score = getValue();
            return (
              <ScoreFieldCell
                track={row.original}
                field={field}
                score={score}
                colIndex={colIndex}
                onKeyDown={(event, scoreTrack, scoreField, columnIndex) =>
                  scoreKeyRef.current(event, scoreTrack, scoreField, columnIndex)
                }
                onCommit={(scoreTrack, scoreField, raw) => actionsRef.current.commitScore(scoreTrack, scoreField, raw)}
              />
            );
          },
        }),
      ),
      columnHelper.accessor("composite_score", {
        header: ({ column }) => <SortHeader column={column} label="Composite" />,
        sortingFn: nullsLast,
        sortDescFirst: true,
        cell: ({ getValue }) => <ScoreCell score={getValue()} display={formatComposite(getValue())} />,
      }),
      columnHelper.accessor("notes", {
        header: "Notes",
        enableSorting: false,
        cell: ({ row }) => (
          <NotesCell
            notes={row.original.notes}
            label={`Notes for ${row.original.title}`}
            onSave={(notes) => actionsRef.current.patch(row.original.id, { notes })}
          />
        ),
      }),
      columnHelper.display({
        id: "remove",
        header: "",
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={`Remove ${row.original.title}`}
            onClick={() => actionsRef.current.remove(row.original)}
            className="rounded-md p-2 text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:bg-rose-500/10 hover:text-rose-300 focus-visible:opacity-100"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ),
      }),
    ],
    [canReorder, activeTrackId, loadingTrackId],
  );

  // TanStack Table returns functions the React Compiler cannot memoize safely.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: tracks,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      const query = String(filterValue).trim().toLowerCase();
      return query === "" || row.original.title.toLowerCase().includes(query);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  tableRef.current = table;

  useEffect(() => {
    if (focusTrackId === null) {
      return;
    }
    document.querySelector(`[data-track-id="${focusTrackId}"]`)?.scrollIntoView({ block: "center" });
  }, [focusTrackId, tracks]);

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            aria-label="Filter tracks by title"
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder="Filter tracks"
            className="h-8 w-full rounded-md border border-line bg-raised pr-3 pl-8 text-sm text-zinc-100 placeholder:text-zinc-500 transition-colors focus:border-white/20 sm:w-64"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {legend.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1.5 text-xs tabular-nums text-zinc-500">
              <span className={`h-2 w-2 rounded-full ${scoreSwatchClass(item.score)}`} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-sm">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="sticky top-0 border-b border-line bg-surface px-2 py-2.5 text-left text-xs font-semibold whitespace-nowrap text-zinc-500 first:pl-4 last:pr-4"
                  >
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-zinc-500">
                  No tracks match. Add one below, or clear the filter.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  data-track-id={row.original.id}
                  className={`group align-middle transition-colors hover:bg-white/[0.02] ${
                    row.original.id === focusTrackId ? "bg-white/[0.05]" : ""
                  }`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="border-b border-white/[0.04] px-1.5 py-1.5 first:pl-4 last:pr-4">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="px-4 pt-3 text-xs leading-relaxed text-zinc-500">
        <Kbd>1</Kbd>–<Kbd>9</Kbd> to score, <Kbd>1</Kbd> <Kbd>0</Kbd> for 10, <Kbd>N</Kbd> or <Kbd>Del</Kbd> for N/A.
        Arrows, <Kbd>Tab</Kbd>, and <Kbd>Enter</Kbd> move between cells. Composite averages the scores that aren&apos;t
        N/A.
      </p>
      {addError ? <p className="px-4 pt-2 text-sm text-rose-300">{addError}</p> : null}
      <AddTracks onAdd={addTracks} />
    </section>
  );
}

function SortHeader<T>({ column, label }: { column: Column<Track, T>; label: string }) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      className={`group/sort inline-flex items-center gap-1 transition-colors hover:text-zinc-200 ${sorted ? "text-zinc-200" : ""}`}
      onClick={column.getToggleSortingHandler()}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="h-3 w-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover/sort:opacity-60" />
      )}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-raised px-1 py-px text-[11px] font-semibold text-zinc-300">
      {children}
    </kbd>
  );
}

function nullsLast(rowA: Row<Track>, rowB: Row<Track>, columnId: string): number {
  const left = rowA.getValue<number | null>(columnId);
  const right = rowB.getValue<number | null>(columnId);
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

function NotesCell({
  notes,
  label,
  onSave,
}: {
  notes: string | null;
  label: string;
  onSave: (notes: string) => void;
}) {
  const [value, setValue] = useState(notes ?? "");
  const focused = useRef(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!focused.current) {
      setValue(notes ?? "");
    }
  }, [notes]);

  function schedule(next: string) {
    if (timer.current) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => onSave(next), 500);
  }

  return (
    <textarea
      aria-label={label}
      value={value}
      rows={1}
      placeholder="Add a note"
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => {
        setValue(event.target.value);
        schedule(event.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        if (timer.current) {
          window.clearTimeout(timer.current);
        }
        if ((notes ?? "") !== value) {
          onSave(value);
        }
      }}
      className="block field-sizing-content min-h-9 w-64 resize-none rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm leading-snug text-zinc-300 placeholder:text-zinc-700 transition-colors hover:border-line focus:border-white/20 focus:bg-raised focus:text-zinc-100"
    />
  );
}

const fieldClass =
  "mt-1.5 h-9 w-full rounded-md border border-line bg-raised px-3 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-white/20";

function AddTracks({ onAdd }: { onAdd: (tracks: TrackDraft[]) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("");
  const [batch, setBatch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(drafts: TrackDraft[], clear: () => void) {
    setPending(true);
    setError(null);
    try {
      await onAdd(drafts);
      clear();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't add tracks.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 grid items-start gap-6 border-t border-line px-4 py-4 lg:grid-cols-2">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!title.trim()) {
            setError("A track needs a title.");
            return;
          }
          let seconds: number | null = null;
          try {
            seconds = parseDuration(duration);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Invalid duration.");
            return;
          }
          void submit([{ title: title.trim(), duration_seconds: seconds }], () => {
            setTitle("");
            setDuration("");
          });
        }}
      >
        <label className="min-w-48 flex-1 text-xs font-medium text-zinc-400">
          Add a track
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Track title"
            className={fieldClass}
          />
        </label>
        <label className="w-24 text-xs font-medium text-zinc-400">
          Time
          <input
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            placeholder="3:42"
            className={`${fieldClass} tabular-nums`}
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-zinc-100 px-3.5 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Add
        </button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const drafts = parseTrackLines(batch);
            void submit(drafts, () => setBatch(""));
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Couldn't read that list.");
          }
        }}
      >
        <label className="block text-xs font-medium text-zinc-400">
          Batch import, one per line
          <textarea
            value={batch}
            onChange={(event) => setBatch(event.target.value)}
            rows={3}
            placeholder={"Salt Window | 3:42\nLow Orbit | 4:05"}
            className="mt-1.5 w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-white/20"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/[0.05] hover:text-zinc-100 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          Import
        </button>
      </form>
      {error ? <p className="text-sm text-rose-300 lg:col-span-2">{error}</p> : null}
    </div>
  );
}

function parseTrackLines(text: string): TrackDraft[] {
  const tracks: TrackDraft[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [titlePart, durationPart] = trimmed.split("|").map((part) => part.trim());
    if (!titlePart) {
      throw new Error("Each line needs a title.");
    }
    tracks.push({
      title: titlePart,
      duration_seconds: durationPart ? parseDuration(durationPart) : null,
    });
  }
  if (tracks.length === 0) {
    throw new Error("Add at least one track.");
  }
  return tracks;
}

function TrackNumberCell({
  track,
  editable,
  onPlace,
}: {
  track: Track;
  editable: boolean;
  onPlace: (id: number, position: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(track.track_number));
  const cancelRef = useRef(false);

  if (!editable) {
    return <span className="w-5 text-center text-xs tabular-nums text-zinc-500">{track.track_number}</span>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(String(track.track_number));
          setEditing(true);
        }}
        aria-label={`Track number ${track.track_number}. Click to edit.`}
        className="w-6 rounded py-1 text-center text-xs tabular-nums text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
      >
        {track.track_number}
      </button>
    );
  }

  return (
    <input
      autoFocus
      inputMode="numeric"
      value={draft}
      aria-label={`Track number for ${track.title}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const cancelled = cancelRef.current;
        cancelRef.current = false;
        setEditing(false);
        if (cancelled) {
          return;
        }
        const next = Number(draft);
        if (Number.isInteger(next) && next >= 1 && next !== track.track_number) {
          onPlace(track.id, next);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelRef.current = true;
          event.currentTarget.blur();
        }
      }}
      className="h-7 w-8 rounded border border-white/20 bg-raised text-center text-xs tabular-nums text-zinc-100 outline-none"
    />
  );
}

function ScoreFieldCell({
  track,
  field,
  score,
  colIndex,
  onKeyDown,
  onCommit,
}: {
  track: Track;
  field: ScoreField;
  score: number | null;
  colIndex: number;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>, track: Track, field: ScoreField, colIndex: number) => void;
  onCommit: (track: Track, field: ScoreField, raw: string) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        ref={buttonRef}
        id={`score-${track.id}-${field}`}
        type="button"
        className="block w-full min-w-14 rounded-[5px] transition-[filter] hover:brightness-125 focus-visible:outline-offset-0"
        aria-label={`${SCORE_LABELS[field]} for ${track.title}: ${score ?? "not applicable"}`}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => onKeyDown(event, track, field, colIndex)}
      >
        <ScoreCell score={score} display={formatScore(score)} />
      </button>
      {open ? (
        <ScoreSliderPopover
          anchorRef={buttonRef}
          label={SCORE_LABELS[field]}
          title={track.title}
          value={score}
          onChange={(next) => onCommit(track, field, next === null ? "" : String(next))}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ScoreSliderPopover({
  anchorRef,
  label,
  title,
  value,
  onChange,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  label: string;
  title: string;
  value: number | null;
  onChange: (next: number | null) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<number | null>(value);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const latest = useRef<number | null>(value);
  const saved = useRef<number | null>(value);
  const dragging = useRef(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const publish = useCallback((next: number | null) => {
    latest.current = next;
    setDraft(next);
    if (saved.current === next) {
      return;
    }
    saved.current = next;
    onChangeRef.current(next);
  }, []);

  const close = useCallback(
    (save: boolean) => {
      dragging.current = false;
      if (save) {
        publish(latest.current);
      }
      onClose();
    },
    [onClose, publish],
  );

  useLayoutEffect(() => {
    function place() {
      const anchor = anchorRef.current;
      if (!anchor) {
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const width = 252;
      const height = panelRef.current?.offsetHeight ?? 176;
      let left = rect.left + rect.width / 2 - width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = rect.bottom + 8;
      if (top + height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - height - 8);
      }
      setPosition({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  function preview(next: number | null) {
    latest.current = next;
    setDraft(next);
  }

  useEffect(() => {
    return () => {
      if (dragging.current) {
        onChangeRef.current(latest.current);
      }
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-40" onMouseDown={() => close(true)}>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={`${label} score`}
        style={{ top: position.top, left: position.left, width: 252 }}
        className="fixed z-50 rounded-lg border border-line bg-surface p-3"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-zinc-500">{label}</p>
            <p className="truncate text-sm text-zinc-300">{title}</p>
          </div>
          <p className={`text-2xl font-semibold tabular-nums ${scoreTextClass(draft)}`}>{draft ?? "N/A"}</p>
        </div>
        <input
          autoFocus
          type="range"
          min={1}
          max={10}
          step={1}
          value={draft ?? 5}
          aria-label={`${label} from 1 to 10`}
          onPointerDown={() => {
            dragging.current = true;
            const finish = () => {
              window.removeEventListener("pointerup", finish);
              window.removeEventListener("pointercancel", finish);
              if (!dragging.current) {
                return;
              }
              dragging.current = false;
              publish(latest.current);
            };
            window.addEventListener("pointerup", finish);
            window.addEventListener("pointercancel", finish);
          }}
          onChange={(event) => preview(Number(event.target.value))}
          onKeyUp={(event) => {
            if (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") {
              publish(latest.current);
            }
          }}
          className="mt-3 h-8 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:h-7 [&::-moz-range-thumb]:w-7 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-zinc-100 [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-zinc-700 [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-zinc-700 [&::-webkit-slider-thumb]:-mt-2.5 [&::-webkit-slider-thumb]:h-7 [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-zinc-100"
        />
        <div className="mt-1 grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, index) => index + 1).map((number) => (
            <button
              key={number}
              type="button"
              onClick={() => publish(number)}
              className={`h-8 rounded text-xs font-semibold tabular-nums ${
                draft === number ? scoreClass(number) : "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-100"
              }`}
            >
              {number}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => publish(null)}
          className={`mt-2 h-8 w-full rounded text-xs font-semibold ${
            draft === null ? "bg-zinc-800 text-zinc-200" : "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
          }`}
        >
          N/A
        </button>
      </div>
    </div>,
    document.body,
  );
}
