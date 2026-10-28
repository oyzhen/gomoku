import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = join(ROOT, "dist");
const SHOTS = join(ROOT, "verification-shots");
mkdirSync(SHOTS, { recursive: true });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const pathname = req.url.split("?")[0];
    const raw = pathname === "/" ? "/index.html" : pathname;
    const file = resolve(DIST, "." + decodeURIComponent(raw));
    if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-gl=swiftshader"] });
const errors = [];
const notFound = [];

function monitor(page) {
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => { if (response.status() === 404) notFound.push(response.url()); });
}

async function snap(page) {
  return page.evaluate(() => window.__gomokuDebug.snapshot());
}
async function clickCell(page, row, col) {
  const point = await page.evaluate(([r, c]) => window.__gomokuDebug.cellScreen(r, c), [row, col]);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(320);
}
async function directMove(page, row, col) {
  const legal = await page.evaluate(([r, c]) => window.__gomokuDebug.place(r, c), [row, col]);
  assert.equal(legal, true, `expected legal move ${row},${col}`);
}
async function toMenu(page) {
  await page.getByTitle("返回对局设置").click();
  await page.waitForTimeout(150);
}
async function selectRule(page, name) {
  await page.locator(".rule-options button").filter({ hasText: name }).click();
}

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
monitor(page);
await page.goto(`${origin}/?debug=1`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__GAME_READY__ === true && window.__gomokuDebug);
assert.equal((await snap(page)).status, "title");
await page.getByTitle("星穹夜弈").click();
assert.equal(await page.locator("#game-root").getAttribute("data-theme"), "cosmic");
await page.getByTitle("胡桃雅木").click();

// Swap2: both placement stages, returned color choice, and undo restoration.
await page.getByTestId("mode-local").click();
await page.getByTestId("opening-toggle").click();
await selectRule(page, "连珠");
await page.getByTestId("start-game").click();
await clickCell(page, 7, 7);
await clickCell(page, 7, 8);
await clickCell(page, 8, 8);
await page.getByTestId("opening-choice").waitFor();
assert.equal((await snap(page)).openingPhase, "secondChoice");
await page.screenshot({ path: join(SHOTS, "04-swap2-choice.png") });
await page.getByText("再摆两手", { exact: true }).click();
await clickCell(page, 8, 7);
await clickCell(page, 6, 7);
assert.equal((await snap(page)).openingPhase, "firstChoice");
await page.getByText("选择黑棋", { exact: true }).click();
assert.equal((await snap(page)).openingPhase, null);
assert.equal((await snap(page)).currentPlayer, 2);
await page.getByTitle("悔棋 (Ctrl+Z)").click();
assert.equal((await snap(page)).moves.length, 4);
assert.equal((await snap(page)).openingPhase, "place2");

// Victory, restart, pause and resume.
await toMenu(page);
if ((await page.getByTestId("opening-toggle").getAttribute("aria-checked")) === "true") await page.getByTestId("opening-toggle").click();
await selectRule(page, "自由");
await page.getByTestId("start-game").click();
for (const [row, col] of [[7,3],[8,3],[7,4],[8,4],[7,5],[8,5],[7,6],[8,6],[7,7]]) await directMove(page, row, col);
await page.getByTestId("result-modal").waitFor();
assert.equal((await snap(page)).winner, 1);
await page.screenshot({ path: join(SHOTS, "05-victory.png") });
await page.getByText("再来一局", { exact: true }).click();
assert.equal((await snap(page)).moves.length, 0);
await page.getByTestId("pause-game").click();
await page.getByTestId("resume-game").waitFor();
await page.getByTestId("resume-game").click();
assert.equal((await snap(page)).status, "playing");

// Local AI actually answers a canvas move.
await toMenu(page);
await page.getByTestId("mode-ai").click();
await page.getByTestId("level-slider").focus();
await page.getByTestId("level-slider").press("End");
assert.equal(await page.getByTestId("level-slider").inputValue(), "100");
await page.getByTestId("start-game").click();
await clickCell(page, 7, 7);
await page.waitForFunction(() => window.__gomokuDebug.snapshot().moves.length >= 2, null, { timeout: 12000 });
assert.equal((await snap(page)).moves.length, 2);
assert.equal((await snap(page)).level, 100);
assert.ok((await snap(page)).searchStats);
await page.screenshot({ path: join(SHOTS, "06-local-ai.png") });
const metrics = await page.evaluate(() => window.__gameMetrics());

