#!/usr/bin/env node
/**
 * End-to-end smoke test and screenshot capture for the IntentGate Z console.
 *
 * Prerequisites: the backend on :8000 and `npm run dev` (or `npm run preview`) running.
 *   npm run smoke
 *   SMOKE_URL=http://localhost:4173 npm run smoke          # against the production preview
 *   SMOKE_BROWSER="C:/path/to/chrome.exe" npm run smoke    # explicit Chromium binary
 *
 * Everything is driven through the real UI and API: all four scenarios, the supervisor
 * approve -> tamper -> execute -> replay flow, the safe re-plan, trace, IBM Z proof, audit,
 * Studio and presentation mode. Screenshots go to ./screenshots. Exits non-zero on page
 * errors or when the challenge security tests do not return the expected server codes.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "..", "screenshots");
const URL = process.env.SMOKE_URL ?? "http://localhost:5173/";
fs.mkdirSync(OUT, { recursive: true });

const launch = process.env.SMOKE_BROWSER
  ? { executablePath: process.env.SMOKE_BROWSER }
  : { channel: process.env.SMOKE_CHANNEL ?? "chrome" };
const browser = await chromium.launch({ ...launch, headless: true, args: ["--ignore-gpu-blocklist", "--use-angle=default"] });

const problems = [];
const expectedHttp = [];

async function newPage(width, height, quality = "med") {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript((q) => {
    try {
      localStorage.setItem("intentgate.quality", q);
    } catch {
      /* ignore */
    }
  }, quality);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Chrome logs every non-2xx fetch; 409 (refused replays/tampering) and 503 (Granite not
    // configured) are expected server answers in this flow.
    if (/status of (409|503)/.test(t)) expectedHttp.push(t);
    else problems.push(`console.error: ${t}`);
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.getByText("Decision timeline").waitFor({ timeout: 45000 });
  await page.waitForTimeout(3500);
  return { ctx, page };
}

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  saved screenshots/${name}.png`);
};

const scenarioCard = (page, title) => page.locator("div.ig-card", { hasText: title }).first();
async function run(page, title, settle = 4000) {
  await scenarioCard(page, title).getByRole("button", { name: /Run|Re-run/ }).click();
  await page.waitForTimeout(settle);
  const verdict = await page.locator("aside").last().locator("span.uppercase").first().innerText().catch(() => "?");
  console.log(`  ${title}: inspector shows ${verdict.trim()}`);
}

// ---------------------------------------------------------------- 1440 x 900 walkthrough
console.log("1440x900 walkthrough");
{
  const { ctx, page } = await newPage(1440, 900);
  await shot(page, "01-command-overview");

  await run(page, "The legitimate reroute");
  await shot(page, "02-reroute");

  await run(page, "The $200,000 supply order", 3500);
  await shot(page, "03-supply-challenge");
  await page.getByRole("button", { name: /Approve as/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Tamper/ }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Execute with approval/ }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Replay approval/ }).click();
  await page.waitForTimeout(2000);
  await page.getByText("Server responses", { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, "04-challenge-security-tests");
  const log = await page.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find((d) => d.firstElementChild?.textContent === "Server responses");
    return el ? el.innerText : "";
  });
  for (const code of ["grant_issued", "grant_action_mismatch", "executed", "grant_replayed"]) {
    if (!log.includes(code)) problems.push(`challenge log missing ${code}`);
  }
  console.log("  challenge log codes:", ["grant_issued", "grant_action_mismatch", "executed", "grant_replayed"].filter((c) => log.includes(c)).join(", "));

  await run(page, "The prompt-injection attack");
  await page.getByRole("button", { name: "Blocked op" }).click();
  await page.waitForTimeout(3000);
  await shot(page, "05-injection-block-ghost-route");
  await page.getByRole("button", { name: /Re-plan safely/ }).click();
  await page.waitForTimeout(4000);
  await shot(page, "06-safe-replan");

  await run(page, "Intent drift");
  await shot(page, "07-intent-drift");

  await page.getByRole("button", { name: /TRACE THIS DECISION/ }).click();
  await page.waitForTimeout(1500);
  await shot(page, "08-decision-trace");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Explain with Granite/ }).click();
  await page.waitForTimeout(1500);

  await page.getByRole("button", { name: "IBM Z Proof" }).click();
  await page.waitForTimeout(3000);
  await shot(page, "09-ibm-z-proof");
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 1650);
  await page.waitForTimeout(1000);
  await shot(page, "10-proof-model-accelerator");
  await page.mouse.wheel(0, 1100);
  await page.waitForTimeout(1800);
  await shot(page, "11-proof-benchmarks");

  await page.getByRole("button", { name: "Audit", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Verify chain/ }).click();
  await page.waitForTimeout(1500);
  await shot(page, "12-audit-chain");

  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /Submit to IntentGate/ }).click();
  await page.waitForTimeout(4000);
  await shot(page, "13-studio-submission");
  await ctx.close();
}

// ---------------------------------------------------------------- 1920 x 1080 + presentation
console.log("1920x1080 + presentation mode");
{
  const { ctx, page } = await newPage(1920, 1080, "high");
  await run(page, "The $200,000 supply order", 3000);
  await run(page, "The prompt-injection attack", 4000);
  await shot(page, "14-command-1920-high");

  await page.keyboard.press("p");
  const wanted = [
    ["Verdict from the gateway: CHALLENGE", "15-presentation-challenge"],
    ["Approvals are single-use", "16-presentation-replay-rejected"],
    ["ghost route", "17-presentation-ghost-route"],
    ["End of demonstration", "18-presentation-end"],
  ];
  const t0 = Date.now();
  while (wanted.length && Date.now() - t0 < 150000) {
    await page.waitForTimeout(500);
    const caption = await page.evaluate(() => {
      const el = [...document.querySelectorAll("div")].find((d) => d.className.includes("rounded-full") && d.className.includes("bottom-5"));
      return el ? el.innerText : "";
    });
    if (caption.includes(wanted[0][0])) {
      await page.waitForTimeout(1200);
      await shot(page, wanted[0][1]);
      wanted.shift();
    }
  }
  if (wanted.length) problems.push(`presentation did not reach: ${wanted.map((w) => w[0]).join(", ")}`);
  await page.keyboard.press("Escape");
  await ctx.close();
}

await browser.close();
console.log(`expected 409/503 responses observed: ${expectedHttp.length}`);
if (problems.length) {
  console.error("SMOKE FAILED:\n" + problems.map((p) => ` - ${p}`).join("\n"));
  process.exit(1);
}
console.log("SMOKE PASSED");
