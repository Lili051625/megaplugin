// content.js v0.5.0
// Работает в ISOLATED world. Общается:
// - с hook.js в MAIN world через custom events (запрашивает variant_id)
// - с sidepanel через chrome.runtime.onMessage
// - с API ЛК через fetch

(function () {
  console.log("[MG-AI] content script v0.5.0 loaded on", location.href);

  let capturedVariantId = null;

  // Слушаем события от hook.js
  window.addEventListener("mg-ai-variant", (e) => {
    if (e.detail) {
      capturedVariantId = e.detail;
      console.log("[MG-AI] captured variant_id:", capturedVariantId);
    }
  });

  // При старте — спрашиваем у hook.js текущий variant_id (на случай если
  // hook.js уже его поймал, но мы опоздали на событие)
  function requestVariantFromHook() {
    return new Promise((resolve) => {
      const handler = (e) => {
        window.removeEventListener("mg-ai-variant-response", handler);
        resolve(e.detail || null);
      };
      window.addEventListener("mg-ai-variant-response", handler);
      window.dispatchEvent(new CustomEvent("mg-ai-request-variant"));
      setTimeout(() => {
        window.removeEventListener("mg-ai-variant-response", handler);
        resolve(null);
      }, 100);
    });
  }

  // ---------- API ЛК ----------
  function getUrlParams() {
    const u = new URL(location.href);
    return {
      ver_id: u.searchParams.get("ver_id"),
      access: u.searchParams.get("access"),
      page_id: u.searchParams.get("page_id"),
      origin: u.origin,
    };
  }

  async function getCtx() {
    // Актуализируем variant_id: если ещё не поймали, спросим у hook
    if (!capturedVariantId) {
      const fromHook = await requestVariantFromHook();
      if (fromHook) capturedVariantId = fromHook;
    }
    return {
      ...getUrlParams(),
      variant_id: capturedVariantId,
    };
  }

  async function apiGet(path, query = {}) {
    const ctx = getUrlParams();
    const params = new URLSearchParams({
      ver_id: ctx.ver_id,
      access: ctx.access,
      xhr: "1",
      rnd: String(Math.floor(Math.random() * 10000)),
      ...query,
    });
    const url = `${ctx.origin}${path}?${params.toString()}`;
    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json, text/plain, */*" },
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  }

  // Универсальная отправка form-urlencoded — поддерживает POST и PUT
  async function apiSendForm(path, { method = "POST", query = {}, formFields = {} } = {}) {
    const ctx = getUrlParams();
    const params = new URLSearchParams({
      ver_id: ctx.ver_id,
      access: ctx.access,
      xhr: "1",
      rnd: String(Math.floor(Math.random() * 10000)),
      ...query,
    });
    const url = `${ctx.origin}${path}?${params.toString()}`;
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(formFields)) {
      body.append(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: body.toString(),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  }

  // Обратная совместимость
  async function apiPostForm(path, query = {}, formFields = {}) {
    return apiSendForm(path, { method: "POST", query, formFields });
  }

  async function listBlocks(variant_id) {
    return apiGet("/-/cms/v2/lp/block/list", { variant_id });
  }

  async function saveBlockContent(variant_id, block_id, contentObj) {
    return apiPostForm(
      "/-/cms/v2/lp/block/content",
      { block_id, variant_id },
      { content: JSON.stringify(contentObj) }
    );
  }

  // ========== v1.0: загрузка HTML страницы для парсинга стилей ==========
  // Получает сырой HTML страницы по URL — для последующего парсинга в sidepanel.
  // Работает только для того же origin, что и редактор (это нам и нужно — главная сайта клиента).
  async function fetchPageHtml(url) {
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      const html = await res.text();
      return { ok: res.ok, status: res.status, html };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  // ========== v0.8: создание блоков из библиотеки ==========

  // Получить список папок библиотеки (категории блоков)
  async function listFolders(preset_id) {
    return apiGet("/-/cms/v2/lp/folder/list", { preset_id });
  }

  // Получить шаблоны блоков внутри конкретной папки
  async function listBlockLayouts(folder_id, preset_id) {
    return apiGet("/-/cms/v2/lp/block-layout/list", { folder_id, preset_id });
  }

  // Создать новый блок на странице.
  // position — число (берётся из поля position существующего блока-якоря)
  // type — "before" или "after" относительно якоря
  async function createBlock({ variant_id, layout_id, position, type }) {
    return apiSendForm("/-/cms/v2/lp/block/", {
      method: "PUT",
      query: { block_id: 0, layout_id, variant_id },
      formFields: { position: String(position), type },
    });
  }

  // ========== v1.1: сохранение CSS блоков ==========
  // Endpoint: POST /-/cms/v2/lp/block/css
  // body: form-urlencoded с одним полем "css" — JSON-строка вида
  // { "block_id": { "theme_X": { ".some-class": { "background": {...}, "font": {...} } } } }
  // Сервер мёрджит изменения с уже сохранёнными — отправлять можно частично.
  async function saveBlockCss(variant_id, cssPayload) {
    return apiSendForm("/-/cms/v2/lp/block/css", {
      method: "POST",
      query: { variant_id },
      formFields: { css: JSON.stringify(cssPayload) },
    });
  }

  // ========== v1.3: сканирование блоков из iframe редактора ==========
  // Редактор MegaGroup отображает превью страницы внутри iframe — content script
  // запущен на странице редактора, значит может получить доступ к этому iframe
  // (если он same-origin, что должно быть в нашем случае).
  //
  // Возвращает мап:
  //   { block_id: { classNames: ["...", "..."], classes: [{name, role}, ...] } }
  function scanBlocksFromEditorIframe() {
    const result = {};
    const byId = new Map(); // чтобы не дублировать блоки найденные разными способами

    // Шаг 1: ищем все iframe на странице редактора, пробуем достучаться до их DOM
    const iframes = Array.from(document.querySelectorAll("iframe"));
    let editorIframeDoc = null;

    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) continue;
        // Признак "это превью лендинга":
        // - есть элементы с data-block-id
        // - или элементы с id="block_..."
        // - или классы начинающиеся на lp-block-
        const hasBlocks =
          doc.querySelector("[data-block-id]") ||
          doc.querySelector("[id^='block_']") ||
          doc.querySelector("[class*='lp-block']") ||
          doc.querySelector("[class*='lpc-']");
        if (hasBlocks) {
          editorIframeDoc = doc;
          break;
        }
      } catch (e) {
        // cross-origin iframe — не доступен
      }
    }

    if (!editorIframeDoc) {
      return { found: false, blocks: {}, debug: `iframes: ${iframes.length}, accessible none with blocks` };
    }

    // Шаг 2: находим элементы блоков
    // Перебираем разные способы найти блок и его id
    const blockElements = [];
    const pushBlockEl = (id, el, extras = {}) => {
      if (!id || !el) return;
      const key = String(id);
      if (byId.has(key)) return;
      const item = { id: key, el, ...extras };
      byId.set(key, item);
      blockElements.push(item);
    };

    // Способ 1: data-block-id
    editorIframeDoc.querySelectorAll("[data-block-id]").forEach(el => {
      const id = el.getAttribute("data-block-id");
      if (id && /^\d+$/.test(id)) {
        pushBlockEl(id, el, {
          layoutId: el.getAttribute("data-block-layout") || null,
          source: "data-block-id",
        });
      }
    });

    // Способ 2: id="block_NNNN" или id="lp-block-NNNN"
    if (!blockElements.length) {
      editorIframeDoc.querySelectorAll("[id]").forEach(el => {
        const m = el.id.match(/^(?:block|lp-block|lpc-block)[-_](\d+)$/);
        if (m) {
          pushBlockEl(m[1], el, {
            layoutId: el.getAttribute("data-block-layout") || null,
            source: "id-pattern",
          });
        }
      });
    }

    // Способ 3: ищем элементы с классом lp-block и пытаемся найти id внутри атрибутов
    if (!blockElements.length) {
      editorIframeDoc.querySelectorAll("[class*='lp-block']").forEach(el => {
        // Ищем block_id в любых атрибутах вида data-*-id
        for (const attr of el.attributes) {
          if (/block.{0,3}id/i.test(attr.name) && /^\d+$/.test(attr.value)) {
            pushBlockEl(attr.value, el, {
              layoutId: el.getAttribute("data-block-layout") || null,
              source: "lp-block-attr",
            });
            return;
          }
        }
      });
    }

    // Способ 4: корневые lpc-блоки редактора:
    // <div class="... lpc-block ..." id="_lp_block_645419916" data-block-layout="625116" ...>
    // В таких шаблонах часто НЕТ data-block-id / block_*, поэтому используем id-паттерн _lp_block_<digits>.
    if (!blockElements.length) {
      editorIframeDoc.querySelectorAll(".lpc-block[id^='_lp_block_'], .lpc-block[data-block-layout]").forEach(el => {
        const rawId = el.getAttribute("id") || "";
        const m = rawId.match(/^_?lp[_-]block[_-](\d+)$/i);
        const extractedId = m?.[1] || null;
        const layoutId = el.getAttribute("data-block-layout") || null;

        if (extractedId) {
          pushBlockEl(extractedId, el, { layoutId, source: "lpc-block-id" });
          return;
        }

        // fallback: если id не распарсился, но есть layout — временно индексный ключ.
        // sidepanel попробует сматчить по layout_id или по порядку.
        if (layoutId && /^\d+$/.test(layoutId)) {
          const tempId = `layout_${layoutId}_${blockElements.length}`;
          pushBlockEl(tempId, el, { layoutId, source: "lpc-block-layout" });
        }
      });
    }

    // Шаг 3: для каждого блока собираем CSS-классы вложенных элементов
    for (let i = 0; i < blockElements.length; i++) {
      const { id, el, layoutId, source } = blockElements[i];
      const classSet = new Set();
      const classElements = {}; // className → пример элемента (для определения роли)

      // Собираем все элементы внутри блока, у которых есть классы lpc-* или lp-block-*
      const allInside = [el, ...el.querySelectorAll("*")];
      for (const child of allInside) {
        const classList = (child.className && typeof child.className === "string")
          ? child.className.split(/\s+/)
          : (child.classList ? Array.from(child.classList) : []);
        for (const cls of classList) {
          if (!cls) continue;
          // Берём только классы которые похожи на BEM-классы MegaGroup
          if (/^(?:lpc-|lp-block)/.test(cls)) {
            const dotted = "." + cls;
            classSet.add(dotted);
            if (!classElements[dotted]) {
              classElements[dotted] = {
                tagName: child.tagName.toLowerCase(),
                hasText: (child.textContent || "").trim().length > 0,
              };
            }
          }
        }
      }

      result[id] = {
        classNames: Array.from(classSet),
        elementsCount: allInside.length,
        layoutId: layoutId && /^\d+$/.test(layoutId) ? String(layoutId) : null,
        domIndex: i,
        source: source || "unknown",
      };
    }

    return {
      found: true,
      blocks: result,
      debug: `iframes: ${iframes.length}, accessible: yes, blockElements: ${blockElements.length}`,
    };
  }

  // ---------- Messaging ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      try {
        if (msg.type === "ctx") {
          const ctx = await getCtx();
          return sendResponse({ ok: true, ctx });
        }
        if (msg.type === "list") {
          const r = await listBlocks(msg.variant_id);
          return sendResponse(r);
        }
        if (msg.type === "saveContent") {
          const r = await saveBlockContent(msg.variant_id, msg.block_id, msg.content);
          return sendResponse(r);
        }
        // v0.8: работа с библиотекой блоков
        if (msg.type === "listFolders") {
          const r = await listFolders(msg.preset_id);
          return sendResponse(r);
        }
        if (msg.type === "listLayouts") {
          const r = await listBlockLayouts(msg.folder_id, msg.preset_id);
          return sendResponse(r);
        }
        if (msg.type === "createBlock") {
          const r = await createBlock({
            variant_id: msg.variant_id,
            layout_id: msg.layout_id,
            position: msg.position,
            type: msg.insertType,
          });
          return sendResponse(r);
        }
        // v1.0: загрузка HTML главной страницы для извлечения стилей
        if (msg.type === "fetchPageHtml") {
          const r = await fetchPageHtml(msg.url);
          return sendResponse(r);
        }
        // v1.1: сохранение CSS блоков
        if (msg.type === "saveBlockCss") {
          const r = await saveBlockCss(msg.variant_id, msg.cssPayload);
          return sendResponse(r);
        }
        // v1.3: сканирование блоков из iframe редактора
        if (msg.type === "scanBlocksFromEditor") {
          const r = scanBlocksFromEditorIframe();
          return sendResponse({ ok: true, ...r });
        }
        sendResponse({ ok: false, error: "unknown message type" });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  });
})();
