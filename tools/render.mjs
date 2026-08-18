// Renders the simulation without a display and writes PNGs.
//
// WebGPU is a browser API, so this drives a real Chromium — but it renders into
// a plain texture instead of a canvas swap chain, which is what lets it run on
// a machine with no GPU. See "Headless rendering" in AGENTS.md.
//
//   node tools/render.mjs [--frames N] [--size PX] [--grid N] [--teams N]
//                         [--ticks N] [--out DIR]

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";

const require = createRequire(import.meta.url);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const options = {
  width: Number(arg("size", 512)),
  height: Number(arg("size", 512)),
  gridSize: Number(arg("grid", 80)),
  numTeams: Number(arg("teams", 4)),
  ticksPerFrame: Number(arg("ticks", 40)),
  frames: Number(arg("frames", 4)),
};
const outDir = arg("out", "renders");

/** Minimal PNG encoder — avoids a dependency just to write a few images. */
function encodePng(rgba, width, height) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }

  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`dev server did not start at ${url}`);
}

const PORT = 5174;
const BASE = `http://127.0.0.1:${PORT}/pong-wars/`;

const vite = spawn("npx", ["vite", "--port", String(PORT), "--host", "127.0.0.1", "--strictPort"], {
  stdio: "ignore",
});

let browser;
try {
  await waitForServer(BASE);

  const { chromium } = require("playwright");
  const launchArgs = [
    "--enable-unsafe-webgpu",
    // Software rendering: the only WebGPU available on a machine with no GPU.
    "--use-angle=swiftshader",
    "--no-sandbox",
    "--disable-gpu-sandbox",
  ];

  // Prefer a browser the environment already provides, falling back to the one
  // Playwright downloaded. Preinstalled images often ship a Chromium whose build
  // Playwright will not find on its own.
  const candidates = [
    process.env.CHROMIUM_PATH,
    existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined,
    undefined, // Playwright's own download
  ].filter((path, i, all) => all.indexOf(path) === i);

  for (const executablePath of candidates) {
    try {
      browser = await chromium.launch(
        executablePath ? { executablePath, args: launchArgs } : { args: launchArgs },
      );
      break;
    } catch (error) {
      if (executablePath === candidates.at(-1)) throw error;
    }
  }

  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // The browser asks for a favicon on its own; a missing one is not a failure.
    const from = `${m.location()?.url ?? ""} ${m.text()}`;
    if (from.includes("favicon")) return;
    errors.push(m.text());
  });

  await page.goto(`${BASE}tools/headless.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.renderFrames === "function");

  const frames = await page.evaluate((o) => window.renderFrames(o), options);

  await mkdir(outDir, { recursive: true });
  for (const [i, frame] of frames.entries()) {
    const file = `${outDir}/frame-${String(i).padStart(3, "0")}.png`;
    await writeFile(file, encodePng(Uint8Array.from(frame.pixels), options.width, options.height));
    console.log(`${file}  (${frame.ticks} ticks)`);
  }

  if (errors.length > 0) {
    console.error("\nErrors reported by the page:");
    for (const e of errors) console.error(`  ${e}`);
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  vite.kill();
}
