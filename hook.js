// hook.js v0.5.0
// Инжектируется в MAIN world на document_start — ДО загрузки любых скриптов страницы.
// Оборачивает window.fetch и XMLHttpRequest.open, вылавливает variant_id
// из URL запросов к /-/cms/v2/lp/... и сохраняет в window.__MG_AI_VARIANT_ID__.
// Также шлёт custom event который ловит content script.

(function () {
  if (window.__MG_AI_HOOKED__) return;
  window.__MG_AI_HOOKED__ = true;
  window.__MG_AI_VARIANT_ID__ = null;

  function capture(url) {
    try {
      const u = new URL(url, location.origin);
      if (!u.pathname.includes("/-/cms/v2/lp/")) return;
      const vid = u.searchParams.get("variant_id");
      if (vid && /^\d+$/.test(vid)) {
        window.__MG_AI_VARIANT_ID__ = vid;
        window.dispatchEvent(new CustomEvent("mg-ai-variant", { detail: vid }));
      }
    } catch (e) {}
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url) capture(url);
    return origFetch.apply(this, arguments);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === "string") capture(url);
    return origOpen.apply(this, arguments);
  };

  // Ответ на запрос от content script "получи текущий variant_id"
  window.addEventListener("mg-ai-request-variant", () => {
    window.dispatchEvent(new CustomEvent("mg-ai-variant-response", {
      detail: window.__MG_AI_VARIANT_ID__,
    }));
  });
})();
