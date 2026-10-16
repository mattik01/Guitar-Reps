# Guitar Reps

> ## 🚧 WORK IN PROGRESS (~10% complete) 🚧
> A personal guitar-practice assistant, early in development. Mostly a tool for
> my own practice right now — functional pieces exist but it's far from finished.
> Could grow into something bigger in the future.

A small React + TypeScript (Vite) app for guitar practice: chord cards & diagrams,
a chord editor, practice routines (chord quiz, learning new chords), a tap counter
and timer, plus a chord/progression library and a repertoire/songs section.

## Stack

React · TypeScript · Vite · react-router-dom

## Dev

```bash
npm install
npm run dev
```

### Run as a Mac app

```bash
./scripts/install-mac-app.sh   # creates ~/Applications/Guitar Reps.app (Spotlight/Launchpad/Dock)
./scripts/start.sh             # or: start the dev server if needed and open the app window
./scripts/stop.sh              # stop the background dev server
```

The app starts the dev server on localhost:5173 in the background (log:
`~/Library/Logs/GuitarReps.log`) and opens it as a Chrome app window.

## Status

Personal practice tool · work in progress · early days.
