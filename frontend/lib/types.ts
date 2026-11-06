export type ScoreField =
  | "drums_score"
  | "bass_score"
  | "guitar_score"
  | "heaviness_score"
  | "singing_score"
  | "subjective_score";

export type AlbumSummary = {
  track_count: number;
  album_average: number | null;
  heaviest_song: {
    id: number;
    title: string;
    heaviness_score: number;
  } | null;
  standout_instrument: {
    metric: string;
    label: string;
    average: number;
  } | null;
};

export type CatalogTrack = {
  id: number;
  title: string;
  track_number: number;
};

export type Album = {
  id: number;
  title: string;
  release_year: number;
  artist: string;
  cover_art_url: string | null;
  created_at?: string;
  updated_at?: string;
  summary: AlbumSummary;
  tracks?: CatalogTrack[];
};

export type Track = {
  id: number;
  album_id: number;
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
  composite_score: number | null;
  spotify_id?: string | null;
  spotify_url?: string | null;
};

export type PlayTrackInfo = {
  id: number;
  album_id: number;
  track_number: number;
  title: string;
  artist: string;
  album: string;
  cover_art_url: string | null;
  duration_seconds: number | null;
  spotify_id: string | null;
  spotify_url: string | null;
  embed_url: string | null;
};

export type TracksResponse = {
  album: Album;
  tracks: Track[];
  summary: AlbumSummary;
};

export type TrackDraft = {
  title: string;
  duration_seconds: number | null;
  track_number?: number;
};

export type AlbumInput = {
  title: string;
  artist: string;
  release_year: number;
  cover_art_url: string | null;
};
