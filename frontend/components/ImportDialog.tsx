"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { SpotifyImport } from "./SpotifyImport";
import { SpreadsheetImport } from "./SpreadsheetImport";

export function ImportDialog({
  initialTab,
  notice,
  onClose,
  onImported,
}: {
  initialTab: "sheet" | "spotify";
  notice: string | null;
  onClose: () => void;
  onImported: (albumId: number | null) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [summary, setSummary] = useState<string | null>(null);
  const [albumId, setAlbumId] = useState<number | null>(null);

  function finish(nextAlbumId: number | null, nextSummary: string) {
    setAlbumId(nextAlbumId);
    setSummary(nextSummary);
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onMouseDown={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-2xl shadow-black/60"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-semibold text-zinc-50">Import</h2>
            <div className="flex rounded-md bg-raised p-0.5">
              <TabButton active={tab === "sheet"} onClick={() => setTab("sheet")}>
                Spreadsheet
              </TabButton>
              <TabButton active={tab === "spotify"} onClick={() => setTab("spotify")}>
                Spotify
              </TabButton>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {notice && !summary ? <p className="mb-3 text-sm text-amber-300">{notice}</p> : null}
          {summary ? (
            <div>
              <p className="text-sm leading-relaxed text-zinc-200">{summary}</p>
              <button
                type="button"
                onClick={() => onImported(albumId)}
                className="mt-4 h-9 rounded-md bg-zinc-100 px-4 text-sm font-semibold text-zinc-900 hover:bg-white"
              >
                Done
              </button>
            </div>
          ) : tab === "sheet" ? (
            <SpreadsheetImport onDone={finish} />
          ) : (
            <SpotifyImport onDone={finish} />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded px-2.5 text-sm ${active ? "bg-white/[0.08] text-zinc-50" : "text-zinc-500 hover:text-zinc-300"}`}
    >
      {children}
    </button>
  );
}
