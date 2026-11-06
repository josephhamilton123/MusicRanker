import type { ScoreField } from "./types";

export type ImportField =
  | "artist"
  | "album"
  | "release_year"
  | "track_number"
  | "title"
  | "duration"
  | ScoreField
  | "notes";

export type ColumnMapping = ImportField | "ignore";

export type ImportTrack = {
  track_number: number;
  title: string;
  duration_seconds: number | null;
  drums_score: number | null;
  bass_score: number | null;
  guitar_score: number | null;
  heaviness_score: number | null;
  singing_score: number | null;
  subjective_score: number | null;
  notes: string | null;
};

export type ImportAlbum = {
  title: string;
  artist: string;
  release_year: number;
  cover_art_url: string | null;
  tracks: ImportTrack[];
};

export type ParsedSheet = {
  headers: string[];
  rows: string[][];
  mapping: ColumnMapping[];
};

const ALIASES: Record<ImportField, string[]> = {
  artist: ["artist", "artist name", "band", "musician", "group"],
  album: ["album", "album title", "album name", "record", "release title", "lp"],
  release_year: ["release year", "year", "released", "release date"],
  track_number: ["track number", "track no", "number", "no", "num"],
  title: ["title", "track title", "track name", "track", "song", "song title", "name"],
  duration: ["duration", "duration seconds", "time", "length"],
  drums_score: ["drums", "drums score", "drum"],
  bass_score: ["bass", "bass line", "bass score"],
  guitar_score: ["guitar", "guitars", "guitar score"],
  heaviness_score: ["heaviness", "heavy", "heaviness score"],
  singing_score: ["singing", "vocals", "vocal", "vocal quality", "voice", "singing score"],
  subjective_score: ["subjective", "subjective quality", "quality", "overall", "subjective score"],
  notes: ["notes", "note", "comments", "comment", "annotation"],
};

export const IMPORT_FIELD_OPTIONS: Array<{ id: ColumnMapping; label: string }> = [
  { id: "ignore", label: "Skip" },
  { id: "artist", label: "Artist" },
  { id: "album", label: "Album" },
  { id: "release_year", label: "Year" },
  { id: "track_number", label: "Track #" },
  { id: "title", label: "Title" },
  { id: "duration", label: "Duration" },
  { id: "drums_score", label: "Drums" },
  { id: "bass_score", label: "Bass" },
  { id: "guitar_score", label: "Guitar" },
  { id: "heaviness_score", label: "Heaviness" },
  { id: "singing_score", label: "Vocals" },
  { id: "subjective_score", label: "Quality" },
  { id: "notes", label: "Notes" },
];

export function parseSheet(text: string): ParsedSheet {
  const table = parseDelimited(text, detectDelimiter(text));
  if (table.length < 2) {
    throw new Error("Include a header row and at least one track.");
  }
  const headers = table[0].map((header, index) => header.trim() || `Column ${index + 1}`);
  const width = headers.length;
  const rows = table.slice(1).map((row) => Array.from({ length: width }, (_, index) => (row[index] ?? "").trim()));
  return { headers, rows, mapping: guessMapping(headers) };
}

export function guessMapping(headers: string[]): ColumnMapping[] {
  const used = new Set<ImportField>();
  return headers.map((header) => {
    const normalized = normalizeHeader(header);
    const match = (Object.entries(ALIASES) as Array<[ImportField, string[]]>)
      .flatMap(([field, aliases]) => aliases.map((alias) => ({ field, alias })))
      .filter((candidate) => candidate.alias === normalized)
      .sort((a, b) => b.alias.length - a.alias.length)[0];
    if (!match || used.has(match.field)) {
      return "ignore";
    }
    if (match.field === "title" && used.has("album") === false && normalized === "name") {
      // A lone "name" column is the track. Album titles use a more specific header.
    }
    used.add(match.field);
    return match.field;
  });
}

