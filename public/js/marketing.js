/* Store measurement starts automatically on measured pages. */
(() => {
  "use strict";
  const element = document.getElementById("marketing-config");
  if (!element) return;
  let config;
  try { config = JSON.parse(element.textContent); } catch { return; }
  let allowed = config.enabled;
  const observed = new Set();
  const visible = new Set();
  const queue = [];
  let timer, observer;
  const debug = { mode: [config.pixelId && "meta-pixel", config.gaId && "ga4"].filter(Boolean).join("+") || "local", consent: config.consent, events: [] };
  window.motopartsMarketing = debug;

  function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* Storage can be unavailable. */ } }

  function stop() {
    allowed = false;
    debug.consent = "denied";
    queue.length = 0;
    clearTimeout(timer);
    if (observer) observer.disconnect();
    if (window.fbq) window.fbq("consent", "revoke");
    if (config.gaId) window[`ga-disable-${config.gaId}`] = true;
    if (window.gtag) window.gtag("consent", "update", { analytics_storage: "denied" });
  }
  if (!allowed || !config.page) return;

  if (config.pixelId) {
    if (!window.fbq) {
      const fbq = function () { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = "2.0";
      fbq.queue = [];
      window.fbq = fbq;
      window._fbq = fbq;
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      document.head.appendChild(script);
    }
    window.fbq("consent", "grant");
    window.fbq("set", "autoConfig", false, config.pixelId);
    window.fbq("init", config.pixelId);
  }

  if (config.gaId && config.gaPage) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window[`ga-disable-${config.gaId}`] = false;
    window.gtag("consent", "default", { analytics_storage: "denied", ad_storage: "denied",
      ad_user_data: "denied", ad_personalization: "denied" });
    window.gtag("consent", "update", { analytics_storage: "granted" });
    window.gtag("js", new Date());
    let referrer = "";
    try { referrer = new URL(document.referrer).origin; } catch { /* No external referrer. */ }
    window.gtag("config", config.gaId, { send_page_view: false, allow_google_signals: false,
      allow_ad_personalization_signals: false, page_location: config.gaPage.location,
      page_title: config.gaPage.title, page_referrer: referrer, debug_mode: Boolean(config.gaDebug) });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.gaId)}`;
    document.head.appendChild(script);
  }

  function analytics(name, data = {}) {
    if (!allowed || !config.gaId || !config.gaPage || !window.gtag) return;
    window.gtag("event", name, { ...data, send_to: config.gaId,
      page_location: config.gaPage.location, page_title: config.gaPage.title });
  }

  function pixel(type, data = {}, eventId) {
    if (!allowed || !config.pixelId || !window.fbq) return;
    const { items, ...metaData } = data;
    const standard = ["PageView", "ViewContent", "InitiateCheckout", "Purchase"].includes(type);
    window.fbq(standard ? "track" : "trackCustom", type, metaData, { eventID: eventId });
  }

  async function flush() {
    clearTimeout(timer);
    if (!allowed || !queue.length) return;
    const batch = queue.splice(0, 25);
    try {
      const response = await fetch("/marketing/events", { method: "POST", credentials: "same-origin", keepalive: true,
        headers: { "Content-Type": "application/json", "x-csrf-token": config.csrfToken }, body: JSON.stringify({ events: batch }) });
      if (response.status === 403) stop();
      else if (!response.ok) console.warn("Analytics events could not be recorded.");
    } catch { console.warn("Analytics events could not be recorded. Check your connection."); }
    if (allowed && queue.length) timer = setTimeout(flush, 50);
  }

  function track(type, targetId = "", data = {}) {
    if (!allowed) return;
    const eventId = crypto.randomUUID();
    const event = { eventId, type, targetId, page: config.page };
    debug.events.push(event);
    if (debug.events.length > 40) debug.events.shift();
    queue.push(event);
    pixel(type, data, eventId);
    clearTimeout(timer);
    timer = setTimeout(flush, 100);
  }

  track("PageView");
  analytics("page_view");
  if (config.product) analytics("view_item", { currency: "NPR", value: config.product.value,
    items: [{ item_id: config.product.id, item_name: config.product.name, price: config.product.value, quantity: 1 }] });
  if (config.page === "checkout" && config.checkout) analytics("begin_checkout", {
    currency: "NPR", value: config.checkout.value, items: config.checkout.items });
  if (config.product) track("ViewContent", config.product.id, {
    content_ids: [config.product.id], content_type: "product", value: config.product.value, currency: "NPR",
  });
  if (config.page === "checkout") track("InitiateCheckout", "", config.checkout || {});

  if (config.purchase) debug.events.push({ type: "Purchase", eventId: config.purchase.eventId, page: "receipt", value: config.purchase.value });
  if (config.purchase && config.pixelId) {
    const { eventId, ...data } = config.purchase;
    const key = `motoparts-meta-purchase:${config.pixelId}:${eventId}`;
    if (!storageGet(key)) {
      pixel("Purchase", data, eventId);
      storageSet(key, "attempted");
    }
  }

  if (config.purchase && config.gaId) {
    const { eventId, value, currency, items, test_payment } = config.purchase;
    const key = `motoparts-ga-purchase:${config.gaId}:${eventId}`;
    if (!storageGet(key)) {
      analytics("purchase", { transaction_id: eventId, value, currency, items, test_payment });
      storageSet(key, "attempted");
    }
  }

  function recordImpression(target) {
    if (!allowed || document.visibilityState !== "visible" || observed.has(target)) return;
    observed.add(target);
    const { marketingImpression: type, marketingTarget: id } = target.dataset;
    track(type, id, type === "ProductImpression" ? { content_ids: [id], content_type: "product" } : { promotion_id: id });
    if (observer) observer.unobserve(target);
  }
  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          visible.add(entry.target);
          recordImpression(entry.target);
        } else visible.delete(entry.target);
      }
    }, { threshold: 0.5 });
    document.querySelectorAll("[data-marketing-impression]").forEach((target) => observer.observe(target));
  }
  function click(event) {
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target.closest("[data-marketing-click]");
    if (!target) return;
    const { marketingClick: type, marketingTarget: id } = target.dataset;
    track(type, id, type === "ProductClick" ? { content_ids: [id], content_type: "product" } : { promotion_id: id });
    void flush(); // Keepalive lets the request finish during normal link navigation.
  }
  document.addEventListener("click", click);
  document.addEventListener("auxclick", click);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") for (const target of visible) recordImpression(target);
    else void flush();
  });
  window.addEventListener("pagehide", () => { void flush(); });
})();
