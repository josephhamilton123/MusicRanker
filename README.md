# TrackRank

Score tracks across drums, bass, guitar, heaviness, vocals, and subjective quality. The composite is the average of the metrics that are not marked N/A, rounded to two decimals. A track with every metric N/A stays N/A.

The browser app is Next.js. The API is PHP 8.3 with Slim, and it stores albums and tracks in MySQL.

## Run

From `backend`:

```powershell
php composer.phar install
php bin/migrate.php
php composer.phar start
```

From `frontend`, in a second terminal:

```powershell
npm install
npm run dev
```

Open http://localhost:3000. The API listens on http://127.0.0.1:8080.

The browser talks only to the Next.js app. The app forwards `/api` requests to `API_URL`, which defaults to `http://127.0.0.1:8080`. On Coolify, set `API_URL` on the frontend service to the PHP API's address. That value is read when a request arrives, so changing it does not require a new frontend build.

Copy `backend/.env.example` to `backend/.env` and set the MySQL account there. That file is not committed.

If `php bin/migrate.php` reports access denied, the account can sign in but cannot create the `musicranker` database. An administrator needs to run:

```sql
CREATE DATABASE IF NOT EXISTS musicranker CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON musicranker.* TO 'musicranker'@'%';
FLUSH PRIVILEGES;
```

Then run the migration again. It creates the tables and, on an empty database, two sample albums.

## Import

Use Import in the library sidebar.

Paste from Google Sheets, including the header row, or upload a CSV. Map any column TrackRank doesn't recognize. Rows with the same artist and album become one record. Importing again fills blank scores and skips tracks that already have them.

Spotify imports albums from playlists, followed artists, top artists, or a search. Create an app at the Spotify developer dashboard, register redirect URI `http://127.0.0.1:8080/api/spotify/callback`, and set `SPOTIFY_CLIENT_ID` in `backend/.env`. Then connect from the Import dialog. Playlist songs, full albums, or an artist's studio albums can be imported. Those tracks arrive unscored.

## Scores

Cells accept 1–10. Null means N/A and drops out of the average. In the grid, type a digit, press 1 then 0 for 10, or press N, 0, or Delete for N/A. Notes save on a short delay and again when the cell loses focus. The heatmap updates from the local score immediately, then the API stores the cell.
