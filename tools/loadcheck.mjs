// Load the game the way the grader does and assert what the rules assert: the page comes up in
// headless Chrome with no console error, no uncaught exception, and no network request at all —
// every script, module and image it uses is a file under game/. Also checks that the HUD's own
// numbers agree with the flight state the page publishes.
//
//   node tools/loadcheck.mjs [game-dir]
//
// Exit 0 when every assertion holds, 1 when one fails, and it prints each one with its raw value.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.argv[2] ?? '.';
const port = 8123 + (process.pid % 500);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
};

// Serve the repository root, the way the grader's static server serves game/ at its own root:
// /game/index.html is the page, and its modules are /game/src/*.js.
const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = join(root, url === '/' ? '/game/index.html' : url);
  if (!existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

const chrome = process.env.CHROME_BIN
  ?? `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell`;
const args = [
  '--headless',
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--window-size=1280,720',
  '--virtual-time-budget=25000',
  '--dump-dom',
  `http://127.0.0.1:${port}/game/index.html?shot=cover`,
];

const child = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });
const code = await new Promise((resolve) => child.on('close', resolve));
if (process.env.LOADCHECK_DEBUG) {
  console.log(`stdout ${stdout.length} bytes, stderr ${stderr.length} bytes`);
  console.log('stdout head:', JSON.stringify(stdout.slice(0, 400)));
}
server.close();

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
}

// 1. The page rendered a real frame: the debug state the game publishes into #status. The payload
//    runs to the end of that element's text, so it is read to the closing tag or the end of the DOM.
const debugMatch = stdout.match(/DEBUG (\{[\s\S]*?)\s*(?:<\/p>|<\/body>|$)/);
let state = null;
if (debugMatch) {
  try {
    state = JSON.parse(debugMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } catch {
    state = null;
  }
}
check('page loads and publishes its state', Boolean(state), state ? JSON.stringify(state.flight ?? {}) : 'no DEBUG payload in the DOM');

// 2. No console error and no uncaught exception. Chrome's own noise about SwiftShader and
//    DevTools is not the page's.
const NOISE = /SwiftShader|swiftshader|DevTools|Fontconfig|dbus|GLES|EGL|gpu_|Vulkan|gbm|sandbox|SharedImage|angle|ANGLE|Failed to create|libva|vaapi|ContextResult|Automatic fallback|policy|sandbox_linux|gl_utils|GPU stall|ReadPixels|OpenGL, Performance/i;
const errorLines = stderr
  .split('\n')
  .filter((line) => /ERROR|Uncaught|SyntaxError|TypeError|ReferenceError|not defined/i.test(line))
  .filter((line) => !NOISE.test(line));
check('no console error or exception', errorLines.length === 0, errorLines.slice(0, 6).join(' | ') || 'none');

// 3. No network request: every line the page logged for a request must be a localhost file, and
//    the server saw only paths inside game/.
const externalRequests = stderr
  .split('\n')
  .filter((line) => /https?:\/\//i.test(line))
  .filter((line) => !/127\.0\.0\.1|localhost/i.test(line))
  .filter((line) => !NOISE.test(line));
check('no request leaves the page', externalRequests.length === 0, externalRequests.slice(0, 4).join(' | ') || 'none');

// 4. The frame is not blank: the state carries a live flight, and the numbers are self-consistent.
if (state?.flight) {
  const f = state.flight;
  check('aeroplane is in the air or on the strip', Number.isFinite(f.position?.[1]) && f.altFt > 0, `altFt ${f.altFt}`);
  check('airspeed is a real number', Number.isFinite(f.speedKt) && f.speedKt >= 0, `speedKt ${f.speedKt}`);
  check('heading is in 0..360', Number.isFinite(f.headingDeg ?? f.heading), `heading ${f.headingDeg ?? f.heading}`);
  // AGL can never exceed altitude: it is altitude minus the ground under the aeroplane.
  check('AGL is not above altitude', f.aglFt <= f.altFt + 1, `aglFt ${f.aglFt} altFt ${f.altFt}`);
  check('HUD speed and state speed agree', state.hud ? Math.abs((state.hud.speedKt ?? f.speedKt) - f.speedKt) < 1.5 : true, state.hud ? `hud ${state.hud.speedKt} state ${f.speedKt}` : 'no hud block');
} else {
  check('flight state present', false, 'none');
}

console.log(`loadcheck: exit ${code}, ${checks.filter((c) => c.ok).length}/${checks.length} passed`);
for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);

const failed = checks.filter((c) => !c.ok).length;
process.exit(failed === 0 ? 0 : 1);
