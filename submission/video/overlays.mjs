#!/usr/bin/env node
/**
 * Renders the demo video's text overlays (transparent 1920x1080 PNGs) in the console's visual
 * language: IBM Plex, dark glass panels, verdict colours. Every number here is copied from a
 * results file in this repository; the source is named on the card or in compose.py.
 *
 *   node submission/video/overlays.mjs      -> submission/video/build/overlays/*.png
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const require = createRequire(path.join(root, "frontend", "package.json"));
const { chromium } = require("playwright-core");
const OUT = path.join(here, "build", "overlays");
fs.mkdirSync(OUT, { recursive: true });

const font = (pkg, file) => pathToFileURL(path.join(root, "frontend", "node_modules", "@fontsource", pkg, "files", file)).href;
const nnpa = JSON.parse(fs.readFileSync(path.join(root, "ml", "results", "nnpa_benchmark.json"), "utf8"));
const http = JSON.parse(fs.readFileSync(path.join(root, "ml", "results", "benchmark_http.json"), "utf8"));
const seeds = JSON.parse(fs.readFileSync(path.join(root, "ml", "results", "repeated_seeds_summary.json"), "utf8"));
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const m = (k, f) => seeds.methods[k][f].mean;
const http1 = http.levels.find((l) => l.concurrency === 1);
const ratioMax = Math.max(...Object.values(nnpa.cpu_over_nnpa_time_ratio));
const ratioBatch = Object.entries(nnpa.cpu_over_nnpa_time_ratio).find(([, v]) => v === ratioMax)[0];
const chartUrl = pathToFileURL(path.join(root, "ml", "results", "charts", "nnpa_vs_cpu.png")).href;

const MARK = `<svg width="56" height="56" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00D5B5"/><stop offset="1" stop-color="#0F62FE"/></linearGradient></defs><path d="M16 3.5 26.5 7.4v7.6c0 6.4-4.3 11.1-10.5 12.9C9.8 26.1 5.5 21.4 5.5 15V7.4L16 3.5Z" fill="rgba(0,213,181,0.06)" stroke="url(#g)" stroke-width="1.6" stroke-linejoin="round"/><path d="M11.4 22.2V12.1M20.6 22.2V12.1M10.4 12.1h11.2" fill="none" stroke="#E8F0F7" stroke-width="1.7" stroke-linecap="round"/><path d="M13.9 16.9h4.2" stroke="#00D5B5" stroke-width="1.7" stroke-linecap="round"/></svg>`;

const CSS = `
@font-face{font-family:Plex;src:url(${font("ibm-plex-sans", "ibm-plex-sans-latin-400-normal.woff2")});font-weight:400}
@font-face{font-family:Plex;src:url(${font("ibm-plex-sans", "ibm-plex-sans-latin-500-normal.woff2")});font-weight:500}
@font-face{font-family:Plex;src:url(${font("ibm-plex-sans", "ibm-plex-sans-latin-600-normal.woff2")});font-weight:600}
@font-face{font-family:Plex;src:url(${font("ibm-plex-sans", "ibm-plex-sans-latin-700-normal.woff2")});font-weight:700}
@font-face{font-family:PlexMono;src:url(${font("ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff2")});font-weight:400}
@font-face{font-family:PlexMono;src:url(${font("ibm-plex-mono", "ibm-plex-mono-latin-500-normal.woff2")});font-weight:500}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1920px;height:1080px;background:transparent;font-family:Plex,sans-serif;color:#E8F0F7;-webkit-font-smoothing:antialiased}
.abs{position:absolute}
.panel{background:linear-gradient(180deg,rgba(12,26,40,.97),rgba(6,14,23,.97));border:1px solid #1f3a52;border-radius:12px;box-shadow:0 30px 90px rgba(0,0,0,.6)}
.mono{font-family:PlexMono,monospace}
.kicker{font-family:PlexMono,monospace;font-size:20px;letter-spacing:.24em;color:#78A9FF;text-transform:uppercase}
.teal{color:#00D5B5}.amber{color:#FFBC5C}.red{color:#FF5D70}.blue{color:#78A9FF}.muted{color:#8496A8}
.pill{display:inline-flex;align-items:center;gap:12px;padding:10px 20px;border-radius:999px;background:rgba(7,17,28,.86);border:1px solid #1f3a52;font-family:PlexMono,monospace;font-size:19px;letter-spacing:.2em;text-transform:uppercase;color:#C9D6E2}
.dot{width:10px;height:10px;border-radius:50%;background:#00D5B5;box-shadow:0 0 14px #00D5B5}
`;

const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;
const chapter = (label, color = "#00D5B5") => `<div class="abs" style="left:48px;top:44px"><span class="pill"><span class="dot" style="background:${color};box-shadow:0 0 14px ${color}"></span>${label}</span></div>`;

const OVERLAYS = {
  title_hook: `
    <div class="abs" style="left:72px;bottom:86px;display:flex;align-items:center;gap:26px">
      ${MARK.replace('width="56" height="56"', 'width="92" height="92"')}
      <div>
        <div style="font-size:64px;font-weight:600;letter-spacing:.2em">INTENTGATE <span class="teal">Z</span></div>
        <div style="font-size:28px;color:#C9D6E2;margin-top:6px">Real-time intent security for AI agents, running on IBM LinuxONE</div>
      </div>
    </div>
    <div class="abs mono" style="right:56px;top:46px;font-size:17px;letter-spacing:.18em;color:#8496A8;text-transform:uppercase">Nova Meridian · synthetic city · fictional data</div>`,

  problem_1: `
    <div class="abs" style="left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center">
      <div style="text-align:center;max-width:1500px">
        <div class="kicker">The problem</div>
        <div style="font-size:66px;font-weight:600;line-height:1.18;margin-top:28px">Authentication proves <span class="teal">who</span> an agent is.</div>
        <div style="font-size:66px;font-weight:600;line-height:1.18;margin-top:18px">It does not prove its next action matches <span class="amber">what the human intended</span>.</div>
      </div>
    </div>`,

  problem_2: `
    <div class="abs" style="left:0;right:0;top:0;bottom:0;display:flex;align-items:center;justify-content:center">
      <div style="text-align:center;max-width:1500px">
        <div class="kicker">Indirect prompt injection</div>
        <div style="font-size:210px;font-weight:700;line-height:1;margin-top:26px" class="red">24%</div>
        <div style="font-size:44px;font-weight:500;margin-top:18px">of instructions hidden in external content succeeded against a tool-using GPT-4 agent</div>
        <div style="font-size:36px;color:#C9D6E2;margin-top:16px">and an enhanced attack nearly doubled the success rate</div>
        <div class="mono muted" style="font-size:20px;margin-top:34px;letter-spacing:.06em">InjecAgent benchmark, ReAct-prompted GPT-4 · Zhan et al., Findings of ACL 2024</div>
      </div>
    </div>`,

  ch_gateway: chapter("The gateway"),
  ch_ibmz: chapter("IBM Z · LinuxONE", "#4589FF"),
  ch_results: chapter("Results", "#00D5B5"),
  ch_challenge: chapter("Scenario 02 · console view", "#FFBC5C"),

  nnpa_slide: `
    <div class="abs" style="inset:0;background:radial-gradient(1400px 800px at 50% 45%,#0b1a2a,#03070d)"></div>
    ${chapter("IBM Telum on-chip AI accelerator", "#4589FF")}
    <div class="abs" style="left:0;right:0;top:118px;display:flex;justify-content:center">
      <img src="${chartUrl}" style="width:1500px;border-radius:12px;border:1px solid #1f3a52;box-shadow:0 30px 90px rgba(0,0,0,.6)"/>
    </div>
    <div class="abs" style="left:0;right:0;bottom:66px;display:flex;justify-content:center;gap:22px">
      <div class="panel" style="padding:18px 30px;font-size:26px">Up to <b class="teal">${ratioMax.toFixed(2)}×</b> faster than CPU <span class="muted">(batch ${ratioBatch})</span></div>
      <div class="panel" style="padding:18px 30px;font-size:26px">Device verified: <b class="mono teal">nnpa</b></div>
      <div class="panel" style="padding:18px 30px;font-size:26px">Max |Δp| vs CPU <b class="mono">${nnpa.max_abs_prob_difference.toFixed(4)}</b></div>
    </div>`,

  ibmz_latency: `
    <div class="abs panel" style="right:56px;bottom:60px;padding:24px 32px;width:560px">
      <div class="kicker" style="font-size:16px">Gateway decision, HTTP, on LinuxONE</div>
      <div style="display:flex;align-items:baseline;gap:16px;margin-top:10px"><span style="font-size:76px;font-weight:600" class="teal">${http1.latency_ms.p50.toFixed(1)} ms</span><span style="font-size:24px" class="muted">p50</span></div>
      <div class="muted" style="font-size:20px;margin-top:4px">p95 ${http1.latency_ms.p95.toFixed(1)} ms · ${http1.requests.toLocaleString("en-US")} requests · ${http1.errors} errors · client on the same VM</div>
    </div>`,

  results_card: `
    <div class="abs panel" style="left:50%;transform:translateX(-50%);bottom:56px;padding:26px 40px;width:1560px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div class="kicker" style="font-size:17px;white-space:nowrap">Unsafe actions let through · mean of 5 datasets</div>
        <div class="mono muted" style="font-size:17px;white-space:nowrap">held-out test sets · scored on IBM LinuxONE</div>
      </div>
      <div style="display:flex;gap:28px;margin-top:16px">
        <div style="flex:1"><div class="muted" style="font-size:22px">Hard rules only</div><div style="font-size:58px;font-weight:600" class="red">${pct(m("hard_policy", "unsafe_miss_rate"))}</div><div class="muted" style="font-size:19px">legit blocked ${pct(m("hard_policy", "false_block_rate_allow"))}</div></div>
        <div style="flex:1"><div class="muted" style="font-size:22px">ML model only</div><div style="font-size:58px;font-weight:600" class="amber">${pct(m("ml_only", "unsafe_miss_rate"))}</div><div class="muted" style="font-size:19px">legit blocked ${pct(m("ml_only", "false_block_rate_allow"))}</div></div>
        <div style="flex:1.2"><div style="font-size:22px" class="teal">IntentGate Z hybrid</div><div style="font-size:58px;font-weight:600" class="teal">${pct(m("hybrid", "unsafe_miss_rate"))}</div><div style="font-size:19px;color:#C9D6E2">legit blocked ${pct(m("hybrid", "false_block_rate_allow"))}</div></div>
      </div>
    </div>`,

  end_links: `
    <div class="abs" style="left:0;right:0;bottom:70px;display:flex;justify-content:center">
      <div class="panel" style="padding:20px 36px;display:flex;gap:36px;align-items:center;font-size:25px">
        <span><span class="muted">Live</span> <span class="mono">intentgatez.148-100-79-208.sslip.io</span></span>
        <span><span class="muted">Code</span> <span class="mono">github.com/4waiz/IntentGateZ</span></span>
        <span class="teal" style="font-weight:600">Team Kanban · IBM Z Datathon 2026</span>
      </div>
    </div>`,
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
for (const [name, body] of Object.entries(OVERLAYS)) {
  const html = path.join(OUT, `${name}.html`);
  fs.writeFileSync(html, page(body));
  await p.goto(pathToFileURL(html).href);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: true });
  fs.rmSync(html);
  console.log("overlay", name);
}
await browser.close();
