/* Lab 7: browser events stay local unless a configured Meta Pixel is consented to. */
(() => {
  "use strict";
  const element = document.getElementById("marketing-config");
  if (!element) return;
  let config;
  try { config = JSON.parse(element.textContent); } catch { return; }
  let allowed = config.enabled && config.consent === "granted";
  const observed = new Set();
  const visible = new Set();
  const queue = [];
  let timer, observer;
  const debug = { mode: config.pixelId ? "meta-pixel" : "local-demo", consent: config.consent, events: [] };
  window.motopartsMarketing = debug;

  function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* Storage can be unavailable. */ } }
  if (config.consent !== "unknown") storageSet("motoparts-marketing-consent", config.consent);

  function stop() {
    allowed = false;
    debug.consent = "denied";
    queue.length = 0;
    clearTimeout(timer);
    if (observer) observer.disconnect();
    if (window.fbq) window.fbq("consent", "revoke");
  }
  window.addEventListener("storage", (event) => {
    if (event.key === "motoparts-marketing-consent" && event.newValue === "denied") stop();
  });
  document.querySelectorAll('form[action="/marketing/consent"]').forEach((form) => {
    form.addEventListener("submit", (event) => {
      if (event.submitter?.value === "denied") {
        stop();
        storageSet("motoparts-marketing-consent", "denied");
      }
    });
  });
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

  function pixel(type, data = {}, eventId) {
    if (!allowed || !config.pixelId || !window.fbq) return;
    const standard = ["PageView", "ViewContent", "InitiateCheckout", "Purchase"].includes(type);
    window.fbq(standard ? "track" : "trackCustom", type, data, { eventID: eventId });
  }

  async function flush() {
    clearTimeout(timer);
    if (!allowed || !queue.length) return;
    const batch = queue.splice(0, 25);
    try {
      const response = await fetch("/marketing/events", { method: "POST", credentials: "same-origin", keepalive: true,
        headers: { "Content-Type": "application/json", "x-csrf-token": config.csrfToken }, body: JSON.stringify({ events: batch }) });
      if (response.status === 403) stop();
      else if (!response.ok) console.warn("Marketing demo events could not be recorded.");
    } catch { console.warn("Marketing demo events could not be recorded. Check your connection."); }
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
