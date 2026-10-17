#!/usr/bin/env node
/**
 * Records the demo-video clips from the live LinuxONE deployment.
 *
 *   node submission/video/record.mjs                  # all clips
 *   node submission/video/record.mjs city present     # selected clips
 *   VIDEO_URL=http://localhost:5173/ node submission/video/record.mjs city
 *
 * Capture is in-page tab capture (getDisplayMedia with preferCurrentTab, H.264 via the GPU
 * encoder). Only the app's own tab is recorded: if Chrome hands back anything other than a
 * browser-tab surface the clip is refused and nothing is written. Every verdict, latency and
 * hash on screen comes from the real API; the recorder only clicks the UI and moves the camera
 * through the ?capture hooks.
 *
 * Output: submission/video/raw/<clip>.webm and <clip>.json (markers, seconds from clip start).
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "..", "frontend", "package.json"));
const { chromium } = require("playwright-core");

const BASE = (process.env.VIDEO_URL ?? "https://intentgatez.148-100-79-208.sslip.io/").replace(/\/?$/, "/");
const OUT = path.join(here, "raw");
const W = 1920;
const H = 1080;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--ignore-gpu-blocklist",
    "--use-angle=default",
    "--force_high_performance_gpu",
    "--auto-accept-this-tab-capture",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--force-device-scale-factor=1",
    `--window-size=${W + 20},${H + 160}`,
    `--window-position=${process.env.VIDEO_WINDOW_X ?? 0},0`,
  ],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(query, quality = "med") {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.addInitScript((q) => {
    try {
      localStorage.setItem("intentgate.quality", q);
    } catch {
      /* ignore */
    }
  }, quality);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  pageerror:", e.message));
  let sink = null;
  await page.exposeFunction("__saveChunk", (b64) => sink && fs.appendFileSync(sink, Buffer.from(b64, "base64")));
  page.setSink = (f) => (sink = f);
  await page.goto(BASE + query, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__igz && !!window.__igz.getState().cityIndex, null, { timeout: 90000 });
  return { ctx, page };
}

/** One clip: tab capture of the page into raw/<name>.webm, with timestamped markers. */
class Clip {
  constructor(page, name) {
    this.page = page;
    this.name = name;
    this.file = path.join(OUT, `${name}.webm`);
    this.markers = [];
  }
  async start(activate = [330, 92]) {
    fs.writeFileSync(this.file, "");
    this.page.setSink(this.file);
    await this.page.mouse.click(...activate); // transient user activation for getDisplayMedia
    const info = await this.page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, width: 1920, height: 1080, cursor: "never" },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
      });
      const track = stream.getVideoTracks()[0];
      const surface = track.getSettings().displaySurface;
      if (surface !== "browser") {
        stream.getTracks().forEach((t) => t.stop());
        return { refused: surface ?? "unknown" };
      }
      const mime = ["video/webm;codecs=h264", "video/mp4;codecs=avc1.640028", "video/webm;codecs=vp8"].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 40_000_000 });
      window.__clip = { rec, stream, pending: [] };
      rec.ondataavailable = (e) => {
        window.__clip.pending.push(
          (async () => {
            const buf = new Uint8Array(await e.data.arrayBuffer());
            let s = "";
            for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
            await window.__saveChunk(btoa(s));
          })(),
        );
      };
      rec.start(500);
      return { mime, settings: track.getSettings() };
    });
    if (info.refused) {
      fs.rmSync(this.file, { force: true });
      throw new Error(`capture surface was "${info.refused}", not the app tab; nothing recorded`);
    }
    this.t0 = Date.now();
    console.log(`  recording ${this.name} (${info.mime}, ${info.settings.width}x${info.settings.height})`);
  }
  mark(label) {
    const t = (Date.now() - this.t0) / 1000;
    this.markers.push({ t: Math.round(t * 1000) / 1000, label });
    console.log(`  [${t.toFixed(2)}s] ${label}`);
  }
  async stop() {
    await this.page.evaluate(async () => {
      const c = window.__clip;
      await new Promise((r) => {
        c.rec.onstop = r;
        c.rec.stop();
      });
      await Promise.all(c.pending);
      c.stream.getTracks().forEach((t) => t.stop());
    });
    this.page.setSink(null);
    const duration = (Date.now() - this.t0) / 1000;
    fs.writeFileSync(path.join(OUT, `${this.name}.json`), JSON.stringify({ clip: this.name, base: BASE, duration, markers: this.markers }, null, 2));
    console.log(`  saved ${path.relative(process.cwd(), this.file)} (${(fs.statSync(this.file).size / 1e6).toFixed(1)} MB, ${duration.toFixed(1)} s)`);
  }
}

const cam = {
  /** Camera pose [px,py,pz, tx,ty,tz]; smooth = seconds of eased travel (0 = cut). */
  async pose(page, p, smooth = 0) {
    await page.evaluate(
      ([p, smooth]) => {
        window.__igz.setState({ cameraMode: "static", followId: null });
        const c = window.__igzCam;
        if (smooth) c.smoothTime = smooth;
        void c.setLookAt(p[0], p[1], p[2], p[3], p[4], p[5], smooth > 0);
      },
      [p, smooth],
    );
  },
  async orbit(page) {
    await page.evaluate(() => window.__igz.setState({ cameraMode: "orbit", followId: null }));
  },
};