export function buildImport(
  sheet: ParsedSheet,
  fallback: { artist: string; album: string; releaseYear: string },
): { albums: ImportAlbum[]; warnings: string[] } {
  const warnings: string[] = [];
  const groups = new Map<string, ImportAlbum>();
  const mappedAlbum = sheet.mapping.includes("album");
  const mappedArtist = sheet.mapping.includes("artist");

  if (!sheet.mapping.includes("title")) {
    return { albums: [], warnings: ["Map a column to Title."] };
  }

  sheet.rows.forEach((row, index) => {
    const line = index + 2;
    const value = (field: ImportField) => {
      const column = sheet.mapping.indexOf(field);
      return column === -1 ? "" : (row[column] ?? "");
    };

    const title = value("title").trim();
    if (!title) {
      if (row.some((cell) => cell.trim() !== "")) {
        warnings.push(`Row ${line} has no track title and was skipped.`);
      }
      return;
    }

    const artist = value("artist").trim() || fallback.artist.trim();
    const album = value("album").trim() || fallback.album.trim();
    if (!artist || !album) {
      warnings.push(`Row ${line} needs an artist and album, from the sheet or the fields above.`);
      return;
    }

    const yearText = value("release_year").trim() || fallback.releaseYear.trim();
    const yearMatch = yearText.match(/\d{4}/);
    const releaseYear = yearMatch ? Number(yearMatch[0]) : 0;
    if (yearText && !yearMatch) {
      warnings.push(`Row ${line} has no recognizable year, so it was left unknown.`);
    }

    const key = `${normalizeHeader(artist)}|${normalizeHeader(album)}|${releaseYear || "unknown"}`;
    const existing = groups.get(key) ?? {
      title: album,
      artist,
      release_year: releaseYear,
      cover_art_url: null,
      tracks: [],
    };

    const numberText = value("track_number").trim();
    const parsedNumber = Number.parseInt(numberText, 10);
    const durationText = value("duration");
    let duration: number | null = null;
    if (durationText.trim()) {
      duration = parseDurationLoose(durationText);
      if (duration === null) {
        warnings.push(`Row ${line} duration “${durationText}” was skipped.`);
      }
    }

    existing.tracks.push({
      track_number: Number.isInteger(parsedNumber) && parsedNumber > 0 ? parsedNumber : existing.tracks.length + 1,
      title,
      duration_seconds: duration,
      drums_score: scoreOrWarn(value("drums_score"), "Drums", line, warnings),
      bass_score: scoreOrWarn(value("bass_score"), "Bass", line, warnings),
      guitar_score: scoreOrWarn(value("guitar_score"), "Guitar", line, warnings),
      heaviness_score: scoreOrWarn(value("heaviness_score"), "Heaviness", line, warnings),
      singing_score: scoreOrWarn(value("singing_score"), "Vocals", line, warnings),
      subjective_score: scoreOrWarn(value("subjective_score"), "Quality", line, warnings),
      notes: value("notes").trim() || null,
    });
    groups.set(key, existing);
  });

  if (!mappedAlbum && !fallback.album.trim() && warnings.length === 0) {
    warnings.push("Map an Album column, or type an album title to apply to every row.");
  }
  if (!mappedArtist && !fallback.artist.trim() && warnings.length === 0) {
    warnings.push("Map an Artist column, or type an artist to apply to every row.");
  }

  const albums = [...groups.values()].map((album) => ({
    ...album,
    tracks: renumber(album.tracks),
  }));

  return { albums, warnings: warnings.slice(0, 12) };
}

function renumber(tracks: ImportTrack[]): ImportTrack[] {
  const numbers = tracks.map((track) => track.track_number);
  const unique = new Set(numbers).size === numbers.length && numbers.every((number) => number > 0);
  if (unique) {
    return [...tracks].sort((a, b) => a.track_number - b.track_number);
  }
  return tracks.map((track, index) => ({ ...track, track_number: index + 1 }));
}

function scoreOrWarn(value: string, label: string, line: number, warnings: string[]): number | null {
  if (!value.trim()) {
    return null;
  }
  const score = parseImportedScore(value);
  if (score === null && !/^(n\/?a|na|—|-|–)$/i.test(value.trim())) {
    warnings.push(`Row ${line} ${label} “${value.trim()}” is not 1–10 or N/A, so it was left blank.`);
  }
  return score;
}

export function parseImportedScore(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || /^(n\/?a|na|—|-|–|null)$/i.test(trimmed)) {
    return null;
  }
  const match = trimmed.match(/\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const score = Math.round(Number(match[0]));
  if (score < 1 || score > 10) {
    return null;
  }
  return score;
}

function parseDurationLoose(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—") {
    return null;
  }
  const clock = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (clock) {
    return Number(clock[1]) * 60 + Number(clock[2]);
  }
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds <= 72000 ? seconds : null;
  }
  const words = trimmed.match(/(\d+)\s*m(?:in(?:ute)?s?)?\s*(\d{1,2})?\s*s?/i);
  if (words) {
    return Number(words[1]) * 60 + Number(words[2] ?? 0);
  }
  return null;
}

export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((entry) => entry.trim()) ?? "";
  const candidates = ["\t", ",", ";"].map((delimiter) => ({
    delimiter,
    count: line.split(delimiter).length - 1,
  }));
  candidates.sort((a, b) => b.count - a.count);
  return candidates[0].count > 0 ? candidates[0].delimiter : ",";
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[#]/g, " number ")
    .replace(/[_.\/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
