#!/usr/bin/env python3.10
# Join the 56M-track Spotify dataset against our Chordonomicon Spotify IDs and extract
# EVERY useful field: names, album, duration, explicit, popularity, artist stats, and the
# full audio-feature set (tempo/key/mode/danceability/energy/loudness/speechiness/
# acousticness/instrumentalness/liveness/valence). No Spotify API needed.
# The parquet's track_name/artist_name also serve as a name source (big coverage boost).
# Run: python3.10 scripts/joinAudioFeatures.py
import duckdb, json, csv, os, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARQUET = os.path.join(ROOT, 'data/raw/spotify-huge-audio-features.parquet')
CSV = os.path.join(ROOT, 'data/raw/chordonomicon_v2.csv')
IDS = os.path.join(ROOT, 'data/raw/our-ids.txt')
OUT = os.path.join(ROOT, 'data/raw/track-features.json')

print('Collecting our Spotify IDs …', flush=True)
seen = set()
with open(CSV, newline='') as f:
    r = csv.reader(f); hdr = next(r); si = hdr.index('spotify_song_id')
    for row in r:
        if len(row) > si and row[si].strip():
            seen.add(row[si].strip())
with open(IDS, 'w') as f:
    f.write('\n'.join(seen))
print(f'  {len(seen):,} unique IDs', flush=True)

con = duckdb.connect()
con.execute(f"CREATE TABLE ours AS SELECT column0 AS id FROM read_csv('{IDS}', header=false)")
print('Joining against 56M-row parquet (streaming) …', flush=True)
con.execute(f"""
  CREATE TABLE feats AS
  SELECT track_id,
    any_value(track_name)          AS title,
    any_value(artist_name)         AS artist,
    any_value(album_name)          AS album,
    any_value(album_release_date)  AS release_date,
    any_value(duration_ms)         AS duration_ms,
    any_value(explicit)            AS explicit,
    any_value(track_popularity)    AS popularity,
    any_value(artist_popularity)   AS artist_popularity,
    any_value(artist_followers)    AS artist_followers,
    any_value(tempo)               AS tempo,
    any_value(key)                 AS key,
    any_value(mode)                AS mode,
    any_value(danceability)        AS danceability,
    any_value(energy)              AS energy,
    any_value(loudness)            AS loudness,
    any_value(speechiness)         AS speechiness,
    any_value(acousticness)        AS acousticness,
    any_value(instrumentalness)    AS instrumentalness,
    any_value(liveness)            AS liveness,
    any_value(valence)             AS valence
  FROM read_parquet('{PARQUET}')
  WHERE track_id IN (SELECT id FROM ours)
  GROUP BY track_id
""")
n_ours = con.execute("SELECT COUNT(*) FROM ours").fetchone()[0]
n_match = con.execute("SELECT COUNT(*) FROM feats").fetchone()[0]
print(f'\nCoverage: {n_match:,} / {n_ours:,} = {100*n_match/n_ours:.1f}% of our IDs found in the dataset', flush=True)

cols = [d[0] for d in con.execute("SELECT * FROM feats LIMIT 0").description]
def r3(x):
    if isinstance(x, float): return round(x, 3)
    if isinstance(x, (datetime.date, datetime.datetime)): return x.isoformat()  # release_date
    return x
out = {}
for row in con.execute("SELECT * FROM feats").fetchall():
    d = dict(zip(cols, row))
    tid = d.pop('track_id')
    out[tid] = {k: r3(v) for k, v in d.items()}
json.dump(out, open(OUT, 'w'))
print(f'Wrote {len(out):,} entries → {OUT} ({os.path.getsize(OUT)/1024/1024:.1f} MB)', flush=True)