/** Eased scroll of the proof page so that the heading with `text` sits near the top. */
async function scrollTo(page, text, ms = 1600, offset = 70) {
  await page.evaluate(
    async ([text, ms, offset]) => {
      const el = [...document.querySelectorAll("h2, h3, div, span")].find((e) => e.children.length === 0 && e.textContent.trim() === text);
      if (!el) throw new Error(`heading not found: ${text}`);
      let sc = el.parentElement;
      while (sc && !(sc.scrollHeight > sc.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      if (!sc) throw new Error("no scroll container");
      const from = sc.scrollTop;
      const to = Math.min(sc.scrollHeight - sc.clientHeight, from + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - offset);
      const t0 = performance.now();
      await new Promise((done) => {
        const step = () => {
          const k = Math.min(1, (performance.now() - t0) / ms);
          const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          sc.scrollTop = from + (to - from) * e;
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    },
    [text, ms, offset],
  );
}

// ------------------------------------------------------------------------------------- clips

const CLIPS = {
  /** City only (no UI): river-level skyline, crane up to the aerial view, slow orbit. */
  async city() {
    const { ctx, page } = await openPage("?capture&cinema");
    await sleep(9000); // building kit + textures
    await cam.pose(page, [-30, 10, 168, 10, 18, 40]);
    await sleep(1500);
    const clip = new Clip(page, "city");
    await clip.start([960, 1060]);
    clip.mark("river level");
    await cam.pose(page, [25, 15, 158, 25, 20, 30], 7);
    await sleep(10500);
    clip.mark("crane up");
    await cam.pose(page, [-115, 98, 238, 5, 0, 20], 6);
    await sleep(10000);
    clip.mark("orbit");
    await cam.orbit(page);
    await sleep(13000);
    await clip.stop();
    await ctx.close();
  },

  /** The command console at rest (overview), for the solution segment. */
  async console() {
    const { ctx, page } = await openPage("?capture");
    await sleep(9000);
    const clip = new Clip(page, "console");
    await clip.start();
    clip.mark("console");
    await sleep(10000);
    await clip.stop();
    await ctx.close();
  },

  /** Presentation mode end to end: all four scenarios through the real API. */
  async present() {
    const { ctx, page } = await openPage("?capture");
    await sleep(9000);
    const clip = new Clip(page, "present");
    await clip.start();
    await sleep(800);
    await page.getByRole("button", { name: "Present" }).click();
    clip.mark("present clicked");
    let last = "";
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      const s = await page.evaluate(() => {
        const el = document.querySelector("main .pointer-events-none.absolute.inset-0.z-30");
        return el ? el.innerText.replace(/\s+/g, " ").trim().slice(0, 220) : "";
      });
      if (s !== last) {
        clip.mark(s);
        last = s;
      }
      if (/End of demonstration/.test(s)) {
        await sleep(7000);
        break;
      }
      await sleep(120);
    }
    await clip.stop();
    await ctx.close();
  },

  /** Console: the $200,000 order is challenged, approved once, then tampered, executed and replayed. */
  async challenge() {
    const { ctx, page } = await openPage("?capture");
    await sleep(9000);
    const clip = new Clip(page, "challenge");
    await clip.start();
    await sleep(1200);
    await page.locator("div.ig-card", { hasText: "The $200,000 supply order" }).first().getByRole("button", { name: /Run|Re-run/ }).click();
    clip.mark("run supply");
    await sleep(4200);
    await page.getByRole("button", { name: /Approve as/ }).click();
    clip.mark("approve");
    await sleep(2600);
    await page.getByRole("button", { name: /Tamper/ }).click();
    clip.mark("tamper");
    await sleep(2600);
    await page.getByRole("button", { name: /Execute with approval/ }).click();
    clip.mark("execute");
    await sleep(2600);
    await page.getByRole("button", { name: /Replay approval/ }).click();
    clip.mark("replay");
    await sleep(1500);
    await page.evaluate(() => {
      const label = [...document.querySelectorAll("div")].find((d) => d.textContent === "Server responses");
      label?.parentElement?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
    clip.mark("responses");
    await sleep(4500);
    await clip.stop();
    await ctx.close();
  },

  /** IBM Z Proof page: request path, hardware facts, NNPA utilisation, audit chain, benchmarks. */
  async proof() {
    const { ctx, page } = await openPage("?capture");
    await page.getByRole("button", { name: "IBM Z Proof" }).click();
    await sleep(6000);
    const clip = new Clip(page, "proof");
    await clip.start([1880, 1060]);
    clip.mark("top");
    await sleep(6000);
    await scrollTo(page, "Directly verified hardware facts");
    clip.mark("hardware");
    await sleep(6500);
    await scrollTo(page, "Model execution facts");
    clip.mark("model");
    await sleep(7500);
    await page.getByRole("button", { name: "Verify chain" }).click();
    clip.mark("verify chain");
    await sleep(3500);
    await scrollTo(page, "Benchmark results");
    clip.mark("benchmarks");
    await sleep(6500);
    await scrollTo(page, "Benchmark results", 1600, -380);
    clip.mark("benchmarks 2");
    await sleep(6500);
    await clip.stop();
    await ctx.close();
  },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CLIPS);
try {
  for (const name of wanted) {
    if (!CLIPS[name]) throw new Error(`unknown clip ${name}; known: ${Object.keys(CLIPS).join(", ")}`);
    console.log(`clip ${name}`);
    await CLIPS[name]();
  }
} finally {
  await browser.close();
}
