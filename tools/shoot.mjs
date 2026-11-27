// Take the screenshots: serve the entry over a local socket, open a staged scene in headless
// Chromium, and write the PNG when window.__shotReady says the frame is final. Nothing but
// localhost is contacted.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { extname, join, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

const root = resolve(process.argv[2] ?? '.');
const shots = (process.argv[3] ?? 'cover').split(',');
const outDir = resolve(process.argv[4] ?? 'shots-raw');
const width = Number(process.argv[5] ?? 1280);
const height = Number(process.argv[6] ?? 720);
const chrome =
  process.env.CHROME_PATH ?? '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell';

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = join(root, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') path = join(root, 'game/index.html');
    if (!existsSync(path) && existsSync(join(path, 'index.html'))) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    res.writeHead(404);
    res.end(String(error));
  }
});

await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
mkdirSync(outDir, { recursive: true });

for (const shot of shots) {
  const file = join(outDir, `${shot}.png`);
  const url = `http://127.0.0.1:${port}/game/index.html?shot=${encodeURIComponent(shot)}`;
  const args = [
    '--headless',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--screenshot=${file}`,
    '--virtual-time-budget=25000',
    '--dump-dom',
    url,
  ];
  const started = Date.now();
  const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const code = await new Promise((ok) => child.on('exit', ok));
  const ms = Date.now() - started;
  console.log(`${shot}: exit ${code} in ${ms} ms -> ${file}`);
  const debugMatch = stderr.match(/DEBUG (\{.*)/s) ?? stdout.match(/DEBUG (\{.*)/s);
  if (debugMatch) console.log('  state:', debugMatch[1].split('\n')[0]);
  const noise = stderr
    .split('\n')
    .filter((line) => /Uncaught|TypeError|ReferenceError|SyntaxError|CONSOLE/.test(line));
  if (noise.length) console.log('  stderr:', noise.slice(0, 8).join('\n  '));
}

server.close();
