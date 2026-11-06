import assert from "node:assert/strict";
import { buildImport, parseImportedScore, parseSheet } from "./spreadsheet.ts";

const pasted = [
  "Artist\tAlbum\tYear\t#\tTrack\tTime\tDrums\tBass Line\tGuitar\tHeaviness\tVocals\tQuality\tNotes",
  "Northline\tGlass Weather\t2014\t1\tSalt Window\t3:42\t9\t8\t7\t4\t8\t9\tOpens wide",
  "Northline\tGlass Weather\t2014\t2\tLow Orbit\t4:05\t8\t7\t9\t6\tN/A\t8\tInstrumental",
  "Red Kiln\tStatic Hymns\t2007\t1\tKiln Door\t3:07\t7\t6\t8\t9\t5\t7\t",
].join("\n");

const sheet = parseSheet(pasted);
assert.deepEqual(sheet.mapping, [
  "artist",
  "album",
  "release_year",
  "track_number",
  "title",
  "duration",
  "drums_score",
  "bass_score",
  "guitar_score",
  "heaviness_score",
  "singing_score",
  "subjective_score",
  "notes",
]);

const built = buildImport(sheet, { artist: "", album: "", releaseYear: "" });
assert.equal(built.albums.length, 2);
assert.equal(built.albums[0]?.tracks.length, 2);
assert.equal(built.albums[0]?.tracks[1]?.singing_score, null);
assert.equal(built.albums[0]?.tracks[0]?.duration_seconds, 222);
assert.equal(built.albums[0]?.release_year, 2014);
assert.equal(built.warnings.length, 0);

const csv = 'Album,Song,Drums\n"Glass, Weather","Salt ""Window""",10\n';
const csvSheet = parseSheet(csv);
assert.equal(csvSheet.rows[0]?.[0], "Glass, Weather");
assert.equal(csvSheet.rows[0]?.[1], 'Salt "Window"');
const csvBuilt = buildImport(csvSheet, { artist: "Northline", album: "", releaseYear: "2014" });
assert.equal(csvBuilt.albums[0]?.title, "Glass, Weather");
assert.equal(csvBuilt.albums[0]?.artist, "Northline");
assert.equal(csvBuilt.albums[0]?.tracks[0]?.drums_score, 10);

assert.equal(parseImportedScore("N/A"), null);
assert.equal(parseImportedScore("8.6"), 9);
assert.equal(parseImportedScore("0"), null);
assert.equal(parseImportedScore("11"), null);

console.log("spreadsheet import checks passed");
