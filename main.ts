// Ashfall Courier's hand-in program (Node 22, standard library only).
//
// The game is the `game/` directory beside this file: plain static files that a desktop browser
// opens offline — one index.html and its ES modules, no library, no network request. This program
// does two things and nothing else: it copies `game/` and `screenshots/` into the output directory,
// and it writes `dossier.json` there, the summary the judge reads, using the vendored
// `buildDossier` from `vendor/makefun-game.ts`.
//
// Run it outside the grader by standing MAKEFUN_OUTPUT_DIR in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Serve the game locally with `node serve.ts` and open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** Where the hand-in lands: the grader's /output, or MAKEFUN_OUTPUT_DIR when run by hand. */
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** This repository's own directory, whatever the working directory happens to be. */
const repoDir = fileURLToPath(new URL('.', import.meta.url));

// The scorer's caps, as reference/gate.json states them. Only text_max_bytes shapes the dossier's
// bytes; the rest are here so a program that would ship something the scorer refuses fails loudly
// at home instead of at submission: at most four screenshots of at most 256 KiB each, at most 993
// entries and 48 MiB under game/, and every path under game/ at most 1000 bytes.
const DOSSIER_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

mkdirSync(outputDir, { recursive: true });

// The game, exactly as it sits in the repository: index.html, its modules, its vendor directory.
cpSync(join(repoDir, 'game'), join(outputDir, 'game'), { recursive: true });

// The screenshots, if this entry has any yet. The dossier reads them back out of the output, so
// they have to be copied before it is built.
const shotsDir = join(repoDir, 'screenshots');
if (existsSync(shotsDir)) {
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
  cpSync(shotsDir, join(outputDir, 'screenshots'), { recursive: true });
}

writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, DOSSIER_LIMITS));
