const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const source = fs.readFileSync(path.join(__dirname, "../public/js/marketing.js"), "utf8");
const productId = "507f1f77bcf86cd799439011";

function browser(t, overrides = {}, stored = {}) {
  const config = { enabled: true, consent: "granted", pixelId: "", csrfToken: "csrf-test", page: "catalog",
    product: null, purchase: null, checkout: null, ...overrides };
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <article data-marketing-impression="ProductImpression" data-marketing-target="${productId}">
      <a href="/product/brake-pad" data-marketing-click="ProductClick" data-marketing-target="${productId}"><span>Brake pad</span></a>
    </article>
    <aside data-marketing-impression="PromotionImpression" data-marketing-target="lab7-helmets"></aside>
    <form action="/marketing/consent"><button value="denied">Withdraw</button></form>
    <script type="application/json" id="marketing-config">${JSON.stringify(config)}</script></body></html>`,
    { url: "http://localhost:3000/", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom, requests = [];
  for (const [key, value] of Object.entries(stored)) window.localStorage.setItem(key, value);
  let observer;
  window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observer = this; }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
    emit(target, ratio) { this.callback([{ target, isIntersecting: ratio > 0, intersectionRatio: ratio }]); }
  };
  window.fetch = async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return { status: 204, ok: true };
  };
  window.document.addEventListener("click", (event) => event.preventDefault());
  window.eval(source);
  return { window, config, requests, get observer() { return observer; },
    calls: () => Array.from(window.fbq?.queue || [], (args) => Array.from(args)) };
}

function click(fixture) {
  fixture.window.document.querySelector("a span").dispatchEvent(new fixture.window.MouseEvent("click", {
    bubbles: true, cancelable: true, button: 0,
  }));
}
function flush(fixture) { fixture.window.dispatchEvent(new fixture.window.Event("pagehide")); }
function events(fixture) { return fixture.requests.flatMap((request) => request.body.events); }

test("browser does not load Meta or send events before consent, after declining, or when disabled", (t) => {
  for (const config of [{ consent: "unknown" }, { consent: "denied" }, { enabled: false }]) {
    const fixture = browser(t, { pixelId: "123456789012345", ...config });
    click(fixture);
    flush(fixture);
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.window.fbq, undefined);
    assert.equal(fixture.window.document.querySelector('script[src*="facebook.net"]'), null);
  }
});

test("local demo measures visible cards once and captures nested product clicks with CSRF", (t) => {
  const fixture = browser(t);
  const card = fixture.window.document.querySelector("article");
  fixture.observer.emit(card, 0.2);
  assert.equal(fixture.window.motopartsMarketing.events.filter((event) => event.type === "ProductImpression").length, 0);
  fixture.observer.emit(card, 0.6);
  fixture.observer.emit(card, 0.9);
  click(fixture);
  const tracked = events(fixture);
  assert.equal(tracked.filter((event) => event.type === "ProductImpression").length, 1);
  assert.equal(tracked.filter((event) => event.type === "ProductClick").length, 1);
  assert.equal(fixture.requests[0].headers["x-csrf-token"], "csrf-test");
  assert.equal(fixture.requests[0].keepalive, true);
  assert.equal(fixture.window.fbq, undefined);
  assert.ok(tracked.every((event) => /^[a-f0-9-]{36}$/.test(event.eventId)));
});

test("impressions wait until a background document becomes visible", (t) => {
  const fixture = browser(t), card = fixture.window.document.querySelector("article");
  Object.defineProperty(fixture.window.document, "visibilityState", { value: "hidden", configurable: true });
  fixture.observer.emit(card, 0.7);
  assert.equal(fixture.window.motopartsMarketing.events.filter((event) => event.type === "ProductImpression").length, 0);
  Object.defineProperty(fixture.window.document, "visibilityState", { value: "visible", configurable: true });
  fixture.window.document.dispatchEvent(new fixture.window.Event("visibilitychange"));
  assert.equal(fixture.window.motopartsMarketing.events.filter((event) => event.type === "ProductImpression").length, 1);
});

test("configured and consented Pixel loads once and uses standard and custom commands", (t) => {
  const fixture = browser(t, { pixelId: "123456789012345", page: "product",
    product: { id: productId, value: 100, currency: "NPR" } });
  const script = fixture.window.document.querySelector('script[src*="facebook.net"]');
  assert.equal(script.src, "https://connect.facebook.net/en_US/fbevents.js");
  const commands = fixture.calls();
  assert.ok(commands.some((command) => command[0] === "consent" && command[1] === "grant"));
  assert.ok(commands.some((command) => command[0] === "set" && command[1] === "autoConfig" && command[2] === false));
  assert.ok(commands.some((command) => command[0] === "init" && command[1] === "123456789012345"));
  assert.ok(commands.some((command) => command[0] === "track" && command[1] === "PageView"));
  const content = commands.find((command) => command[1] === "ViewContent");
  assert.equal(content[2].currency, "NPR");
  assert.equal(content[2].content_ids[0], productId);
  click(fixture);
  assert.ok(fixture.calls().some((command) => command[0] === "trackCustom" && command[1] === "ProductClick"));
});

test("purchase dispatch uses a stable event ID and skips an already-attempted receipt reload", (t) => {
  const purchase = { eventId: "purchase-test-order", value: 350, currency: "NPR", content_ids: [productId], num_items: 2 };
  const first = browser(t, { page: "receipt", pixelId: "123456789012345", purchase });
  const command = first.calls().find((command) => command[1] === "Purchase");
  assert.equal(command[0], "track");
  assert.equal(command[2].value, 350);
  assert.equal(command[3].eventID, "purchase-test-order");
  const key = "motoparts-meta-purchase:123456789012345:purchase-test-order";
  assert.equal(first.window.localStorage.getItem(key), "attempted");
  const reload = browser(t, { page: "receipt", pixelId: "123456789012345", purchase }, { [key]: "attempted" });
  assert.equal(reload.calls().filter((command) => command[1] === "Purchase").length, 0);
  flush(first);
  assert.ok(events(first).every((event) => event.type !== "Purchase"), "browser cannot submit conversion counts");
});

test("withdrawal stops queued collection and revokes the already-initialized Pixel", (t) => {
  const fixture = browser(t, { pixelId: "123456789012345" });
  fixture.window.dispatchEvent(new fixture.window.StorageEvent("storage", {
    key: "motoparts-marketing-consent", newValue: "denied",
  }));
  click(fixture);
  flush(fixture);
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.window.motopartsMarketing.consent, "denied");
  assert.ok(fixture.calls().some((command) => command[0] === "consent" && command[1] === "revoke"));
});

test("account, wallet and dashboard pages do not initialize external tracking", (t) => {
  const fixture = browser(t, { page: null, pixelId: "123456789012345" });
  assert.equal(fixture.window.fbq, undefined);
  assert.equal(fixture.window.document.querySelector('script[src*="facebook.net"]'), null);
  assert.equal(fixture.requests.length, 0);
});

test("GA4 loads only with consent and a measured page, and sends one sanitized page view", (t) => {
  const ga = { gaId: "G-TEST123456", gaPage: { location: "http://localhost:3000/", title: "Catalog" } };
  for (const override of [{ consent: "unknown" }, { consent: "denied" }, { enabled: false }, { page: null }]) {
    const fixture = browser(t, { ...ga, ...override });
    assert.equal(fixture.window.gtag, undefined);
    assert.equal(fixture.window.document.querySelector('script[src*="googletagmanager"]'), null);
  }
  const fixture = browser(t, ga);
  const calls = Array.from(fixture.window.dataLayer, (args) => Array.from(args));
  assert.equal(calls[0][0], "consent");
  assert.equal(calls[0][2].analytics_storage, "denied");
  const setup = calls.find((call) => call[0] === "config")[2];
  assert.equal(setup.send_page_view, false);
  assert.equal(setup.allow_google_signals, false);
  assert.equal(setup.page_location, ga.gaPage.location);
  assert.equal(setup.page_referrer, "");
  assert.equal(calls.filter((call) => call[1] === "page_view").length, 1);
  fixture.window.dispatchEvent(new fixture.window.StorageEvent("storage", {
    key: "motoparts-marketing-consent", newValue: "denied",
  }));
  assert.equal(fixture.window["ga-disable-G-TEST123456"], true);
  assert.equal(fixture.window.dataLayer.at(-1)[2].analytics_storage, "denied");
});

test("GA4 purchase uses public items and a stable ID independently of Meta", (t) => {
  const gaId = "G-TEST123456";
  const purchase = { eventId: "purchase-safe", value: 100, currency: "NPR", items: [{ item_id: productId, quantity: 1 }], demo_payment: true };
  const config = { page: "receipt", gaId, gaPage: { location: "http://localhost:3000/purchase-complete", title: "Purchase status" },
    pixelId: "123456789012345", purchase };
  const first = browser(t, config);
  const calls = Array.from(first.window.dataLayer, (args) => Array.from(args));
  const event = calls.find((call) => call[1] === "purchase")[2];
  assert.equal(event.transaction_id, "purchase-safe");
  assert.equal(event.items[0].item_id, productId);
  assert.equal(first.calls().find((call) => call[1] === "Purchase")[2].items, undefined);
  const reload = browser(t, config, { [`motoparts-ga-purchase:${gaId}:purchase-safe`]: "attempted" });
  assert.equal(Array.from(reload.window.dataLayer).filter((call) => call[1] === "purchase").length, 0);
});