// Both LLM protocols are exercised end-to-end against a deterministic local mock.
await toMenu(page);
await page.getByTestId("mode-llm").click();
await page.getByLabel("接口地址").fill("http://mock.local/v1");
await page.getByLabel("模型名称").fill("test-gomoku-model");
await page.getByLabel("API Key").fill("not-a-real-key");
assert.equal(await page.getByLabel("落子格式").inputValue(), "tools");
await page.getByLabel("思考强度").selectOption("none");
assert.equal(await page.getByLabel("思考强度").inputValue(), "none");
await page.getByLabel("思考强度").selectOption("high");
assert.equal(await page.getByLabel("超时时间（秒）").inputValue(), "120");
await page.getByLabel("超时时间（秒）").fill("180");
await page.screenshot({ path: join(SHOTS, "07-llm-settings.png") });
let apiCalled = "";
await page.route("http://mock.local/v1/chat/completions", async (route) => {
  apiCalled = "tools";
  const body = route.request().postDataJSON();
  assert.equal(body.model, "test-gomoku-model");
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.reasoning_effort, "high");
  assert.equal(body.timeoutSeconds, undefined);
  assert.equal(body.tools[0].function.name, "place_move");
  assert.equal(body.tool_choice, undefined);
  assert.match(body.messages[1].content, /BH8/);
  assert.doesNotMatch(body.messages[1].content, /当前棋盘/);
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "call_mock_1", type: "function", function: { name: "place_move", arguments: '{"row":9,"col":9}' } }] } }] }) });
});
await page.getByTestId("start-game").click();
await clickCell(page, 7, 7);
await page.waitForFunction(() => window.__gomokuDebug.snapshot().moves.length >= 2, null, { timeout: 8000 });
assert.equal(apiCalled, "tools");
assert.equal((await snap(page)).llmReason, "");
assert.deepEqual((await snap(page)).moves[1], { row: 8, col: 8, player: 2, number: 2 });
await page.screenshot({ path: join(SHOTS, "07-llm-mock.png") });

await toMenu(page);
await page.getByLabel("落子格式").selectOption("json");
await page.unroute("http://mock.local/v1/chat/completions");
await page.route("http://mock.local/v1/chat/completions", async (route) => {
  apiCalled = "json";
  const body = route.request().postDataJSON();
  assert.equal(body.tools, undefined);
  assert.equal(body.tool_choice, undefined);
  assert.match(body.messages[0].content, /只输出/);
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: '{"row":9,"col":9}' } }] }) });
});
await page.getByTestId("start-game").click();
await clickCell(page, 7, 7);
await page.waitForFunction(() => window.__gomokuDebug.snapshot().moves.length >= 2, null, { timeout: 8000 });
assert.equal(apiCalled, "json");
assert.deepEqual((await snap(page)).moves[1], { row: 8, col: 8, player: 2, number: 2 });

// Cold-start mobile check.
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
monitor(mobile);
await mobile.goto(`${origin}/?debug=1`, { waitUntil: "networkidle" });
await mobile.waitForFunction(() => window.__GAME_READY__ === true && window.__gomokuDebug);
await mobile.screenshot({ path: join(SHOTS, "08-mobile-title.png") });
await mobile.getByTestId("mode-llm").click();
await mobile.screenshot({ path: join(SHOTS, "08-mobile-llm-settings.png") });
const llmDimensions = await mobile.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
assert.ok(llmDimensions.width <= llmDimensions.viewport, "mobile LLM settings must not overflow horizontally");
await mobile.getByTestId("mode-local").click();
await mobile.getByTestId("start-game").click();
await clickCell(mobile, 7, 7);
assert.equal((await snap(mobile)).moves.length, 1);
await mobile.screenshot({ path: join(SHOTS, "09-mobile-game.png") });
const dimensions = await mobile.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
assert.ok(dimensions.width <= dimensions.viewport, "mobile page must not overflow horizontally");

assert.deepEqual(errors, [], `console errors: ${errors.join("\n")}`);
assert.deepEqual(notFound, [], `404 responses: ${notFound.join("\n")}`);
console.log("GOMOKU VERIFY OK: themes / Swap2 / undo / victory / restart / pause / local AI / mocked LLM tools+JSON / mobile");
console.log("RENDER METRICS", JSON.stringify(metrics));
await browser.close();
server.close();
