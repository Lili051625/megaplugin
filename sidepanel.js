// sidepanel.js v0.9.0

const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const el = $("log");
  el.textContent += msg + "\n";
  el.scrollTop = el.scrollHeight;
};

// ================================================================
//                           ВКЛАДКИ
// ================================================================
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    openTab(target);
  });
});

function openTab(target) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === target);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${target}`);
  });
  // v1.0: обновляем превью стилевого профиля при заходе в настройки
  if (target === "settings") {
    renderStyleProfilePreview();
  }
}

document.querySelectorAll('.tab-jump').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tabJump;
    if (!target) return;
    openTab(target);
  });
});

$("expandAllBtn")?.addEventListener("click", () => {
  document.querySelectorAll('.block-item').forEach(b => b.classList.add('expanded'));
});
$("collapseAllBtn")?.addEventListener("click", () => {
  document.querySelectorAll('.block-item').forEach(b => b.classList.remove('expanded'));
});
$("clearLogBtn")?.addEventListener("click", () => {
  $("log").textContent = "Готов к работе.\n";
});

// ================================================================
//                   РЕЖИМЫ РАБОТЫ (v0.7)
// ================================================================
const MODE_CONFIGS = {
  generate: {
    label: "Техническое задание",
    placeholder: "Ниша, услуги, тон, ключевые слова, целевая аудитория...",
    hint: "Gemini сгенерирует все тексты страницы с нуля по твоему ТЗ.",
    buttonLabel: "✨ Сгенерировать всю страницу",
  },
  layout: {
    label: "Мои готовые тексты",
    placeholder: "Вставь готовые тексты. РАЗДЕЛЯЙ блоки двумя пустыми строками (3 энтера подряд) — один фрагмент = один блок страницы.\n\nТекст первого блока.\nМожет содержать заголовки\nи несколько строк.\n\n\nТекст второго блока.\n\n\nТекст третьего блока.",
    hint: "Между текстами для разных блоков — МИНИМУМ 2 пустые строки (3 энтера). Внутри одного фрагмента можно использовать обычные переносы — Gemini сам разберётся что заголовок, что описание, что список.",
    buttonLabel: "📝 Разложить мои тексты по блокам",
  },
  edits: {
    label: "Комментарии клиента / что изменить",
    placeholder: "Список правок от клиента. Например:\n- заменить \"работаем с 2010\" на \"опыт 14 лет\"\n- убрать упоминание бесплатной доставки\n- в блоке услуг добавить акцию декабря -15%\n- сделать заголовок первого экрана короче",
    hint: "Gemini прочитает текущие тексты страницы и внесёт только нужные правки, остальное не тронет. Если комментарии нечёткие — ищет по контексту.",
    buttonLabel: "✏️ Применить правки",
  },
};

let currentMode = "generate";

function setMode(mode) {
  currentMode = mode;
  const cfg = MODE_CONFIGS[mode];
  $("briefLabel").textContent = cfg.label;
  $("brief").placeholder = cfg.placeholder;
  $("briefHint").textContent = cfg.hint;
  $("fillBtn").textContent = cfg.buttonLabel;
  // Обновляем активный класс
  document.querySelectorAll('.mode-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.mode === mode);
  });
  saveSettings();
}

document.querySelectorAll('.mode-option input[type="radio"]').forEach(radio => {
  radio.addEventListener('change', () => setMode(radio.value));
});

// ================================================================
//                        НАСТРОЙКИ
// ================================================================
async function loadSettings() {
  const s = await chrome.storage.local.get([
    "apiKey", "model", "variantId", "brief", "dryRun", "draft", "mode",
    "styleSourceUrl",
    "geminiImageApiKey", "geminiImageModel",
    "xaiApiKey", "xaiImageModel", // миграция со старых ключей
  ]);
  $("apiKey").value = s.apiKey || "";
  $("model").value = s.model || "gemini-3.1-flash-lite-preview";
  $("variantId").value = s.variantId || "";
  $("brief").value = s.brief || "";
  $("dryRun").checked = s.dryRun !== false;
  if ($("styleSourceUrl")) $("styleSourceUrl").value = s.styleSourceUrl || "";
  if ($("geminiImageApiKey")) $("geminiImageApiKey").value = s.geminiImageApiKey || s.xaiApiKey || "";
  if ($("geminiImageModel")) $("geminiImageModel").value = s.geminiImageModel || "imagen-4.0-generate-001";
  draft = s.draft || {};
  setMode(s.mode || "generate");
  await loadStyleProfiles();
  await loadCssBackups();
  await loadScannedClasses();
  updateDraftUI();
}
async function saveSettings() {
  await chrome.storage.local.set({
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || "gemini-3.1-flash-lite-preview",
    variantId: $("variantId").value.trim(),
    brief: $("brief").value,
    dryRun: $("dryRun").checked,
    mode: currentMode,
    geminiImageApiKey: $("geminiImageApiKey")?.value.trim() || "",
    geminiImageModel: $("geminiImageModel")?.value.trim() || "imagen-4.0-generate-001",
  });
}
async function saveDraft() {
  await chrome.storage.local.set({ draft });
}
["apiKey", "model", "variantId", "brief", "geminiImageApiKey", "geminiImageModel"]
  .forEach((id) => $(id)?.addEventListener("input", saveSettings));
$("dryRun").addEventListener("change", saveSettings);

// ================================================================
//                  ОБЩЕНИЕ С CONTENT SCRIPT
// ================================================================
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}
async function send(msg) {
  const tabId = await getActiveTabId();
  if (!tabId) throw new Error("Нет активной вкладки");
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(resp);
    });
  });
}

// ================================================================
//                            GEMINI
// ================================================================
async function callGemini(apiKey, model, prompt, maxRetries = 3) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
      maxOutputTokens: 32000,
    },
  };
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const finishReason = data?.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== "STOP") {
        log(`  ⚠ Gemini finish reason: ${finishReason}`);
      }
      try { return JSON.parse(text); }
      catch { throw new Error("Gemini вернул не-JSON: " + text.slice(0, 200)); }
    }
    const t = await res.text();
    lastErr = `Gemini ${res.status}: ${t.slice(0, 200)}`;
    if (res.status === 503 || res.status === 429 || res.status === 500) {
      if (attempt < maxRetries) {
        const wait = attempt * 10000;
        log(`  ⏳ ${res.status}, попытка ${attempt}/${maxRetries}, ждём ${wait/1000}с...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
    }
    throw new Error(lastErr);
  }
  throw new Error(lastErr);
}

// ================================================================
//                     ТИПИЗАЦИЯ БЛОКОВ
// ================================================================
const BLOCK_TYPE_HINTS = {
  hero: `HERO-блок (первый экран). Короткое сильное утверждение о главной выгоде. Без воды.`,
  services: `Блок УСЛУГИ/ПРОДУКТЫ. Каждая услуга — конкретная польза, "что делаем → результат для бизнеса".`,
  advantages: `Блок ПРЕИМУЩЕСТВА. Короткие тезисы с конкретикой и цифрами.`,
  steps: `Блок СХЕМА РАБОТЫ / ЭТАПЫ. Глаголы действия, чёткая последовательность.`,
  reviews: `Блок ОТЗЫВЫ. Живой разговорный язык от первого лица, конкретика.`,
  faq: `Блок FAQ. Реальные вопросы клиентов, прямые ответы без маркетинга.`,
  cta: `Блок CTA. Один чёткий призыв. Что получит клиент ПОСЛЕ клика.`,
  form: `Блок ФОРМЫ. Заголовок — обещание результата. Текст — что дальше.`,
  contacts: `Блок КОНТАКТЫ. Минимум маркетинга, только факты.`,
  text: `Текстовый блок. Полезная информация, экспертиза, детали.`,
  partners: `Блок ПАРТНЁРЫ. Короткое вступление о доверии.`,
  staff: `Блок КОМАНДА. Короткие профили: имя, роль, что делает.`,
  generic: `Универсальный блок. Пишите по смыслу названия.`,
};

function detectBlockType(block) {
  const name = (block.name || "").toLowerCase();
  const dj = block.data_json || {};
  const fieldKeys = Object.keys(dj);
  if (fieldKeys.some(k => /review|quote|author/i.test(k))) return "reviews";
  if (fieldKeys.some(k => /question|answer|faq/i.test(k))) return "faq";
  if (fieldKeys.some(k => /step|stage/i.test(k))) return "steps";
  if (/hero|главн|первый экран|баннер|шапк/.test(name)) return "hero";
  if (/услуг|продук|товар|карточк|каталог/.test(name)) return "services";
  if (/преимуществ|почему|выгод|особенност/.test(name)) return "advantages";
  if (/схема|этап|шаг|процесс|как работа/.test(name)) return "steps";
  if (/отзыв|мнен|клиент|благодарност/.test(name)) return "reviews";
  if (/вопрос|ответ|faq|чаво|частые/.test(name)) return "faq";
  if (/форм|заявк|обратн/.test(name)) return "form";
  if (/контакт|адрес|карт/.test(name)) return "contacts";
  if (/призыв|cta|узна|закаж|получ/.test(name)) return "cta";
  if (/партн|бренд/.test(name)) return "partners";
  if (/сотрудник|команд|специалист|персонал/.test(name)) return "staff";
  if (/текст|опис/.test(name)) return "text";
  return "generic";
}

// ================================================================
//                    УТИЛИТЫ ДЛЯ ПОЛЕЙ
// ================================================================
function ruName(name) {
  if (name == null) return "";
  if (typeof name === "string") return name;
  if (typeof name === "object") return name.ru || name.en || "";
  return String(name);
}

const DANGEROUS_FIELD_PATTERNS = [
  /^price$/i, /oldprice/i, /^cost$/i,
  /link/i, /^url$/i, /href/i,
  /phone/i, /^tel$/i, /email/i, /^mail$/i,
  /video/i, /^map$/i, /coords/i,
];
function isDangerousField(key) {
  return DANGEROUS_FIELD_PATTERNS.some(re => re.test(key));
}

function isRepeatingMeta(def) {
  if (!def || def.type !== "meta") return false;
  if (!def.value || typeof def.value !== "object") return false;
  const subFields = Object.values(def.value);
  return subFields.some(v => v && typeof v === "object" && typeof v.type === "string");
}

function extractItemSchema(metaDef) {
  const schema = {};
  const skipped = [];
  for (const [key, subDef] of Object.entries(metaDef.value || {})) {
    if (!subDef || typeof subDef !== "object" || typeof subDef.type !== "string") continue;
    if (subDef.type !== "html" && subDef.type !== "text") continue;
    if (isDangerousField(key)) { skipped.push(key); continue; }
    schema[key] = {
      name: ruName(subDef.name) || key,
      type: subDef.type,
      maxlength: subDef.maxlength || null,
    };
  }
  return { schema, skipped };
}

function extractEditableFields(block) {
  const dj = block.data_json || {};
  const dv = block.data || {};
  const flat = {};
  const lists = {};
  const skippedFlat = [];
  const skippedInLists = [];

  for (const [key, def] of Object.entries(dj)) {
    if (!def || typeof def !== "object") continue;
    if (def.type === "html" || def.type === "text") {
      if (isDangerousField(key)) { skippedFlat.push(key); continue; }
      flat[key] = {
        name: ruName(def.name) || key,
        type: def.type,
        maxlength: def.maxlength || null,
        current: (dv[key] != null ? String(dv[key]) : ""),
      };
      continue;
    }
    if (isRepeatingMeta(def)) {
      const { schema, skipped } = extractItemSchema(def);
      if (Object.keys(schema).length === 0) continue;
      const currentItems = Array.isArray(dv[key]) ? dv[key] : [];
      lists[key] = {
        name: ruName(def.name) || key,
        itemSchema: schema,
        itemsCount: currentItems.length,
        currentItems,
      };
      if (skipped.length) skippedInLists.push(...skipped.map(s => `${key}.${s}`));
      continue;
    }
  }
  return { flat, lists, skippedFlat, skippedInLists };
}

function hasAnythingEditable({ flat, lists }) {
  return Object.keys(flat).length > 0 || Object.keys(lists).length > 0;
}

function describeBlockFields({ flat, lists }, overrideItemCounts = {}, hideMaxlength = false) {
  const lines = [];
  for (const [k, f] of Object.entries(flat)) {
    const lim = (!hideMaxlength && f.maxlength) ? ` (макс ${f.maxlength} символов)` : "";
    lines.push(`    * "${k}" — ${f.name}${lim} [${f.type}]`);
  }
  for (const [listKey, listDef] of Object.entries(lists)) {
    const count = overrideItemCounts[listKey] != null ? overrideItemCounts[listKey] : listDef.itemsCount;
    lines.push(`    * "${listKey}" — ${listDef.name} [СПИСОК из ${count} элементов, каждый содержит:]`);
    for (const [sk, sf] of Object.entries(listDef.itemSchema)) {
      const lim = (!hideMaxlength && sf.maxlength) ? ` (макс ${sf.maxlength} символов)` : "";
      lines.push(`        - "${sk}" — ${sf.name}${lim} [${sf.type}]`);
    }
  }
  return lines.join("\n");
}

// Описание текущих значений блока (для режимов layout и edits)
function describeCurrentValues(block) {
  const { flat, lists } = extractEditableFields(block);
  const lines = [];
  for (const [k, f] of Object.entries(flat)) {
    const val = (f.current || "").replace(/<[^>]+>/g, "").trim();
    if (val) lines.push(`    "${k}" = ${JSON.stringify(val.slice(0, 500))}`);
    else lines.push(`    "${k}" = (пусто)`);
  }
  for (const [listKey, listDef] of Object.entries(lists)) {
    lines.push(`    "${listKey}" = список из ${listDef.currentItems.length} элементов:`);
    listDef.currentItems.slice(0, 10).forEach((item, idx) => {
      const preview = Object.entries(item)
        .filter(([k]) => listDef.itemSchema[k])
        .map(([k, v]) => `${k}: ${JSON.stringify(String(v || "").replace(/<[^>]+>/g, "").slice(0, 200))}`)
        .join(", ");
      lines.push(`      [${idx}] { ${preview} }`);
    });
  }
  return lines.join("\n");
}

function buildContentForSave(block, generated) {
  const base = { ...(block.data || {}) };
  delete base.json;
  delete base.json_large;
  delete base.meta_id;
  delete base.parent;

  const { flat, lists } = extractEditableFields(block);

  for (const [k, v] of Object.entries(generated)) {
    if (flat[k]) {
      base[k] = String(v);
      continue;
    }
    if (lists[k] && Array.isArray(v)) {
      const currentItems = Array.isArray(base[k]) ? base[k] : [];
      const newItems = [];
      const schema = lists[k].itemSchema;
      for (let i = 0; i < v.length; i++) {
        const genItem = v[i] || {};
        const baseItem = currentItems[i] ? { ...currentItems[i] } : {};
        for (const [sk] of Object.entries(schema)) {
          if (genItem[sk] != null) {
            baseItem[sk] = String(genItem[sk]);
          }
        }
        newItems.push(baseItem);
      }
      base[k] = newItems;
    }
  }
  return base;
}

// ================================================================
//                          ПРОМПТЫ
// ================================================================
const GLOBAL_RULES = `ОБЩИЕ ПРАВИЛА:
- Продающий, экспертный тон без воды.
- Никакой выдумки — опирайся только на данные.
- Строго соблюдай maxlength полей.
- html-поля могут содержать <p>, <strong>, <em>. Заголовки — без html.
- SEO: ключи из контекста вписываются естественно.
- Запрещённые слова: "бесшовно", "инновационный", "передовой", "ключевой игрок", "уникальное решение", "leverage", "seamlessly", "results-driven", "качественно и профессионально".`;

// Режим GENERATE — генерация с нуля
function buildPagePromptGenerate(brief, blocksData) {
  const blocksDesc = blocksData.map((b, i) => {
    const hint = BLOCK_TYPE_HINTS[b.type] || BLOCK_TYPE_HINTS.generic;
    const fieldsDesc = describeBlockFields(b.parsed);
    return `  Блок ${i + 1}: "${b.name}" [тип: ${b.type}] (id: ${b.block_id})
    Инструкция: ${hint}
    Поля:
${fieldsDesc}`;
  }).join("\n\n");

  return `Ты — опытный SEO-копирайтер. Пишешь текст для лендинга как единое произведение со сквозной логикой.

ТЗ ОТ КЛИЕНТА:
${brief}

СТРУКТУРА СТРАНИЦЫ (${blocksData.length} блоков):

${blocksDesc}

${GLOBAL_RULES}

ЗАДАЧА:
Сгенерируй связный текст для ВСЕХ блоков. Блоки работают вместе: заголовки не повторяются, стиль сквозной, логика ведёт от первого блока к последнему.

ДЛЯ БЛОКОВ СО СПИСКАМИ: сохраняй указанное количество элементов в списке.

ОТВЕТ — строго JSON вида:
{
  "635034516": { "title": "...", "text": "..." },
  "637453516": { "title": "...", "desc": "...", "questions_list": [{"question": "...", "answer": "..."}] }
}
Ключи — block_id. Верни ВСЕ ${blocksData.length} блоков.`;
}

// Разбивает текст клиента на фрагменты ТОЛЬКО по тройным переносам строк
// (то есть минимум 2 пустые строки между блоками).
// Одиночные и двойные переносы остаются ВНУТРИ фрагмента — это заголовки,
// подзаголовки, списки, пункты блока и т.п. Gemini сам разберётся что куда в подполях.
function splitUserTextIntoChunks(text) {
  if (!text) return [];
  // \n\n\n и больше — разделитель между блоками (3+ переноса = 2+ пустые строки)
  const rawChunks = text.split(/\n{3,}/).map(s => s.trim()).filter(Boolean);
  return rawChunks;
}

// Режим LAYOUT — раскладка готовых текстов
function buildPagePromptLayout(userTexts, blocksData) {
  // Разбиваем текст клиента на пронумерованные фрагменты
  const chunks = splitUserTextIntoChunks(userTexts);
  const numberedChunks = chunks.length > 1
    ? chunks.map((c, i) => `--- ФРАГМЕНТ ${i + 1} ---\n${c}`).join("\n\n")
    : userTexts;

  const blocksDesc = blocksData.map((b, i) => {
    const hint = BLOCK_TYPE_HINTS[b.type] || BLOCK_TYPE_HINTS.generic;
    // ВАЖНО: в режиме layout скрываем maxlength чтобы Gemini не переписывал тексты короче
    const fieldsDesc = describeBlockFields(b.parsed, {}, true);
    return `  БЛОК №${i + 1}: "${b.name}" [тип: ${b.type}] (id: ${b.block_id})
    Назначение: ${hint}
    Поля блока:
${fieldsDesc}`;
  }).join("\n\n");

  return `Ты — редактор, распределяющий готовые тексты по блокам лендинга. ТВОЯ ГЛАВНАЯ ЗАДАЧА — дословно разложить тексты клиента по блокам СТРОГО В ТОМ ПОРЯДКЕ в котором клиент их написал.

🔒🔒🔒 АБСОЛЮТНЫЙ ЗАКОН: НЕ ПЕРЕПИСЫВАЙ ТЕКСТЫ КЛИЕНТА 🔒🔒🔒

Это не совет, это железное правило. Клиент потратил время на написание этих текстов и хочет видеть их ДОСЛОВНО на сайте. Любое перефразирование, "улучшение", "сокращение для влезания", замена слов на синонимы — ЗАПРЕЩЕНО.

Что можно делать с текстом клиента:
✅ Копировать слово в слово
✅ Оборачивать абзацы в <p>...</p> для html-полей
✅ Исправлять очевидные опечатки (не больше 2-3 букв)

Что НЕЛЬЗЯ делать:
❌ Перефразировать, даже «слегка»
❌ Сокращать предложения
❌ Менять порядок слов
❌ Заменять одни слова другими («помогаю» → «решаю задачи»)
❌ Убирать части предложения «чтобы влезло»
❌ Добавлять свои слова, связки, переходы
❌ «Улучшать стиль»

ГОТОВЫЕ ТЕКСТЫ ОТ КЛИЕНТА (${chunks.length} фрагментов в порядке расположения):

${numberedChunks}

СТРУКТУРА СТРАНИЦЫ (${blocksData.length} блоков в порядке сверху вниз):

${blocksDesc}

🔒 ВТОРОЙ ЗАКОН — МАТЧИНГ ПО ПОРЯДКУ 1-В-1:

ФРАГМЕНТ 1 → БЛОК №1 (если подходит, иначе БЛОК №2)
ФРАГМЕНТ 2 → следующий блок ПОСЛЕ того куда ушёл ФРАГМЕНТ 1
ФРАГМЕНТ 3 → следующий блок ПОСЛЕ ФРАГМЕНТА 2
...

Один фрагмент = один блок. Весь текст внутри фрагмента относится к одному блоку — не разделяй фрагмент между блоками.

❌ Запрещено брать ФРАГМЕНТ 5 и класть его в БЛОК №2, игнорируя порядок.
❌ Запрещено переставлять фрагменты по «смыслу» или «названию блока».

🔒 ТРЕТИЙ ЗАКОН — ПУСТОТА ВАЖНЕЕ ВЫДУМКИ:

Если для какого-то поля блока в твоём фрагменте НЕТ подходящего контента — ПРОСТО НЕ ВКЛЮЧАЙ это поле в ответ. Не выдумывай короткую фразу чтобы заполнить пустоту. Не бери «что-то похожее» из другого фрагмента. Пусть поле останется как было.

Примеры правильного поведения:
- В блоке есть поля title, text, alt. Во фрагменте есть длинный абзац. → Положи абзац в text. title и alt не упоминай в ответе.
- В блоке есть поле questions_list на 4 элемента. Во фрагменте есть только 2 вопроса-ответа. → Верни список из 2 элементов. Не выдумывай ещё 2.
- В блоке есть поле desc (краткое описание). Во фрагменте нет короткого описания, только большой текст. → Положи текст в text, поле desc оставь пустым (не упоминай в ответе).

АЛГОРИТМ РАБОТЫ:
1. Для каждого фрагмента по очереди:
2. Найди подходящий блок (двигаясь сверху вниз, не перепрыгивая).
3. Внутри блока распредели текст фрагмента по полям:
   - Явный заголовок короткой строкой сверху фрагмента → в title (если есть)
   - Абзацы с описанием → в text или desc (чем бы ни называлось основное текстовое поле)
   - Маркированные или пронумерованные списки → в поля-списки если они есть
   - Подзаголовки каждого пункта списка (короткие строки) → в подполе title каждого элемента
   - Описания каждого пункта → в подполе text/answer/desc каждого элемента
4. Не влезло в одно поле — перенеси остаток в соседнее поле того же блока.
5. Нечего класть в какое-то поле — не упоминай его.
6. Нечего класть вообще в весь блок — не включай блок в ответ.

О ДЛИНЕ ТЕКСТОВ:
MegaGroup корректно обрабатывает тексты разной длины. Не беспокойся об "умещении" — твоя задача сохранить текст дословно, а длина решается позже пользователем вручную при необходимости. НИКОГДА не сокращай и не перефразируй ради длины.

ОТВЕТ — строго JSON. Только те поля и блоки которые заполнил:
{
  "635034516": { "title": "...", "text": "..." },
  "637453516": { "title": "...", "desc": "..." }
}
Ключи в JSON идут в том же порядке что и блоки на странице. Никаких пояснений вне JSON.`;
}

// Режим EDITS — точечные правки по комментариям клиента
function buildPagePromptEdits(comments, blocksData) {
  const blocksDesc = blocksData.map((b, i) => {
    const fieldsDesc = describeBlockFields(b.parsed);
    const currentValues = describeCurrentValues(b.block);
    return `  Блок ${i + 1}: "${b.name}" [тип: ${b.type}] (id: ${b.block_id})
    Поля блока:
${fieldsDesc}
    ТЕКУЩЕЕ СОДЕРЖИМОЕ:
${currentValues}`;
  }).join("\n\n");

  return `Ты — редактор текстов лендинга. Клиент прислал комментарии с правками. ТВОЯ ЗАДАЧА — внести ТОЛЬКО указанные правки в существующие тексты, ничего больше не менять.

КОММЕНТАРИИ КЛИЕНТА / ПРАВКИ:
${comments}

ТЕКУЩИЕ ТЕКСТЫ ВСЕЙ СТРАНИЦЫ (${blocksData.length} блоков):

${blocksDesc}

ПРИНЦИП: решения принимаются НА УРОВНЕ ПОЛЕЙ, а не блоков.
- Для каждого поля каждого блока реши: затрагивают ли его правки клиента?
- Если да — верни это поле в ответе с новым значением.
- Если нет — просто не упоминай его в ответе (оно останется как было).
- Если в блоке затронуто хотя бы одно поле — включи блок в ответ с этим полем.
- Если в блоке ни одно поле не затронуто — не включай блок совсем.

СТРОГИЕ ПРАВИЛА ПРАВОК:
1. НЕ ПЕРЕПИСЫВАЙ тексты целиком. Не "улучшай", не "делай продающее", не меняй стиль. Меняй ТОЛЬКО то что явно указано в комментариях.
2. Сохраняй все слова и фразы клиента которые не упомянуты в правках — СЛОВО В СЛОВО.
3. Если комментарий указывает на конкретную фразу — найди её в любом блоке страницы и замени.
4. Если комментарий нечёткий (например "сделайте бодрее" или "про скидку добавьте") — ИЩИ ПО КОНТЕКСТУ куда именно это применить. Клиенты часто пишут расплывчато, твоя работа — угадать смысл.
5. ВАЖНО: если меняешь поле — верни ПОЛНОЕ новое значение поля целиком (не только изменённый фрагмент).
6. Для списков: если правишь один элемент — верни ВЕСЬ список с изменённым элементом на своём месте.
7. Соблюдай maxlength.
8. Если ни в одном поле страницы нет того что нужно исправить — верни пустой объект {}.

ПРИМЕР:
Комментарий: "замените '20 лет опыта' на '25 лет опыта'"
Если в блоке hero поле text содержит "<p>Мы работаем уже 20 лет опыта, делаем отлично</p>"
Ответ: { "635034516": { "text": "<p>Мы работаем уже 25 лет опыта, делаем отлично</p>" } }
Если поле title того же блока не затрагивается — не включай его в ответ.

ОТВЕТ — строго JSON с затронутыми блоками и только затронутыми полями:
{
  "635034516": { "text": "..." }
}
Никаких пояснений вне JSON.`;
}

// Промпт для одного блока (режим генерации)
function buildSingleBlockPrompt(globalBrief, blockBrief, blockData, overrideItemCounts) {
  const hint = BLOCK_TYPE_HINTS[blockData.type] || BLOCK_TYPE_HINTS.generic;
  const fieldsDesc = describeBlockFields(blockData.parsed, overrideItemCounts);

  const briefSection = blockBrief
    ? `ОБЩЕЕ ТЗ (контекст):\n${globalBrief || "(не задано)"}\n\nЗАДАЧА ДЛЯ ЭТОГО БЛОКА (приоритет):\n${blockBrief}`
    : `ТЗ:\n${globalBrief}`;

  return `Ты — опытный SEO-копирайтер. Пишешь текст для одного блока лендинга.

${briefSection}

БЛОК: "${blockData.name}" [тип: ${blockData.type}]
Инструкция: ${hint}

ПОЛЯ:
${fieldsDesc}

${GLOBAL_RULES}

ДЛЯ ПОЛЕЙ-СПИСКОВ: верни ровно указанное количество элементов.

ОТВЕТ — строго JSON с полями блока:
{
  "имя_поля_1": "значение",
  "имя_списка": [{"sub_field": "значение"}]
}`;
}

// Промпт для перегенерации ОДНОГО поля блока (новое в v0.7)
function buildSingleFieldPrompt(globalBrief, blockData, fieldKey, fieldMeta, currentValue, userInstruction) {
  const isListField = !!blockData.parsed.lists[fieldKey];
  const fieldDesc = isListField
    ? `Поле "${fieldKey}" — ${fieldMeta.name} [СПИСОК, сейчас ${fieldMeta.itemsCount} элементов]`
    : `Поле "${fieldKey}" — ${fieldMeta.name}${fieldMeta.maxlength ? ` (макс ${fieldMeta.maxlength})` : ""} [${fieldMeta.type}]`;

  const currentTxt = isListField
    ? JSON.stringify(currentValue, null, 2).slice(0, 2000)
    : String(currentValue || "").slice(0, 2000);

  return `Ты — SEO-копирайтер. Нужно переписать ОДНО конкретное поле блока.

Контекст страницы:
${globalBrief || "(не задано)"}

Блок: "${blockData.name}" [тип: ${blockData.type}]

${fieldDesc}

Текущее значение:
${currentTxt}

${userInstruction ? `Инструкция пользователя:\n${userInstruction}\n` : "Просто сгенерируй новый вариант этого поля, сохраняя общий смысл но в другой формулировке.\n"}

${GLOBAL_RULES}

ОТВЕТ — строго JSON:
${isListField
  ? `{ "${fieldKey}": [{"sub": "value"}, ...] }`
  : `{ "${fieldKey}": "новое значение" }`}
Только одно поле. Никаких пояснений.`;
}

// ================================================================
//                     СОСТОЯНИЕ И ЧЕРНОВИК
// ================================================================
let loadedBlocks = [];
let draft = {};
// v0.8: контекст страницы для работы с библиотекой блоков
let pagePresetId = null;
let pageOrigin = null;

function draftCount() { return Object.keys(draft).length; }

function updateDraftUI() {
  const count = draftCount();
  $("draftCount").textContent = count;
  const bar = $("draftBar");
  const hint = $("draftHint");
  if (count > 0) {
    bar.classList.add("has-draft");
    hint.textContent = "готово к применению";
    hint.style.color = "#059669";
  } else {
    bar.classList.remove("has-draft");
    hint.textContent = "пусто";
    hint.style.color = "#94a3b8";
  }
  renderBlocks();
}

// ================================================================
//                      ЗАГРУЗКА БЛОКОВ
// ================================================================
$("loadBtn").addEventListener("click", async () => {
  try {
    await saveSettings();
    if (!$("variantId").value.trim()) {
      await tryAutoVariant(false);
    }
    const variant_id = $("variantId").value.trim();
    if (!variant_id) {
      log("⚠️ variant_id не определён. Обнови страницу редактора (F5) и нажми «🔍 Авто».");
      return;
    }
    log("→ запрашиваю список блоков...");
    const r = await send({ type: "list", variant_id });
    if (!r?.ok) return log("✗ ошибка: " + JSON.stringify(r).slice(0, 300));
    const items = r.data?.result?.blocks || r.data?.result || r.data?.blocks || [];
    loadedBlocks = Array.isArray(items) ? items : [];
    // Сортируем блоки по position — так они идут на странице сверху вниз.
    loadedBlocks.sort((a, b) => {
      const pa = parseInt(a.position, 10) || 0;
      const pb = parseInt(b.position, 10) || 0;
      return pa - pb;
    });

    // v0.8: запоминаем preset_id и origin из первого блока (нужно для библиотеки)
    if (loadedBlocks.length > 0) {
      pagePresetId = loadedBlocks[0].preset_id || null;
      // origin берём из ctx content script
      try {
        const ctxR = await send({ type: "ctx" });
        pageOrigin = ctxR?.ctx?.origin || null;
      } catch {}
    }

    log(`← получено блоков: ${loadedBlocks.length} (отсортированы по порядку на странице)`);
    if (pagePresetId) log(`  preset_id страницы: ${pagePresetId}`);
    renderBlocks();
    $("fillBtn").disabled = loadedBlocks.length === 0;
    $("addBlockBtn").disabled = !pagePresetId;
    const presetsBtn = $("presetsBtn");
    if (presetsBtn) presetsBtn.disabled = !pagePresetId;
    // v1.0: обновляем превью стилевого профиля (теперь знаем origin клиента)
    renderStyleProfilePreview();
  } catch (e) {
    log("✗ " + e.message);
  }
});

async function tryAutoVariant(verbose = true) {
  try {
    const r = await send({ type: "ctx" });
    const vid = r?.ctx?.variant_id;
    if (vid) {
      $("variantId").value = vid;
      await saveSettings();
      if (verbose) log(`✓ variant_id определён: ${vid}`);
      return true;
    } else {
      if (verbose) log("⚠ variant_id не перехвачен. Обнови страницу редактора (F5).");
      return false;
    }
  } catch (e) {
    if (verbose) log("✗ автоопределение: " + e.message);
    return false;
  }
}
$("autoVariantBtn").addEventListener("click", () => tryAutoVariant(true));

// ================================================================
//                    ОТРИСОВКА СПИСКА БЛОКОВ
// ================================================================
function escape_(s) { return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

function pluralFields(n) {
  if (n === 0) return "полей";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "поле";
  if ([2,3,4].includes(mod10) && ![12,13,14].includes(mod100)) return "поля";
  return "полей";
}

function renderBlocks() {
  const wrap = $("blocks");
  const countEl = $("blocksCount");
  const actionsEl = $("blocksActions");

  if (!loadedBlocks.length) {
    wrap.innerHTML = `
      <div class="empty">
        <div class="empty-icon">📋</div>
        <div class="empty-text">Нажми «Загрузить блоки» чтобы начать</div>
      </div>
    `;
    if (countEl) countEl.textContent = "";
    if (actionsEl) actionsEl.style.display = "none";
    return;
  }

  if (countEl) countEl.textContent = `${loadedBlocks.length} шт`;
  if (actionsEl) actionsEl.style.display = "flex";

  wrap.innerHTML = "";

  // v0.8: плюсик перед самым первым блоком (вставка в начало)
  if (loadedBlocks.length > 0 && pagePresetId) {
    const slot = document.createElement("div");
    slot.className = "insert-slot";
    slot.innerHTML = `<button title="Вставить блок сюда" data-insert-before="${loadedBlocks[0].block_id}">+</button>`;
    wrap.appendChild(slot);
  }

  loadedBlocks.forEach((b, i) => {
    const div = document.createElement("div");
    div.className = "block-item";
    div.dataset.bid = b.block_id;

    const name = b.name || `Блок #${i + 1}`;
    const parsed = extractEditableFields(b);
    const type = detectBlockType(b);

    const flatNames = Object.values(parsed.flat).map(f => f.name);
    const listNames = Object.entries(parsed.lists).map(([k, l]) => `${l.name} (×${l.itemsCount})`);
    const allNames = [...flatNames, ...listNames];
    const fieldsText = allNames.join(", ") || "(нет редактируемых полей)";

    const allSkipped = [...parsed.skippedFlat, ...parsed.skippedInLists];
    const skippedLine = allSkipped.length
      ? `<div class="block-skipped">⚠ пропущено: ${escape_(allSkipped.join(", "))}</div>`
      : "";

    const hasDraft = !!draft[b.block_id];
    if (hasDraft) div.classList.add("has-draft");
    const hasLists = Object.keys(parsed.lists).length > 0;

    const badges = [];
    badges.push(`<span class="block-badge badge-type">${escape_(type)}</span>`);
    if (hasLists) badges.push(`<span class="block-badge badge-list">список</span>`);
    if (hasDraft) badges.push(`<span class="block-badge badge-draft">✓ черновик</span>`);

    // Редактируемое превью черновика
    const draftEditor = hasDraft ? renderDraftEditor(b, parsed) : "";

    const canGenerate = hasAnythingEditable(parsed);
    const listsHint = hasLists
      ? `<div class="block-hint-list">💡 Можно указать количество: "сделай 5 элементов", "нужно 3 вопроса"</div>`
      : "";

    div.innerHTML = `
      <div class="block-header" data-action="toggle">
        <span class="block-chevron">▶</span>
        <div class="block-main">
          <div class="block-name">${escape_(name)}</div>
          <div class="block-meta">${allNames.length} ${pluralFields(allNames.length)}</div>
        </div>
        <div class="block-badges">${badges.join("")}</div>
      </div>
      <div class="block-body">
        <div class="block-fields">
          <div class="block-fields-title">Поля для генерации</div>
          ${escape_(fieldsText)}
          ${skippedLine}
        </div>
        ${canGenerate ? `
          ${listsHint}
          <textarea class="block-brief" data-bid="${b.block_id}" placeholder="Индивидуальное ТЗ для этого блока (необязательно)"></textarea>
          <div class="block-actions">
            <button class="secondary small-btn" data-action="gen-single" data-bid="${b.block_id}">✨ Только этот</button>
            ${hasDraft ? `<button class="danger small-btn" data-action="drop-draft" data-bid="${b.block_id}">✕ Из черновика</button>` : ""}
          </div>
        ` : ""}
        ${draftEditor}
      </div>
    `;
    wrap.appendChild(div);

    // v0.8: плюсик после блока (вставка между этим и следующим, или в конец)
    if (pagePresetId) {
      const slot = document.createElement("div");
      slot.className = "insert-slot";
      slot.innerHTML = `<button title="Вставить блок сюда" data-insert-after="${b.block_id}">+</button>`;
      wrap.appendChild(slot);
    }
  });

  // Обработчики
  wrap.querySelectorAll('.block-header[data-action="toggle"]').forEach(h => {
    h.addEventListener('click', (e) => {
      if (e.target.closest('.block-body')) return;
      h.closest('.block-item').classList.toggle('expanded');
    });
  });
  wrap.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onBlockAction(e);
    });
  });
  // Обработчики автосохранения редактируемого превью
  wrap.querySelectorAll('textarea[data-draft-field]').forEach(ta => {
    ta.addEventListener('input', onDraftFieldInput);
  });
  wrap.querySelectorAll('textarea[data-draft-list-item]').forEach(ta => {
    ta.addEventListener('input', onDraftListItemInput);
  });

  // v0.8: обработчики плюсиков вставки блоков
  wrap.querySelectorAll('button[data-insert-before]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openLibraryModal({ anchorBlockId: btn.dataset.insertBefore, insertType: "before" });
    });
  });
  wrap.querySelectorAll('button[data-insert-after]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openLibraryModal({ anchorBlockId: btn.dataset.insertAfter, insertType: "after" });
    });
  });
}

// Рендер редактируемого превью черновика
function renderDraftEditor(block, parsed) {
  const d = draft[block.block_id];
  if (!d) return "";
  const blockId = block.block_id;

  const fieldsHtml = [];
  for (const [k, v] of Object.entries(d.fields)) {
    if (Array.isArray(v)) {
      // Список — каждый элемент отдельно
      const listDef = parsed.lists[k];
      if (!listDef) continue;
      const itemsHtml = v.map((item, idx) => {
        const subHtml = Object.entries(item).map(([sk, sv]) => {
          const subMeta = listDef.itemSchema[sk];
          if (!subMeta) return "";
          return `
            <div class="draft-list-subfield">
              <div class="draft-list-subfield-label">${escape_(subMeta.name)}</div>
              <textarea
                data-draft-list-item
                data-bid="${blockId}"
                data-list-key="${k}"
                data-item-idx="${idx}"
                data-sub-key="${sk}"
              >${escape_(String(sv))}</textarea>
            </div>
          `;
        }).join("");
        return `
          <div class="draft-list-item">
            <div class="draft-list-item-title">
              <span>#${idx + 1}</span>
            </div>
            ${subHtml}
          </div>
        `;
      }).join("");

      fieldsHtml.push(`
        <div class="draft-field">
          <div class="draft-field-header">
            <div class="draft-field-name">${escape_(listDef.name)} (${v.length} шт)</div>
            <div class="draft-field-actions">
              <button class="secondary tiny-btn" data-action="regen-field" data-bid="${blockId}" data-field="${k}">🔄 Перегенерировать</button>
              <button class="danger tiny-btn" data-action="reset-field" data-bid="${blockId}" data-field="${k}">✕ Сброс</button>
            </div>
          </div>
          ${itemsHtml}
        </div>
      `);
    } else {
      // Простое поле
      const meta = parsed.flat[k];
      if (!meta) continue;
      const isLong = String(v).length > 150 || meta.type === "html";
      fieldsHtml.push(`
        <div class="draft-field">
          <div class="draft-field-header">
            <div class="draft-field-name">${escape_(meta.name)}${meta.maxlength ? ` (макс ${meta.maxlength})` : ""}</div>
            <div class="draft-field-actions">
              <button class="secondary tiny-btn" data-action="regen-field" data-bid="${blockId}" data-field="${k}">🔄 Перегенерировать</button>
              <button class="danger tiny-btn" data-action="reset-field" data-bid="${blockId}" data-field="${k}">✕ Сброс</button>
            </div>
          </div>
          <textarea
            class="${isLong ? 'tall' : ''}"
            data-draft-field
            data-bid="${blockId}"
            data-field="${k}"
          >${escape_(String(v))}</textarea>
        </div>
      `);
    }
  }

  return `
    <div class="draft-editor">
      <div class="draft-editor-title">📝 Черновик (можно редактировать)</div>
      ${fieldsHtml.join("")}
    </div>
  `;
}

// Автосохранение при редактировании простого поля
async function onDraftFieldInput(e) {
  const ta = e.target;
  const bid = ta.dataset.bid;
  const field = ta.dataset.field;
  if (!draft[bid]) return;
  draft[bid].fields[field] = ta.value;
  await saveDraft();
}

// Автосохранение при редактировании элемента списка
async function onDraftListItemInput(e) {
  const ta = e.target;
  const bid = ta.dataset.bid;
  const listKey = ta.dataset.listKey;
  const itemIdx = parseInt(ta.dataset.itemIdx, 10);
  const subKey = ta.dataset.subKey;
  if (!draft[bid] || !Array.isArray(draft[bid].fields[listKey])) return;
  if (!draft[bid].fields[listKey][itemIdx]) return;
  draft[bid].fields[listKey][itemIdx][subKey] = ta.value;
  await saveDraft();
}

async function onBlockAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const bid = btn.dataset.bid;

  if (action === "gen-single") {
    const textarea = document.querySelector(`textarea.block-brief[data-bid="${bid}"]`);
    const blockBrief = textarea ? textarea.value.trim() : "";
    await generateSingleBlock(bid, blockBrief);
  } else if (action === "drop-draft") {
    delete draft[bid];
    await saveDraft();
    updateDraftUI();
    log(`🗑 убрано из черновика: ${bid}`);
  } else if (action === "regen-field") {
    const field = btn.dataset.field;
    await regenerateField(bid, field);
  } else if (action === "reset-field") {
    const field = btn.dataset.field;
    await resetField(bid, field);
  }
}

function parseCountHint(briefText) {
  if (!briefText) return null;
  const m = briefText.match(/(?:сделай|сгенерируй|создай|нужн[оы]?|хочу)\s+(\d+)\s*(?:элемент|пункт|вопрос|отзыв|услуг|преимуществ|шаг|этап|карточ|ответ)/i);
  if (m) return parseInt(m[1], 10);
  const m2 = briefText.match(/(\d+)\s*(?:элемент|пункт|вопрос|отзыв|услуг|преимуществ|шаг|этап|карточ|ответ)/i);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

// ================================================================
//               ПЕРЕГЕНЕРАЦИЯ ОДНОГО ПОЛЯ (v0.7)
// ================================================================
async function regenerateField(blockId, fieldKey) {
  try {
    const apiKey = $("apiKey").value.trim();
    const model = $("model").value.trim() || "gemini-3.1-flash-lite-preview";
    const globalBrief = $("brief").value.trim();
    if (!apiKey) return log("⚠️ Укажи Gemini API key.");

    const block = loadedBlocks.find(b => String(b.block_id) === String(blockId));
    if (!block) return log("✗ блок не найден");
    const parsed = extractEditableFields(block);

    // Находим metadata поля и текущее значение
    let fieldMeta, currentValue, isList = false;
    if (parsed.flat[fieldKey]) {
      fieldMeta = parsed.flat[fieldKey];
      currentValue = draft[blockId]?.fields?.[fieldKey] ?? fieldMeta.current;
    } else if (parsed.lists[fieldKey]) {
      fieldMeta = parsed.lists[fieldKey];
      currentValue = draft[blockId]?.fields?.[fieldKey] ?? fieldMeta.currentItems;
      isList = true;
    } else {
      return log(`✗ поле ${fieldKey} не найдено в блоке`);
    }

    const type = detectBlockType(block);
    const blockData = { name: block.name, type, parsed };

    log(`\n→ перегенерация поля "${fieldMeta.name}" в блоке "${block.name}"...`);

    const prompt = buildSingleFieldPrompt(globalBrief, blockData, fieldKey, fieldMeta, currentValue, "");
    let generated;
    try {
      generated = await callGemini(apiKey, model, prompt);
    } catch (e) {
      return log("✗ Gemini: " + e.message);
    }

    const newValue = generated[fieldKey];
    if (newValue == null) return log("✗ Gemini не вернул поле");

    if (!draft[blockId]) {
      draft[blockId] = { fields: {}, block_name: block.name, ts: Date.now() };
    }
    draft[blockId].fields[fieldKey] = isList && Array.isArray(newValue)
      ? newValue.map(item => {
          const cleaned = {};
          const schema = fieldMeta.itemSchema;
          for (const [sk] of Object.entries(schema)) {
            if (item && item[sk] != null) cleaned[sk] = String(item[sk]);
          }
          return cleaned;
        })
      : String(newValue);

    await saveDraft();
    updateDraftUI();
    log(`✓ поле "${fieldMeta.name}" перегенерировано`);
  } catch (e) {
    log("✗ " + e.message);
  }
}

// Сброс поля к оригинальному значению из блока
async function resetField(blockId, fieldKey) {
  const block = loadedBlocks.find(b => String(b.block_id) === String(blockId));
  if (!block) return;
  const parsed = extractEditableFields(block);

  if (!draft[blockId]) return;

  if (parsed.flat[fieldKey]) {
    draft[blockId].fields[fieldKey] = parsed.flat[fieldKey].current;
  } else if (parsed.lists[fieldKey]) {
    // Клонируем текущие элементы
    draft[blockId].fields[fieldKey] = JSON.parse(JSON.stringify(parsed.lists[fieldKey].currentItems));
  }

  await saveDraft();
  updateDraftUI();
  log(`✓ поле "${fieldKey}" сброшено к оригиналу`);
}

// ================================================================
//                  ГЕНЕРАЦИЯ ОДНОГО БЛОКА
// ================================================================
async function generateSingleBlock(block_id, blockBrief) {
  try {
    await saveSettings();
    const apiKey = $("apiKey").value.trim();
    const model = $("model").value.trim() || "gemini-3.1-flash-lite-preview";
    const globalBrief = $("brief").value.trim();

    if (!apiKey) return log("⚠️ Укажи Gemini API key.");
    if (!globalBrief && !blockBrief) return log("⚠️ Укажи ТЗ (общее или для блока).");

    const block = loadedBlocks.find(b => String(b.block_id) === String(block_id));
    if (!block) return log("✗ блок не найден: " + block_id);

    const parsed = extractEditableFields(block);
    if (!hasAnythingEditable(parsed)) return log("· нет редактируемых полей");

    const type = detectBlockType(block);
    const blockData = {
      block_id: block.block_id,
      name: block.name || `Блок ${block.block_id}`,
      type,
      parsed,
    };

    const countHint = parseCountHint(blockBrief);
    const overrideItemCounts = {};
    if (countHint != null) {
      for (const listKey of Object.keys(parsed.lists)) {
        overrideItemCounts[listKey] = countHint;
      }
    }

    log(`\n→ генерация блока: "${block.name}" [${type}]`);
    if (blockBrief) log(`  ТЗ: ${blockBrief.slice(0, 100)}${blockBrief.length > 100 ? "..." : ""}`);
    if (countHint != null) log(`  ↳ количество в списках: ${countHint}`);

    const prompt = buildSingleBlockPrompt(globalBrief, blockBrief, blockData, overrideItemCounts);
    let generated;
    try {
      generated = await callGemini(apiKey, model, prompt);
    } catch (e) {
      log("✗ Gemini: " + e.message);
      return;
    }

    const cleanGenerated = sanitizeGeneratedForBlock(generated, parsed);
    if (!Object.keys(cleanGenerated).length) return log("✗ Gemini не вернул валидных полей");

    draft[block_id] = {
      fields: cleanGenerated,
      block_name: block.name,
      ts: Date.now(),
    };
    await saveDraft();
    updateDraftUI();
    log(`✓ в черновик: ${block.name}`);
  } catch (e) {
    log("✗ " + e.message);
  }
}

function sanitizeGeneratedForBlock(generated, parsed) {
  const clean = {};
  for (const [k, v] of Object.entries(generated || {})) {
    if (parsed.flat[k] && v != null) {
      clean[k] = String(v);
      continue;
    }
    if (parsed.lists[k] && Array.isArray(v)) {
      const schema = parsed.lists[k].itemSchema;
      const newItems = v.map(item => {
        const obj = {};
        for (const [sk] of Object.entries(schema)) {
          if (item && item[sk] != null) obj[sk] = String(item[sk]);
        }
        return obj;
      }).filter(o => Object.keys(o).length > 0);
      if (newItems.length) clean[k] = newItems;
    }
  }
  return clean;
}

// ================================================================
//                  ГЕНЕРАЦИЯ ВСЕЙ СТРАНИЦЫ (3 режима)
// ================================================================
$("fillBtn").addEventListener("click", async () => {
  try {
    await saveSettings();
    const apiKey = $("apiKey").value.trim();
    const model = $("model").value.trim() || "gemini-3.1-flash-lite-preview";
    const briefText = $("brief").value.trim();
    if (!apiKey) return log("⚠️ Укажи Gemini API key.");
    if (!briefText) return log("⚠️ Поле ввода пустое.");
    if (!loadedBlocks.length) return log("⚠️ Сначала загрузи блоки.");

    const modeLabel = {
      generate: "ГЕНЕРАЦИЯ С НУЛЯ",
      layout: "РАСКЛАДКА МОИХ ТЕКСТОВ",
      edits: "ТОЧЕЧНЫЕ ПРАВКИ",
    }[currentMode];

    log(`\n=== ${modeLabel} ===`);
    log(`модель: ${model}`);

    // Собираем данные блоков
    const blocksForPrompt = [];
    const blocksMap = {};
    for (const b of loadedBlocks) {
      const parsed = extractEditableFields(b);
      const allSkipped = [...parsed.skippedFlat, ...parsed.skippedInLists];
      if (allSkipped.length) log(`· ${b.name}: пропущены [${allSkipped.join(", ")}]`);
      if (!hasAnythingEditable(parsed)) {
        log(`· ${b.name}: нет редактируемых полей, пропуск`);
        continue;
      }
      const type = detectBlockType(b);
      blocksForPrompt.push({
        block_id: b.block_id,
        name: b.name || `Блок ${b.block_id}`,
        type,
        parsed,
        block: b,
      });
      blocksMap[b.block_id] = { block: b, parsed, type };
    }
    if (!blocksForPrompt.length) return log("⚠️ Нет блоков с редактируемыми полями.");

    log(`→ отправляю ${blocksForPrompt.length} блоков в Gemini...`);

    // Выбор промпта по режиму
    let prompt;
    if (currentMode === "generate") {
      prompt = buildPagePromptGenerate(briefText, blocksForPrompt);
    } else if (currentMode === "layout") {
      const chunks = splitUserTextIntoChunks(briefText);
      log(`📝 распознано фрагментов в тексте: ${chunks.length} (разделитель — 2 пустые строки подряд)`);
      if (chunks.length === 1) {
        log(`⚠ найден только 1 фрагмент. Убедись что между блоками текста есть минимум 2 пустые строки (3 энтера подряд).`);
      }
      prompt = buildPagePromptLayout(briefText, blocksForPrompt);
    } else if (currentMode === "edits") {
      prompt = buildPagePromptEdits(briefText, blocksForPrompt);
    }

    let generated;
    try {
      generated = await callGemini(apiKey, model, prompt);
    } catch (e) {
      log("✗ Gemini: " + e.message);
      return;
    }

    const returnedIds = Object.keys(generated);
    log(`← ответ: ${returnedIds.length} блок(ов)`);

    // В режимах layout/edits НЕ жалуемся на пропущенные — это нормально
    if (currentMode === "generate") {
      const expectedIds = blocksForPrompt.map(b => String(b.block_id));
      const missing = expectedIds.filter(id => !returnedIds.includes(id));
      if (missing.length) {
        log(`⚠ Не вернулись: ${missing.join(", ")} (можно дожать кнопкой «Только этот»)`);
      }
    }

    // В черновик
    let layoutLengthWarnings = 0;
    for (const [block_id, fields] of Object.entries(generated)) {
      const info = blocksMap[block_id];
      if (!info) { log(`⚠ неизвестный block_id: ${block_id}`); continue; }
      const cleanGenerated = sanitizeGeneratedForBlock(fields, info.parsed);
      if (!Object.keys(cleanGenerated).length) continue;

      // В режиме layout — проверяем превышение maxlength и показываем warning,
      // но НЕ обрезаем (пользователь может сам подправить в редактируемом превью)
      if (currentMode === "layout") {
        for (const [k, v] of Object.entries(cleanGenerated)) {
          if (typeof v === "string" && info.parsed.flat[k]?.maxlength) {
            const plain = v.replace(/<[^>]+>/g, "");
            const limit = info.parsed.flat[k].maxlength;
            if (plain.length > limit) {
              log(`  ⚠ "${info.block.name}" → поле "${k}": ${plain.length} из ${limit} символов (+${plain.length - limit}). Можно подправить вручную.`);
              layoutLengthWarnings++;
            }
          }
          if (Array.isArray(v) && info.parsed.lists[k]) {
            const schema = info.parsed.lists[k].itemSchema;
            v.forEach((item, idx) => {
              for (const [sk, sv] of Object.entries(item || {})) {
                if (typeof sv === "string" && schema[sk]?.maxlength) {
                  const plain = sv.replace(/<[^>]+>/g, "");
                  if (plain.length > schema[sk].maxlength) {
                    log(`  ⚠ "${info.block.name}" → ${k}[${idx + 1}].${sk}: ${plain.length} из ${schema[sk].maxlength}`);
                    layoutLengthWarnings++;
                  }
                }
              }
            });
          }
        }
      }

      // В режимах layout/edits ответ может быть частичным (не все поля блока).
      // Мерджим с уже существующим черновиком, чтобы не терять предыдущие правки.
      // В режиме generate — полная перезапись черновика.
      if ((currentMode === "edits" || currentMode === "layout") && draft[block_id]) {
        draft[block_id].fields = { ...draft[block_id].fields, ...cleanGenerated };
        draft[block_id].ts = Date.now();
      } else {
        draft[block_id] = {
          fields: cleanGenerated,
          block_name: info.block.name,
          ts: Date.now(),
        };
      }
    }

    if (layoutLengthWarnings > 0) {
      log(`\n💡 Обнаружено превышений длины: ${layoutLengthWarnings}. Ничего не обрезано — проверь в черновике и подправь вручную если нужно.`);
    }
    await saveDraft();
    updateDraftUI();

    log(`\n✅ в черновике: ${Object.keys(draft).length} блоков`);

    const dryRun = $("dryRun").checked;
    if (!dryRun) {
      log("→ галочка «Сухой прогон» снята — применяю сразу");
      await applyDraft();
    } else {
      log("💡 проверь в карточках блоков (можно редактировать), потом «Применить черновик»");
    }
  } catch (e) {
    log("✗ " + e.message);
  }
});

// ================================================================
//                   ПРИМЕНЕНИЕ ЧЕРНОВИКА
// ================================================================
async function applyDraft() {
  const variant_id = $("variantId").value.trim();
  if (!variant_id) return log("⚠️ variant_id не задан.");
  const ids = Object.keys(draft);
  if (!ids.length) return log("⚠️ черновик пуст.");

  log(`\n=== ПРИМЕНЕНИЕ: ${ids.length} блоков ===`);

  let ok = 0, fail = 0;
  const appliedIds = [];
  for (let i = 0; i < ids.length; i++) {
    const block_id = ids[i];
    const block = loadedBlocks.find(b => String(b.block_id) === String(block_id));
    if (!block) { log(`  ✗ блок ${block_id} не найден`); fail++; continue; }
    const content = buildContentForSave(block, draft[block_id].fields);
    const saved = await send({ type: "saveContent", variant_id, block_id, content });
    if (saved?.ok) {
      log(`  💾 ${block.name || block_id}`);
      ok++;
      appliedIds.push(block_id);
    } else {
      log(`  ✗ ${block.name || block_id}: ${JSON.stringify(saved).slice(0, 200)}`);
      fail++;
    }
    if (i < ids.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  log(`\n✅ сохранено: ${ok}, ошибок: ${fail}`);
  if (ok > 0) {
    log("🔄 обнови страницу редактора (F5)");
    for (const id of appliedIds) delete draft[id];
    await saveDraft();
    updateDraftUI();
  }
}
$("applyBtn").addEventListener("click", () => applyDraft().catch(e => log("✗ " + e.message)));

$("clearDraftBtn").addEventListener("click", async () => {
  draft = {};
  await saveDraft();
  updateDraftUI();
  log("🗑 черновик очищен");
});

// ================================================================
//             v1.0: АНАЛИЗ СТИЛЕЙ ГЛАВНОЙ СТРАНИЦЫ
// ================================================================
//
// Цель: загрузить главную страницу клиента, распарсить HTML,
// найти основные дизайн-токены (цвета, шрифты, скругления, отступы)
// и сохранить их в стилевой профиль клиента (по домену).
//
// Профили хранятся в chrome.storage.local под ключом styleProfiles:
// { "spaceless.oml.ru": { colors: {...}, fonts: {...}, ... }, ... }

let styleProfiles = {};   // загружается из storage при старте
let currentProfile = null; // активный профиль для текущего домена

async function loadStyleProfiles() {
  const s = await chrome.storage.local.get(["styleProfiles"]);
  styleProfiles = s.styleProfiles || {};
}
async function saveStyleProfiles() {
  await chrome.storage.local.set({ styleProfiles });
}
function getDomainFromOrigin(origin) {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin || "";
  }
}
function getActiveProfile() {
  if (!pageOrigin) return null;
  const domain = getDomainFromOrigin(pageOrigin);
  return styleProfiles[domain] || null;
}

// ---- Помощники парсинга цветов ----

// Преобразование любого цветового значения в hex (#RRGGBB).
// Поддерживает rgb(), rgba(), #hex, #hex3, named colors через canvas.
function colorToHex(value) {
  if (!value || value === "transparent" || value === "none") return null;
  value = String(value).trim();

  // rgba/rgb
  let m = value.match(/^rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m) {
    const r = Math.round(parseFloat(m[1]));
    const g = Math.round(parseFloat(m[2]));
    const b = Math.round(parseFloat(m[3]));
    const a = m[4] != null ? parseFloat(m[4]) : 1;
    if (a < 0.05) return null; // полностью прозрачный — игнорируем
    return "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  // hex
  m = value.match(/^#([0-9a-f]{6})$/i);
  if (m) return "#" + m[1].toLowerCase();
  m = value.match(/^#([0-9a-f]{3})$/i);
  if (m) {
    return "#" + m[1].split("").map(c => c + c).join("").toLowerCase();
  }
  return null;
}

// Получение яркости цвета (0..255), для определения светлый/тёмный
function colorLuminance(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return 128;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Стандартная формула относительной яркости (упрощённая)
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isLightColor(hex) {
  return colorLuminance(hex) > 160;
}

// Извлекает первое число из строки типа "16px" → 16, "1.5rem" → 24
function extractPx(value) {
  if (!value) return null;
  const m = String(value).match(/^([\d.]+)\s*(px|rem|em)?$/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  const unit = (m[2] || "px").toLowerCase();
  if (unit === "rem" || unit === "em") n = n * 16;
  return Math.round(n);
}

// ---- Главный анализатор HTML страницы ----

function analyzeHtmlForStyles(html, sourceUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Создаём изолированный iframe чтобы вычислять getComputedStyle
  // (DOMParser не вычисляет стили — нужна реальная отрисовка).
  // Используем sandbox: документ невидимый, шириной с реальную страницу.
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;left:-99999px;top:0;width:1280px;height:800px;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      try { iframe.remove(); } catch {}
      resolve(result);
    };

    iframe.onload = () => {
      try {
        const idoc = iframe.contentDocument;
        const iwin = iframe.contentWindow;
        if (!idoc || !iwin) return finish(null);

        // Ждём ещё немного чтобы стили применились
        setTimeout(() => {
          try {
            const result = extractStyleTokensFromDocument(idoc, iwin, sourceUrl);
            finish(result);
          } catch (e) {
            console.error("[MG-AI] style extraction failed:", e);
            finish(null);
          }
        }, 800);
      } catch (e) {
        console.error("[MG-AI] iframe error:", e);
        finish(null);
      }
    };

    // Записываем HTML в iframe через document.write
    // (это самый надёжный способ для DOMParser-результата)
    try {
      const idoc = iframe.contentDocument;
      idoc.open();
      // Заменяем относительные URL в base, чтобы стили грузились с того же домена
      let preparedHtml = html;
      if (sourceUrl) {
        const baseTag = `<base href="${sourceUrl}">`;
        if (/<head[^>]*>/i.test(preparedHtml)) {
          preparedHtml = preparedHtml.replace(/<head[^>]*>/i, m => m + baseTag);
        } else {
          preparedHtml = baseTag + preparedHtml;
        }
      }
      idoc.write(preparedHtml);
      idoc.close();
    } catch (e) {
      console.error("[MG-AI] iframe write error:", e);
      finish(null);
    }

    // Защита от вечного ожидания
    setTimeout(() => finish(null), 8000);
  });
}

// Реальное извлечение токенов из готового документа
function extractStyleTokensFromDocument(doc, win, sourceUrl) {
  const profile = {
    sourceUrl: sourceUrl || "",
    extractedAt: Date.now(),
    colors: {
      pageBackground: null,
      bodyText: null,
      accent: null,           // основной акцентный (кнопки, ссылки)
      accentText: null,       // цвет текста на акценте
      headingText: null,
      secondaryBackground: null, // фон контентных блоков (обычно отличается от главного)
      palette: [],            // топ-N часто встречающихся цветов
    },
    fonts: {
      heading: null,          // font-family заголовков
      body: null,             // font-family основного текста
      headingWeight: null,
      bodyWeight: null,
      h1Size: null,
      h2Size: null,
      bodySize: null,
    },
    radius: {
      buttons: null,
      cards: null,
      common: null,           // самое часто встречающееся скругление
    },
    spacing: {
      sectionPadding: null,    // вертикальные отступы секций
      common: null,
    },
    buttons: {
      bg: null,
      text: null,
      borderRadius: null,
      borderWidth: null,
      borderColor: null,
      paddingV: null,
      paddingH: null,
    },
    raw: {
      bodyFontFamily: null,
      htmlBg: null,
    },
  };

  const html = doc.documentElement;
  const body = doc.body;
  if (!body) return profile;

  // ===== ФОН СТРАНИЦЫ =====
  const htmlBg = colorToHex(win.getComputedStyle(html).backgroundColor);
  const bodyBg = colorToHex(win.getComputedStyle(body).backgroundColor);
  profile.colors.pageBackground = bodyBg || htmlBg || "#ffffff";
  profile.raw.htmlBg = htmlBg;

  // ===== ОСНОВНОЙ ТЕКСТ =====
  const bodyStyle = win.getComputedStyle(body);
  profile.colors.bodyText = colorToHex(bodyStyle.color) || "#1a1a1a";
  profile.fonts.body = sanitizeFontFamily(bodyStyle.fontFamily);
  profile.fonts.bodyWeight = parseInt(bodyStyle.fontWeight, 10) || 400;
  profile.fonts.bodySize = extractPx(bodyStyle.fontSize) || 16;
  profile.raw.bodyFontFamily = bodyStyle.fontFamily;

  // ===== ЗАГОЛОВКИ =====
  const h1 = doc.querySelector("h1");
  const h2 = doc.querySelector("h2");
  const heading = h1 || h2 || doc.querySelector("h3");
  if (heading) {
    const hs = win.getComputedStyle(heading);
    profile.colors.headingText = colorToHex(hs.color) || profile.colors.bodyText;
    profile.fonts.heading = sanitizeFontFamily(hs.fontFamily);
    profile.fonts.headingWeight = parseInt(hs.fontWeight, 10) || 700;
  } else {
    profile.fonts.heading = profile.fonts.body;
    profile.fonts.headingWeight = 700;
    profile.colors.headingText = profile.colors.bodyText;
  }
  if (h1) profile.fonts.h1Size = extractPx(win.getComputedStyle(h1).fontSize);
  if (h2) profile.fonts.h2Size = extractPx(win.getComputedStyle(h2).fontSize);

  // ===== КНОПКИ И АКЦЕНТНЫЙ ЦВЕТ =====
  const btnSelectors = [
    "button",
    "a.button",
    "a.btn",
    ".btn",
    ".button",
    'a[class*="button"]',
    'a[class*="btn"]',
    'input[type="button"]',
    'input[type="submit"]',
  ];
  let buttonCandidates = [];
  for (const sel of btnSelectors) {
    try {
      doc.querySelectorAll(sel).forEach(el => buttonCandidates.push(el));
    } catch {}
  }
  // Берём первую видимую кнопку с заметным фоном
  let mainButton = null;
  for (const btn of buttonCandidates) {
    const cs = win.getComputedStyle(btn);
    const bg = colorToHex(cs.backgroundColor);
    const rect = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { width: 0, height: 0 };
    // Кнопка с непрозрачным фоном и нормальным размером
    if (bg && rect.width > 30 && rect.height > 15) {
      mainButton = btn;
      break;
    }
  }
  if (mainButton) {
    const bs = win.getComputedStyle(mainButton);
    profile.buttons.bg = colorToHex(bs.backgroundColor);
    profile.buttons.text = colorToHex(bs.color);
    profile.buttons.borderRadius = extractPx(bs.borderRadius);
    profile.buttons.borderWidth = extractPx(bs.borderWidth);
    profile.buttons.borderColor = colorToHex(bs.borderColor);
    profile.buttons.paddingV = extractPx(bs.paddingTop);
    profile.buttons.paddingH = extractPx(bs.paddingLeft);
    if (profile.buttons.bg) profile.colors.accent = profile.buttons.bg;
    if (profile.buttons.text) profile.colors.accentText = profile.buttons.text;
  }

  // ===== СОБИРАЕМ ПАЛИТРУ ИЗ ТОП-100 ЭЛЕМЕНТОВ =====
  const colorCounts = {};
  const elementsToSample = [];
  // Берём заметные элементы: section, div с фоном, заголовки, кнопки, ссылки
  ["section", "div", "header", "footer", "main", "article", "aside"].forEach(tag => {
    doc.querySelectorAll(tag).forEach(el => elementsToSample.push(el));
  });
  // Ограничиваем до первых 200, чтобы не тормозить
  elementsToSample.slice(0, 200).forEach(el => {
    try {
      const cs = win.getComputedStyle(el);
      const bg = colorToHex(cs.backgroundColor);
      if (bg && bg !== profile.colors.pageBackground) {
        colorCounts[bg] = (colorCounts[bg] || 0) + 1;
      }
    } catch {}
  });
  const sortedColors = Object.entries(colorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([c]) => c);
  profile.colors.palette = sortedColors;

  // Если акцент ещё не определён — берём самый частый цвет, отличающийся от фона
  if (!profile.colors.accent && sortedColors.length) {
    const bgLuminance = colorLuminance(profile.colors.pageBackground);
    profile.colors.accent = sortedColors.find(c => Math.abs(colorLuminance(c) - bgLuminance) > 50) || sortedColors[0];
  }
  if (!profile.colors.accentText && profile.colors.accent) {
    profile.colors.accentText = isLightColor(profile.colors.accent) ? "#1a1a1a" : "#ffffff";
  }

  // Вторичный фон — самый частый цвет среди светлых (если основной фон тоже светлый)
  if (sortedColors.length) {
    const candidates = sortedColors.filter(c => Math.abs(colorLuminance(c) - colorLuminance(profile.colors.pageBackground)) < 40);
    if (candidates.length) profile.colors.secondaryBackground = candidates[0];
  }

  // ===== СКРУГЛЕНИЯ =====
  const radiusCounts = {};
  doc.querySelectorAll("button, .btn, .button, .card, [class*='card']").forEach(el => {
    try {
      const r = extractPx(win.getComputedStyle(el).borderRadius);
      if (r != null && r > 0 && r < 100) {
        radiusCounts[r] = (radiusCounts[r] || 0) + 1;
      }
    } catch {}
  });
  const sortedRadii = Object.entries(radiusCounts).sort((a, b) => b[1] - a[1]);
  if (sortedRadii.length) {
    profile.radius.common = parseInt(sortedRadii[0][0], 10);
  }
  profile.radius.buttons = profile.buttons.borderRadius || profile.radius.common;
  profile.radius.cards = profile.radius.common;

  // ===== ОТСТУПЫ СЕКЦИЙ =====
  const paddingCounts = {};
  doc.querySelectorAll("section, [class*='section'], main > div").forEach(el => {
    try {
      const cs = win.getComputedStyle(el);
      const pt = extractPx(cs.paddingTop);
      const pb = extractPx(cs.paddingBottom);
      if (pt && pt > 20 && pt < 200) paddingCounts[pt] = (paddingCounts[pt] || 0) + 1;
      if (pb && pb > 20 && pb < 200) paddingCounts[pb] = (paddingCounts[pb] || 0) + 1;
    } catch {}
  });
  const sortedPaddings = Object.entries(paddingCounts).sort((a, b) => b[1] - a[1]);
  if (sortedPaddings.length) {
    profile.spacing.sectionPadding = parseInt(sortedPaddings[0][0], 10);
    profile.spacing.common = profile.spacing.sectionPadding;
  }

  return profile;
}

// Чистит font-family от лишнего: берёт первое имя, убирает кавычки
function sanitizeFontFamily(value) {
  if (!value) return null;
  const first = String(value).split(",")[0].trim();
  return first.replace(/^["']|["']$/g, "") || null;
}

// ---- Запуск анализа: загрузка HTML через content script + парсинг ----

async function fetchAndAnalyzeStyles(targetUrl) {
  log(`→ загружаю главную: ${targetUrl}`);
  const r = await send({ type: "fetchPageHtml", url: targetUrl });
  if (!r?.ok) {
    throw new Error("не удалось загрузить страницу: " + (r?.error || r?.status || "unknown"));
  }
  if (!r.html || r.html.length < 200) {
    throw new Error("страница пустая или слишком маленькая");
  }
  log(`← получено ${Math.round(r.html.length / 1024)} KB HTML, анализирую...`);
  const profile = await analyzeHtmlForStyles(r.html, targetUrl);
  if (!profile) {
    throw new Error("не удалось извлечь стили (анализатор вернул пусто)");
  }
  return profile;
}

// ---- UI: рендер превью стилевого профиля + обработчики кнопки ----

function renderStyleProfilePreview() {
  const container = $("styleProfilePreview");
  if (!container) return;

  const profile = getActiveProfile();
  if (!profile) {
    container.innerHTML = `<div class="style-empty">Профиль не снят. Загрузи блоки страницы и нажми «🎨 Снять».</div>`;
    return;
  }

  const domain = getDomainFromOrigin(pageOrigin);
  const date = profile.extractedAt ? new Date(profile.extractedAt).toLocaleString("ru-RU") : "";

  const swatch = (label, hex) => {
    if (!hex) return "";
    return `
      <div class="color-swatch">
        <div class="color-swatch-box" style="background:${hex}"></div>
        <div class="color-swatch-info">
          <span class="color-swatch-label">${escape_(label)}</span>
          <span class="color-swatch-value">${escape_(hex)}</span>
        </div>
      </div>
    `;
  };

  const palette = (profile.colors.palette || [])
    .slice(0, 8)
    .map(c => `<div class="palette-chip" style="background:${c}" title="${c}"></div>`)
    .join("");

  const buttonPreview = profile.buttons.bg
    ? `<div class="style-button-preview" style="
        background:${profile.buttons.bg};
        color:${profile.buttons.text || "#fff"};
        border-radius:${profile.buttons.borderRadius || 8}px;
        ${profile.buttons.borderWidth ? `border:${profile.buttons.borderWidth}px solid ${profile.buttons.borderColor || profile.buttons.bg};` : ""}
      ">Пример кнопки</div>`
    : "";

  container.innerHTML = `
    <div class="style-profile">
      <div class="style-profile-header">
        <span class="style-profile-domain">${escape_(domain)}</span>
        <span class="style-profile-date">${escape_(date)}</span>
      </div>

      <div class="style-section">
        <div class="style-section-title">Цвета</div>
        <div class="color-swatches">
          ${swatch("Фон", profile.colors.pageBackground)}
          ${swatch("Текст", profile.colors.bodyText)}
          ${swatch("Заголовки", profile.colors.headingText)}
          ${swatch("Акцент", profile.colors.accent)}
          ${swatch("На акценте", profile.colors.accentText)}
          ${swatch("Доп. фон", profile.colors.secondaryBackground)}
        </div>
        ${palette ? `
          <div class="style-section-title" style="margin-top:8px">Палитра</div>
          <div class="palette-row">${palette}</div>
        ` : ""}
      </div>

      <div class="style-section">
        <div class="style-section-title">Шрифты</div>
        <div class="style-row"><span>Заголовки</span><b>${escape_(profile.fonts.heading || "—")}${profile.fonts.headingWeight ? ` ${profile.fonts.headingWeight}` : ""}</b></div>
        <div class="style-row"><span>Основной текст</span><b>${escape_(profile.fonts.body || "—")}${profile.fonts.bodyWeight ? ` ${profile.fonts.bodyWeight}` : ""}</b></div>
        ${profile.fonts.h1Size ? `<div class="style-row"><span>Размер h1</span><b>${profile.fonts.h1Size}px</b></div>` : ""}
        ${profile.fonts.h2Size ? `<div class="style-row"><span>Размер h2</span><b>${profile.fonts.h2Size}px</b></div>` : ""}
        ${profile.fonts.bodySize ? `<div class="style-row"><span>Размер текста</span><b>${profile.fonts.bodySize}px</b></div>` : ""}
      </div>

      <div class="style-section">
        <div class="style-section-title">Геометрия</div>
        ${profile.radius.common != null ? `<div class="style-row"><span>Скругления</span><b>${profile.radius.common}px</b></div>` : ""}
        ${profile.radius.buttons != null ? `<div class="style-row"><span>Скругление кнопок</span><b>${profile.radius.buttons}px</b></div>` : ""}
        ${profile.spacing.sectionPadding != null ? `<div class="style-row"><span>Отступы секций</span><b>${profile.spacing.sectionPadding}px</b></div>` : ""}
      </div>

      ${buttonPreview ? `
        <div class="style-section">
          <div class="style-section-title">Кнопка</div>
          ${buttonPreview}
        </div>
      ` : ""}

      <div class="style-section" style="margin-top:12px">
        <div class="style-section-title">Применение стилей</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <button class="success small-btn" id="styleScanBtn" style="width:100%">🔍 Просканировать классы блоков</button>
          <button class="success small-btn" id="styleApplyAllBtn" style="width:100%">✨ Применить ко всем блокам</button>
          <button class="secondary small-btn" id="styleTestOneBtn" style="width:100%">🧪 Применить только к первому блоку (тест)</button>
          <button class="secondary small-btn" id="styleRollbackBtn" style="width:100%">🔙 Откатить последнее применение</button>
          <button class="secondary small-btn" id="styleDebugBtn" style="width:100%">📋 Показать CSS блоков (диагностика)</button>
        </div>
      </div>

      <div class="style-section" style="margin-top:8px">
        <button class="danger small-btn" id="styleResetBtn" style="width:auto">🗑 Удалить профиль</button>
      </div>
    </div>
  `;

  $("styleResetBtn")?.addEventListener("click", async () => {
    if (!pageOrigin) return;
    const domain = getDomainFromOrigin(pageOrigin);
    delete styleProfiles[domain];
    await saveStyleProfiles();
    renderStyleProfilePreview();
    log(`🗑 удалён стилевой профиль для ${domain}`);
  });

  // v1.3: сканирование классов блоков из iframe редактора
  $("styleScanBtn")?.addEventListener("click", scanBlocksOnPage);

  // v1.1: применение ко всем блокам
  $("styleApplyAllBtn")?.addEventListener("click", async () => {
    if (!loadedBlocks.length) return log("⚠ Сначала загрузи блоки страницы.");
    const profile = getActiveProfile();
    if (!profile) return log("⚠ Нет стилевого профиля.");
    log(`\n=== ПРИМЕНЕНИЕ СТИЛЕЙ КО ВСЕМ БЛОКАМ ===`);
    log(`→ блоков для обработки: ${loadedBlocks.length}`);
    await applyStyleProfileToBlocks(loadedBlocks, profile);
  });

  // v1.1: тестовое применение к первому блоку
  $("styleTestOneBtn")?.addEventListener("click", async () => {
    if (!loadedBlocks.length) return log("⚠ Сначала загрузи блоки страницы.");
    const profile = getActiveProfile();
    if (!profile) return log("⚠ Нет стилевого профиля.");
    const firstWithCss = loadedBlocks.find(b => {
      const s = getBlockCssSettings(b);
      return s && Object.keys(s).length > 0;
    });
    if (!firstWithCss) return log("⚠ Среди блоков нет ни одного с кастомными CSS — нечего подменять.");
    log(`\n=== ТЕСТ: ПРИМЕНЕНИЕ К ОДНОМУ БЛОКУ ===`);
    log(`→ блок: "${firstWithCss.name}"`);
    await applyStyleProfileToBlocks([firstWithCss], profile);
  });

  // v1.1: откат
  $("styleRollbackBtn")?.addEventListener("click", async () => {
    if (!confirm("Откатить последнее применение стилей? Все блоки вернутся к состоянию до последнего применения.")) return;
    await rollbackCssChanges();
  });

  // v1.2: диагностика — что у блоков в css_settings
  $("styleDebugBtn")?.addEventListener("click", () => {
    if (!loadedBlocks.length) return log("⚠ Сначала загрузи блоки страницы.");
    log(`\n=== ДИАГНОСТИКА CSS БЛОКОВ ===`);
    log(`Всего блоков: ${loadedBlocks.length}`);
    loadedBlocks.forEach((b, i) => {
      const cs = getBlockCssSettings(b);
      const themeKeys = cs ? Object.keys(cs) : [];
      let totalClasses = 0;
      const classNames = [];
      if (cs) {
        for (const themeData of Object.values(cs)) {
          if (themeData && typeof themeData === "object") {
            const keys = Object.keys(themeData);
            totalClasses += keys.length;
            keys.forEach(k => classNames.push(k));
          }
        }
      }
      log(`\n${i + 1}. "${b.name}" (layout_id=${b.layout_id})`);
      log(`   theme: ${themeKeys.join(", ") || "(пусто)"}`);
      log(`   классов: ${totalClasses}`);
      if (classNames.length > 0) {
        classNames.slice(0, 10).forEach(c => log(`     - ${c}`));
        if (classNames.length > 10) log(`     ... и ещё ${classNames.length - 10}`);
      }
    });
    log(`\n💡 Если у блока 0 классов — у него нет кастомных CSS, но v1.2 всё равно попробует применить стили через банк типичных классов.`);
  });
}

// Кнопка "🎨 Снять"
$("styleSnapBtn")?.addEventListener("click", async () => {
  try {
    if (!pageOrigin) {
      log("⚠️ Сначала загрузи блоки страницы — мне нужен origin клиента.");
      return;
    }
    let url = $("styleSourceUrl").value.trim();
    if (!url) {
      url = pageOrigin + "/";
    }
    // Сохраняем поле для удобства следующего раза
    if ($("styleSourceUrl").value.trim()) {
      await chrome.storage.local.set({ styleSourceUrl: $("styleSourceUrl").value.trim() });
    }

    log(`\n=== СНЯТИЕ СТИЛЕВОГО ПРОФИЛЯ ===`);
    let profile;
    try {
      profile = await fetchAndAnalyzeStyles(url);
    } catch (e) {
      log("✗ " + e.message);
      return;
    }

    const domain = getDomainFromOrigin(pageOrigin);
    styleProfiles[domain] = profile;
    await saveStyleProfiles();

    log(`✓ профиль создан для ${domain}`);
    if (profile.colors.accent) log(`  акцент: ${profile.colors.accent}`);
    if (profile.fonts.heading) log(`  шрифт заголовков: ${profile.fonts.heading}`);
    if (profile.fonts.body) log(`  шрифт текста: ${profile.fonts.body}`);
    if (profile.radius.common != null) log(`  скругления: ${profile.radius.common}px`);

    renderStyleProfilePreview();
  } catch (e) {
    log("✗ " + e.message);
  }
});

function sanitizeFileName(name) {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned || `image-${Date.now()}`;
}

function extractAltPromptsFromValue(value, path = "", out = []) {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((item, i) => extractAltPromptsFromValue(item, `${path}[${i}]`, out));
    return out;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      if (/alt/i.test(k) && typeof v === "string" && v.trim()) {
        out.push({ alt: v.trim(), path: p });
      }
      extractAltPromptsFromValue(v, p, out);
    }
  }
  return out;
}

function buildBrandPaletteHint(profile) {
  if (!profile?.colors) return "";
  const colors = [
    profile.colors.pageBackground,
    profile.colors.secondaryBackground,
    profile.colors.headingText,
    profile.colors.bodyText,
    profile.colors.accent,
  ].filter(Boolean);
  if (!colors.length) return "";
  return `Brand color palette (must follow): ${colors.join(", ")}.`;
}

function buildImagenPrompt(altText, profile) {
  return [
    // Imagen по документации лучше работает с English prompts.
    `Scene: ${altText}.`,
    "Photorealistic commercial photo, natural lighting, high detail, premium quality.",
    "No text, no letters, no typography, no logos, no watermark, no UI labels.",
    buildBrandPaletteHint(profile),
    "Clean composition, modern tasteful design, human-friendly visual hierarchy.",
  ].filter(Boolean).join(" ");
}

async function callImagenApi({ apiKey, model, prompt }) {
  const targetModel = model || "imagen-4.0-generate-001";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(targetModel)}:predict`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: "16:9",
        personGeneration: "allow_adult",
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Imagen ${res.status}: ${JSON.stringify(data).slice(0, 240)}`);
  }
  // Формат REST ответа Imagen:
  // predictions[0].bytesBase64Encoded
  const p0 = data?.predictions?.[0] || {};
  if (p0.bytesBase64Encoded) return { type: "b64", value: p0.bytesBase64Encoded };
  // Защитный fallback под возможные вариации
  if (p0.b64_json) return { type: "b64", value: p0.b64_json };
  if (p0.url) return { type: "url", value: p0.url };
  throw new Error("Imagen вернул ответ без predictions[0].bytesBase64Encoded");
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadGeneratedImage(imageResp, altText) {
  const baseName = sanitizeFileName(altText);
  if (imageResp.type === "url") {
    const r = await fetch(imageResp.value);
    if (!r.ok) throw new Error(`Не удалось скачать image url: ${r.status}`);
    const blob = await r.blob();
    const ext = blob.type?.includes("png") ? "png" : "jpg";
    triggerBlobDownload(blob, `${baseName}.${ext}`);
    return;
  }
  if (imageResp.type === "b64") {
    const bin = atob(imageResp.value);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: "image/jpeg" });
    triggerBlobDownload(blob, `${baseName}.jpg`);
    return;
  }
  throw new Error("Неизвестный формат изображения");
}

async function generateImagesFromAltFields() {
  log(`\n=== КНОПКА: ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЙ ПО ALT ===`);
  const apiKey = $("geminiImageApiKey")?.value.trim() || $("apiKey")?.value.trim();
  const model = $("geminiImageModel")?.value.trim() || "imagen-4.0-generate-001";
  if (!apiKey) return log("⚠ Укажи Gemini API key (общий или для Imagen) в настройках.");
  if (!loadedBlocks.length) return log("⚠ Сначала загрузи блоки страницы.");

  const profile = getCurrentStyleProfile();
  const altItemsRaw = [];
  loadedBlocks.forEach(b => {
    const blockAlts = extractAltPromptsFromValue(b.data_json || {}, `block:${b.block_id}`);
    blockAlts.forEach(x => altItemsRaw.push(x));
  });
  const dedup = new Map();
  altItemsRaw.forEach(x => {
    const key = x.alt.toLowerCase();
    if (!dedup.has(key)) dedup.set(key, x.alt);
  });
  const altItems = Array.from(dedup.values());
  if (!altItems.length) return log("⚠ В загруженных блоках не найдено ALT-полей для генерации.");

  log(`\n=== ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЙ ПО ALT (Gemini Imagen) ===`);
  log(`→ найдено ALT: ${altItems.length}`);
  log(`→ требования: реалистично, без текста, 16:9, палитра главной страницы`);

  let ok = 0;
  for (let i = 0; i < altItems.length; i++) {
    const alt = altItems[i];
    try {
      const prompt = buildImagenPrompt(alt, profile);
      log(`  [${i + 1}/${altItems.length}] генерирую: "${alt.slice(0, 80)}${alt.length > 80 ? "..." : ""}"`);
      const imageResp = await callImagenApi({ apiKey, model, prompt });
      await downloadGeneratedImage(imageResp, alt);
      ok++;
      log(`  ✓ скачано: ${sanitizeFileName(alt)}`);
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      log(`  ✗ ошибка: ${e.message}`);
    }
  }
  log(`✓ готово: ${ok}/${altItems.length} файлов.`);
}

// Вешаем обработчик отдельно от рендера профиля,
// чтобы кнопка работала даже когда профиль ещё не снят/не отрисован.
$("genAltImagesBtn")?.addEventListener("click", generateImagesFromAltFields);

// ================================================================
//      v1.1: ПРИМЕНЕНИЕ СТИЛЕЙ К БЛОКАМ (РЕАЛЬНОЕ API)
// ================================================================
//
// Endpoint: POST /-/cms/v2/lp/block/css
// Сервер принимает частичные изменения: можно отправить только то что
// хотим изменить, остальные стили блока останутся как есть.
//
// Структура payload:
// {
//   "block_id": {
//     "theme_<layout_id>": {
//       ".some-css-class": {
//         "background": { "color": "...", ... },
//         "font": { "color": "...", "family": "...", ... },
//         "border_radius": { "lt": N, "rt": N, "rb": N, "lb": N }
//       }
//     }
//   }
// }
//
// Какие классы у каждого блока — мы НЕ знаем заранее. Берём их из block.css_settings
// (есть в block_list) — там лежит ТЕКУЩИЕ кастомные стили блока.

// Распознавание роли CSS-класса по его имени.
// MegaGroup использует BEM-подобную схему: .lpc-{type}-{variant}__{part}
// или .lp-block-{part}. По суффиксу можно понять что это.
function classifyCssClass(className) {
  const c = (className || "").toLowerCase();
  // Корневой контейнер блока — пустая строка или ".lp-block-..."
  if (c === "" || /^\.lp-block(?:-bg|-overlay|_item|-bg_item)?$/.test(c) || c === ".lpc-block") return "block_root";
  if (/^\.lpc-.+(?:__wrap|__wrap-box|__container|__holder)$/.test(c)) return "block_root";
  // Заголовки
  if (/__title$|__heading$|__name$|__question$/.test(c)) return "heading";
  // Подзаголовки и второстепенные тексты
  if (/__subtitle$|__sub-?title$|__caption$|__author$/.test(c)) return "subheading";
  // Карточки, элементы, контейнеры контента
  if (/__card$|__item(?:-content)?$|__item-content-card$|__box$|__cell$|__items$|__content$/.test(c)) return "card";
  // Описания, тексты, ответы
  if (/__text$|__desc(?:ription)?$|__answer$/.test(c)) return "body_text";
  // Кнопки
  if (/__button$|__btn$|__link$/.test(c)) return "button";
  // Иконки и цифры (часто это акцентные элементы — кружочки, кружки с цифрами и т.д.)
  if (/__icon$|__number$|__num$|__counter$|__index$|__step-num$/.test(c)) return "accent_element";
  return "other";
}

// Конвертация hex в "rgb(R,G,B)" — нужно потому что MegaGroup хранит цвета
// в формате rgb()/rgba(), а у нас в профиле hex.
function hexToRgbString(hex, alpha = 1) {
  if (!hex) return null;
  const m = String(hex).match(/^#?([0-9a-f]{6})$/i) || String(hex).match(/^#?([0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (alpha < 1) return `rgba(${r},${g},${b},${alpha})`;
  return `rgb(${r},${g},${b})`;
}

// Извлечь альфу из существующего цвета (rgba) — нужно чтобы сохранить
// прозрачность когда подменяем цвет.
function extractAlpha(colorStr) {
  if (!colorStr) return 1;
  const m = String(colorStr).match(/^rgba?\s*\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (m && m[1] != null) return parseFloat(m[1]);
  return 1;
}

// Добавить разумный fallback к font-family
function fontFamilyWithFallback(family) {
  if (!family) return null;
  if (family.includes(",")) return family; // уже с fallback'ом
  // Простая эвристика serif vs sans-serif по имени шрифта
  const serifFonts = /(?:times|georgia|garamond|playfair|merriweather|lora|libre|cormorant|ptserif|crimson|bitter)/i;
  const fallback = serifFonts.test(family) ? "serif" : "sans-serif";
  return `${family}, ${fallback}`;
}

// Извлекает css_settings блока (текущие кастомные стили).
// В block_list мы получаем поле css_settings — это уже распарсенный объект,
// или css_json — строка. Возвращаем единый формат: { theme_X: { .class: {...} } }
function getBlockCssSettings(block) {
  if (!block) return null;
  if (block.css_settings && typeof block.css_settings === "object") {
    return block.css_settings;
  }
  if (block.css_json) {
    try {
      const parsed = typeof block.css_json === "string" ? JSON.parse(block.css_json) : block.css_json;
      return parsed.css || parsed;
    } catch {
      return null;
    }
  }
  return null;
}

// ---- Банк типичных CSS-классов для разных типов блоков MegaGroup ----
// Если у блока в css_settings пусто (или почти пусто) — пробуем применить
// эти универсальные классы. Они построены по паттерну BEM который использует MegaGroup:
// .lpc-{type}-{variant}__{part} или .lp-block-{part}
//
// Для каждого паттерна имени блока — список классов и их роли (heading/body_text/card/...).

const COMMON_BLOCK_CLASSES = [
  // Универсальные классы корневого блока (есть почти везде)
  { className: ".lp-block-bg_item",   role: "block_root", apply: ["background"] },
  { className: ".lp-block-overlay",   role: "block_overlay", apply: ["background"] },

  // Универсальный заголовок и описание блока (h1/h2/h3 и подзаголовок)
  { className: ".lp-block__title",        role: "heading",   apply: ["font", "background"] },
  { className: ".lp-block__desc",         role: "body_text", apply: ["font"] },
  { className: ".lp-block__subtitle",     role: "subheading", apply: ["font"] },

  // Преимущества (features)
  { className: ".lpc-features-1__title",         role: "heading",   apply: ["font"] },
  { className: ".lpc-features-1__text",          role: "body_text", apply: ["font"] },
  { className: ".lpc-features-1__item",          role: "card",      apply: ["background", "border_radius"] },
  { className: ".lpc-features-1__item-content",  role: "card",      apply: ["background", "border_radius"] },
  { className: ".lpc-features-1__item-title",    role: "heading",   apply: ["font"] },
  { className: ".lpc-features-1__item-text",     role: "body_text", apply: ["font"] },
  { className: ".lpc-features-1__number",        role: "heading",   apply: ["font"] },

  // Карточки услуг / товаров (products)
  { className: ".lpc-products-1__title",         role: "heading",   apply: ["font"] },
  { className: ".lpc-products-1__text",          role: "body_text", apply: ["font"] },
  { className: ".lpc-products-1__card",          role: "card",      apply: ["background", "border_radius"] },
  { className: ".lpc-products-1__item",          role: "card",      apply: ["background", "border_radius"] },
  { className: ".lpc-products-1__item-title",    role: "heading",   apply: ["font"] },
  { className: ".lpc-products-1__item-text",     role: "body_text", apply: ["font"] },
  { className: ".lpc-products-1__item-content",  role: "card",      apply: ["background", "border_radius"] },

  // Текстовые блоки
  { className: ".lpc-text-1__title",       role: "heading",   apply: ["font"] },
  { className: ".lpc-text-1__text",        role: "body_text", apply: ["font"] },
  { className: ".lpc-text-2__title",       role: "heading",   apply: ["font"] },
  { className: ".lpc-text-2__text",        role: "body_text", apply: ["font"] },
  { className: ".lpc-text-sticky-1__title", role: "heading",   apply: ["font"] },
  { className: ".lpc-text-sticky-1__text",  role: "body_text", apply: ["font"] },

  // Карточка с микроразметкой
  { className: ".lpc-microdata-1__title",   role: "heading",   apply: ["font"] },
  { className: ".lpc-microdata-1__text",    role: "body_text", apply: ["font"] },
  { className: ".lpc-microdata-1__card",    role: "card",      apply: ["background", "border_radius"] },

  // Обложка / hero
  { className: ".lpc-cover-1__title",      role: "heading",   apply: ["font"] },
  { className: ".lpc-cover-1__text",       role: "body_text", apply: ["font"] },
  { className: ".lpc-cover-1__subtitle",   role: "subheading", apply: ["font"] },

  // Списки с иллюстрацией
  { className: ".lpc-list-1__title",       role: "heading",   apply: ["font"] },
  { className: ".lpc-list-1__text",        role: "body_text", apply: ["font"] },
  { className: ".lpc-list-1__item-title",  role: "heading",   apply: ["font"] },
  { className: ".lpc-list-1__item-text",   role: "body_text", apply: ["font"] },

  // FAQ / вопросы
  { className: ".lpc-questions-1__question", role: "heading",   apply: ["font"] },
  { className: ".lpc-questions-1__answer",   role: "body_text", apply: ["font"] },
  { className: ".lpc-questions-1__card",     role: "card",      apply: ["background", "border_radius"] },
  { className: ".lpc-questions-2__question", role: "heading",   apply: ["font"] },
  { className: ".lpc-questions-2__answer",   role: "body_text", apply: ["font"] },
  { className: ".lpc-questions-2__card",     role: "card",      apply: ["background", "border_radius"] },
  { className: ".lpc-questions-3__question", role: "heading",   apply: ["font"] },
  { className: ".lpc-questions-3__answer",   role: "body_text", apply: ["font"] },
  { className: ".lpc-questions-3__card",     role: "card",      apply: ["background", "border_radius"] },
  { className: ".lpc-questions-3__subtitle", role: "subheading", apply: ["font"] },

  // Маркированные списки
  { className: ".lpc-marker-list-1__title",  role: "heading",   apply: ["font"] },
  { className: ".lpc-marker-list-1__text",   role: "body_text", apply: ["font"] },

  // Баннер с кнопками
  { className: ".lpc-banner-1__title",       role: "heading",   apply: ["font"] },
  { className: ".lpc-banner-1__text",        role: "body_text", apply: ["font"] },
  { className: ".lpc-banner-1__button",      role: "button",    apply: ["background", "border_radius"] },

  // Отзывы
  { className: ".lpc-quotes-1__title",       role: "heading",   apply: ["font"] },
  { className: ".lpc-quotes-1__text",        role: "body_text", apply: ["font"] },
  { className: ".lpc-quotes-1__author",      role: "subheading", apply: ["font"] },
  { className: ".lpc-quotes-1__card",        role: "card",      apply: ["background", "border_radius"] },
];

// Создаёт изменения для одного класса исходя из его роли
function buildChangesForRole(role, profile, className = "") {
  const changes = {};
  const cls = String(className || "").toLowerCase();
  const isTextLike = /__title$|__heading$|__name$|__question$|__subtitle$|__sub-?title$|__caption$|__author$|__text$|__desc(?:ription)?$|__answer$/.test(cls);
  const rootBgAllow = /^\.lpc-block$|^\.lp-block(?:-bg|-overlay|_item|-bg_item)?$/.test(cls);

  // Цвет фона
  if (role === "block_root" && profile.colors.pageBackground && rootBgAllow) {
    changes.background = {
      color: hexToRgbString(profile.colors.pageBackground),
      image: "none",
      bg_type: "solid",
    };
  } else if (role === "card" && !isTextLike && (profile.colors.secondaryBackground || profile.colors.pageBackground)) {
    changes.background = {
      color: hexToRgbString(profile.colors.secondaryBackground || profile.colors.pageBackground),
      image: "none",
      bg_type: "solid",
    };
  } else if (role === "button" && profile.colors.accent) {
    changes.background = {
      color: hexToRgbString(profile.colors.accent),
      image: "none",
      bg_type: "solid",
    };
  } else if (role === "accent_element" && profile.colors.accent) {
    // Иконки, цифры, кружочки — акцентный цвет фона (для кружочков)
    changes.background = {
      color: hexToRgbString(profile.colors.accent),
      image: "none",
      bg_type: "solid",
    };
  }

  // Цвет шрифта
  let fontColor = null;
  if (role === "heading" || role === "subheading") {
    fontColor = profile.colors.headingText;
  } else if (role === "button") {
    fontColor = profile.colors.accentText;
  } else if (role === "accent_element") {
    // Иконка/цифра — текст контрастный к акценту
    fontColor = profile.colors.accentText || "#ffffff";
  } else if (role === "body_text") {
    fontColor = profile.colors.bodyText;
  }
  if (fontColor) {
    if (!changes.font) changes.font = {};
    changes.font.color = hexToRgbString(fontColor);
  }

  // Семейство шрифта
  const targetFamily = (role === "heading" || role === "subheading")
    ? profile.fonts.heading
    : profile.fonts.body;
  if (targetFamily && (role === "heading" || role === "subheading" || role === "body_text")) {
    if (!changes.font) changes.font = {};
    changes.font.family = fontFamilyWithFallback(targetFamily);
  }

  // Жирность шрифта из профиля (размеры НЕ форсим — часто ломают визуальный ритм шаблонов)
  if (role === "heading") {
    if (profile.fonts.headingWeight) {
      if (!changes.font) changes.font = {};
      changes.font.weight = String(profile.fonts.headingWeight);
    }
  }
  if (role === "body_text" || role === "subheading") {
    if (profile.fonts.bodyWeight) {
      if (!changes.font) changes.font = {};
      changes.font.weight = String(profile.fonts.bodyWeight);
    }
  }

  // Скругления для карточек, кнопок и акцентных элементов
  const radiusValue = role === "button"
    ? (profile.radius.buttons != null ? profile.radius.buttons : profile.radius.common)
    : profile.radius.common;
  if ((role === "card" || role === "button" || role === "accent_element") && radiusValue != null) {
    changes.border_radius = {
      lt: radiusValue,
      rt: radiusValue,
      rb: radiusValue,
      lb: radiusValue,
    };
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

// Главная функция: строит CSS-payload для одного блока на основе профиля.
// v1.3: использует ТРИ источника классов в порядке приоритета:
//   1) Уже существующие классы в css_settings блока (как раньше)
//   2) Реально сканированные классы из iframe редактора (если ты нажала "Просканировать") — самые точные
//   3) Банк типичных классов COMMON_BLOCK_CLASSES (запасной вариант)
function buildCssPayloadForBlock(block, profile) {
  if (!block || !profile) return null;

  const themeKey = `theme_${block.layout_id}`;
  const result = { [themeKey]: {} };

  // Шаг 1: применяем к классам которые УЖЕ есть в css_settings (если есть)
  const cssSettings = getBlockCssSettings(block);
  if (cssSettings && typeof cssSettings === "object") {
    for (const [tKey, themeData] of Object.entries(cssSettings)) {
      if (!themeData || typeof themeData !== "object") continue;
      for (const [className, classData] of Object.entries(themeData)) {
        if (!classData || typeof classData !== "object") continue;
        const role = classifyCssClass(className);
        if (role === "other") continue;
        const changes = buildChangesForRole(role, profile, className);
        if (changes) {
          if (!result[tKey]) result[tKey] = {};
          result[tKey][className] = { ...(result[tKey][className] || {}), ...changes };
        }
      }
    }
  }

  // Шаг 2: используем сканированные классы (если есть для этого блока)
  // Это самый точный источник — реальные классы которые рендерятся в превью
  const scanned = getScannedClassesForBlock(block.block_id);
  if (scanned && scanned.classNames && scanned.classNames.length > 0) {
    for (const className of scanned.classNames) {
      const role = classifyCssClass(className);
      if (role === "other") continue;
      const changes = buildChangesForRole(role, profile, className);
      if (!changes) continue;
      // Сканированные классы имеют приоритет: дообогащают/уточняют то, что было в шаге 1.
      result[themeKey][className] = { ...(result[themeKey][className] || {}), ...changes };
    }
  } else {
    // Шаг 3: запасной — банк типичных классов
    // Используется только если у блока нет сканированных классов
    for (const entry of COMMON_BLOCK_CLASSES) {
      const changes = buildChangesForRole(entry.role, profile, entry.className);
      if (!changes) continue;
      const filtered = {};
      if (entry.apply.includes("background") && changes.background) filtered.background = changes.background;
      if (entry.apply.includes("font") && changes.font) filtered.font = changes.font;
      if (entry.apply.includes("border_radius") && changes.border_radius) filtered.border_radius = changes.border_radius;
      if (Object.keys(filtered).length === 0) continue;
      if (!result[themeKey][entry.className]) {
        result[themeKey][entry.className] = filtered;
      }
    }
  }

  // Очищаем пустые темы
  for (const tKey of Object.keys(result)) {
    if (!result[tKey] || Object.keys(result[tKey]).length === 0) {
      delete result[tKey];
    }
  }

  if (Object.keys(result).length === 0) return null;
  return result;
}

// Считает сколько изменений суммарно в payload (для логирования)
function countChangesInPayload(blockPayload) {
  if (!blockPayload) return 0;
  let count = 0;
  for (const themeData of Object.values(blockPayload)) {
    for (const classData of Object.values(themeData)) {
      if (classData.background) count++;
      if (classData.font) count++;
      if (classData.border_radius) count++;
    }
  }
  return count;
}

// ---- v1.3: сканированные CSS-классы блоков (из iframe редактора) ----
//
// scannedBlockClasses: { variant_id: { block_id: { classNames: [...], scannedAt: ts } } }
// Сохраняется в storage чтобы переживать перезагрузки. Привязка по variant_id —
// у разных страниц могут быть разные наборы блоков.
let scannedBlockClasses = {};

async function loadScannedClasses() {
  const s = await chrome.storage.local.get(["scannedBlockClasses"]);
  scannedBlockClasses = s.scannedBlockClasses || {};
}
async function saveScannedClasses() {
  await chrome.storage.local.set({ scannedBlockClasses });
}

function getScannedClassesForBlock(blockId) {
  const variant_id = $("variantId").value.trim();
  if (!variant_id) return null;
  return scannedBlockClasses[variant_id]?.[blockId] || null;
}

// Запуск сканирования: говорит content script взять iframe редактора и собрать классы
async function scanBlocksOnPage() {
  const variant_id = $("variantId").value.trim();
  if (!variant_id) return log("⚠ variant_id не задан");
  if (!loadedBlocks.length) return log("⚠ Сначала загрузи блоки страницы.");

  log(`\n=== СКАНИРОВАНИЕ КЛАССОВ БЛОКОВ ===`);
  log(`→ читаю превью страницы из iframe редактора...`);

  let r;
  try {
    r = await send({ type: "scanBlocksFromEditor" });
  } catch (e) {
    return log("✗ " + e.message);
  }

  if (!r?.ok) {
    return log("✗ ошибка: " + JSON.stringify(r).slice(0, 200));
  }

  log(`📋 ${r.debug || ""}`);

  if (!r.found) {
    log(`✗ не удалось найти превью страницы в iframe редактора`);
    log(`💡 Возможно превью загружено в iframe с другого домена (cross-origin) — тогда DOM недоступен.`);
    log(`💡 Можешь попробовать обновить страницу редактора (F5) и попробовать снова.`);
    return;
  }

  const blockMap = r.blocks || {};
  const foundBlockIds = Object.keys(blockMap);
  log(`✓ найдено блоков в превью: ${foundBlockIds.length}`);

  const loadedById = new Map(loadedBlocks.map(b => [String(b.block_id), b]));
  const loadedByLayout = new Map();
  loadedBlocks.forEach(b => {
    const lk = String(b.layout_id || b.block_layout_id || b.layout || "");
    if (!lk) return;
    if (!loadedByLayout.has(lk)) loadedByLayout.set(lk, []);
    loadedByLayout.get(lk).push(b);
  });

  const scannedEntries = foundBlockIds.map(key => ({ key, data: blockMap[key] || {} }));
  scannedEntries.sort((a, b) => (a.data.domIndex ?? 0) - (b.data.domIndex ?? 0));

  const normalized = {};
  const usedLoadedIds = new Set();
  const consumedRawKeys = new Set();

  const tryMatchLoadedBlock = (rawId, scannedData) => {
    if (loadedById.has(String(rawId))) return loadedById.get(String(rawId));
    const layoutId = String(scannedData?.layoutId || "");
    if (layoutId && loadedByLayout.has(layoutId)) {
      const candidates = loadedByLayout.get(layoutId).filter(b => !usedLoadedIds.has(String(b.block_id)));
      if (candidates.length === 1) return candidates[0];
    }
    return null;
  };

  // Сохраняем результат
  if (!scannedBlockClasses[variant_id]) scannedBlockClasses[variant_id] = {};
  let totalClasses = 0;
  let matched = 0;
  for (const { key: rawId, data } of scannedEntries) {
    const matchedBlock = tryMatchLoadedBlock(rawId, data);
    const targetBlockId = matchedBlock ? String(matchedBlock.block_id) : String(rawId);
    normalized[targetBlockId] = {
      classNames: data.classNames || [],
      layoutId: data.layoutId || null,
      source: data.source || "unknown",
      scannedAt: Date.now(),
    };
    totalClasses += (data.classNames || []).length;
    if (matchedBlock) {
      matched++;
      usedLoadedIds.add(String(matchedBlock.block_id));
      consumedRawKeys.add(String(rawId));
    }
  }

  // Fallback: если id/layout не дали совпадений, маппим оставшиеся блоки по порядку.
  if (matched < loadedBlocks.length) {
    const unmatchedLoaded = loadedBlocks.filter(b => !usedLoadedIds.has(String(b.block_id)));
    const unmatchedScanned = scannedEntries.filter(se => !consumedRawKeys.has(String(se.key)));
    const n = Math.min(unmatchedLoaded.length, unmatchedScanned.length);
    for (let i = 0; i < n; i++) {
      const lb = unmatchedLoaded[i];
      const se = unmatchedScanned[i];
      normalized[String(lb.block_id)] = {
        classNames: se.data.classNames || [],
        layoutId: se.data.layoutId || null,
        source: `${se.data.source || "unknown"}+order`,
        scannedAt: Date.now(),
      };
      usedLoadedIds.add(String(lb.block_id));
      matched++;
    }
  }

  for (const [blockId, data] of Object.entries(normalized)) {
    scannedBlockClasses[variant_id][blockId] = {
      classNames: data.classNames || [],
      layoutId: data.layoutId || null,
      source: data.source || "unknown",
      scannedAt: Date.now(),
    };
  }
  await saveScannedClasses();

  log(`✓ собрано классов: ${totalClasses}`);
  log(`✓ из них сматчено с загруженными блоками: ${matched} из ${loadedBlocks.length}`);

  // Покажем для каждого блока сколько у него классов
  loadedBlocks.forEach((b, i) => {
    const scanned = scannedBlockClasses[variant_id][b.block_id];
    if (scanned) {
      log(`  ${i + 1}. "${b.name}": ${scanned.classNames.length} классов`);
    } else {
      log(`  ${i + 1}. "${b.name}": ✗ не найден в превью`);
    }
  });

  if (matched === 0) {
    log(`\n⚠ Не удалось сматчить блоки. Возможно превью не успело загрузиться или используется другой формат разметки.`);
  } else {
    log(`\n💡 Теперь применение стилей будет использовать реальные классы вместо банка догадок.`);
  }
}
let cssBackups = {}; // { variant_id: { ts, blocks: { block_id: cssSettings } } }

async function loadCssBackups() {
  const s = await chrome.storage.local.get(["cssBackups"]);
  cssBackups = s.cssBackups || {};
}
async function saveCssBackups() {
  await chrome.storage.local.set({ cssBackups });
}

function createBackup(variant_id, blocks) {
  const backup = { ts: Date.now(), blocks: {} };
  for (const b of blocks) {
    const settings = getBlockCssSettings(b);
    if (settings) backup.blocks[b.block_id] = JSON.parse(JSON.stringify(settings));
  }
  cssBackups[variant_id] = backup;
  saveCssBackups();
}

// ---- Применение стилей: пакетная отправка по одному блоку ----

async function applyStyleProfileToBlocks(blocks, profile, options = {}) {
  const variant_id = $("variantId").value.trim();
  if (!variant_id) {
    log("⚠ variant_id не задан");
    return { ok: 0, fail: 0, skipped: 0 };
  }
  if (!profile) {
    log("⚠ нет стилевого профиля");
    return { ok: 0, fail: 0, skipped: 0 };
  }
  const verbose = options.verbose !== false;

  // Создаём резервную копию ДО применения
  createBackup(variant_id, blocks);
  log(`💾 резервная копия CSS сохранена (${Object.keys(cssBackups[variant_id].blocks).length} блоков)`);

  let ok = 0, fail = 0, skipped = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const payload = buildCssPayloadForBlock(block, profile);
    if (!payload) {
      skipped++;
      if (verbose) log(`  · "${block.name}": пропуск (нечего применять)`);
      continue;
    }
    const fullPayload = { [block.block_id]: payload };
    const changeCount = countChangesInPayload(payload);

    // Считаем сколько классов и каких изменений
    let classCount = 0;
    const changeTypes = { background: 0, font: 0, border_radius: 0 };
    for (const themeData of Object.values(payload)) {
      for (const classData of Object.values(themeData)) {
        classCount++;
        if (classData.background) changeTypes.background++;
        if (classData.font) changeTypes.font++;
        if (classData.border_radius) changeTypes.border_radius++;
      }
    }

    log(`  → "${block.name}": ${classCount} классов (фон ${changeTypes.background}, шрифт ${changeTypes.font}, скругления ${changeTypes.border_radius})${getScannedClassesForBlock(block.block_id) ? " 🔍" : ""}`);

    try {
      const r = await send({ type: "saveBlockCss", variant_id, cssPayload: fullPayload });
      if (r?.ok) {
        ok++;
        if (verbose) log(`    ✓ применено`);
      } else {
        fail++;
        log(`    ✗ ошибка: ${JSON.stringify(r).slice(0, 200)}`);
      }
    } catch (e) {
      fail++;
      log(`    ✗ ${e.message}`);
    }
    // Пауза чтобы не долбить API
    if (i < blocks.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  log(`\n✅ стили применены: ${ok}, пропущено: ${skipped}, ошибок: ${fail}`);
  if (ok > 0) {
    log("🔄 обнови страницу редактора (Ctrl+Shift+R или Ctrl+F5 для жёсткого обновления — обычный F5 может показать кеш)");
  }
  return { ok, fail, skipped };
}

// Откат последнего применения
async function rollbackCssChanges() {
  const variant_id = $("variantId").value.trim();
  if (!variant_id) return log("⚠ variant_id не задан");
  const backup = cssBackups[variant_id];
  if (!backup || !backup.blocks || !Object.keys(backup.blocks).length) {
    return log("⚠ нет резервной копии для отката");
  }
  log(`\n=== ОТКАТ CSS ===`);
  log(`→ восстанавливаю ${Object.keys(backup.blocks).length} блоков из резервной копии`);
  let ok = 0, fail = 0;
  for (const [blockId, settings] of Object.entries(backup.blocks)) {
    try {
      const r = await send({
        type: "saveBlockCss",
        variant_id,
        cssPayload: { [blockId]: settings },
      });
      if (r?.ok) { ok++; log(`  ✓ ${blockId}`); }
      else { fail++; log(`  ✗ ${blockId}: ${JSON.stringify(r).slice(0, 150)}`); }
    } catch (e) {
      fail++;
      log(`  ✗ ${blockId}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  log(`\n✅ откат завершён: ${ok} ok, ${fail} ошибок`);
  if (ok > 0) log("🔄 обнови страницу редактора (F5)");
}

// ================================================================
//                   v0.9: ПРЕСЕТЫ СТРАНИЦ
// ================================================================

// Встроенные пресеты. Каждый пресет — список имён блоков в порядке сверху вниз.
// Имена должны совпадать с именами шаблонов в библиотеке MegaGroup (из block-layout/list).
// Для поиска используется fuzzy-match, чтобы работало даже при мелких расхождениях.
const BUILTIN_PRESETS = {
  "service_v1": {
    id: "service_v1",
    icon: "🛍️",
    name: "Страница услуги (вариант 1)",
    description: "14 блоков с микроразметкой и FAQ",
    blocks: [
      "Заголовок",
      "Текст",
      "Карточка (Микроразметка)",
      "Преимущества с иконками (Микроразметка)",
      "Заголовок",
      "Текст",
      "Маркированный список оформленный",
      "Текст",
      "Баннер с кнопками",
      "Заголовок",
      "Текст",
      "Список с иллюстрацией (микроразметка)",
      "Вопрос-ответ в колонках (микроразметка)",
      "Баннер с кнопками",
    ],
  },
  "service_v2": {
    id: "service_v2",
    icon: "🛍️",
    name: "Страница услуги (вариант 2)",
    description: "12 блоков с обложкой и нумерованным списком",
    blocks: [
      "Обложка (Микроразметка)",
      "Преимущества с иконками (Микроразметка)",
      "Заголовок",
      "Текст",
      "Маркированный список оформленный",
      "Баннер с кнопками",
      "Заголовок",
      "Текст",
      "Маркированный список оформленный",
      "Список с иллюстрацией (микроразметка)",
      "Вопрос-ответ в колонках (микроразметка)",
      "Список с нумерацией в колонках",
    ],
  },
};

// Папки в библиотеке MegaGroup, где надо искать блоки по имени.
// Если блок не находится в одной папке — расширение пройдёт по остальным.
const LIBRARY_SEARCH_FOLDERS = [
  "Популярные блоки",
  "Текстовый блок",
  "Элементы",
  "Продукты, услуги",
  "Преимущества",
  "Отзывы",
  "Комментарии, ЧаВо",
  "Схема работы",
  "Формы",
  "Фото",
  "Контакты, карта",
  "Продающий блок",
  "Наши сотрудники",
  "Наши партнеры",
  "Сертификаты",
  "Премиум блоки",
];

// Нормализация имени для fuzzy-сравнения.
// "Заголовок" и "заголовок" — одно и то же.
// "Преимущества с иконками (Микроразметка)" и "преимущества с иконками микроразметка" — тоже.
function normalizeBlockName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^\wа-яё\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Проверка: подходит ли имя шаблона под искомое.
// Точное совпадение > содержит все слова > содержит большинство слов.
function matchBlockName(searchName, libraryName) {
  const s = normalizeBlockName(searchName);
  const l = normalizeBlockName(libraryName);
  if (!s || !l) return 0;
  if (s === l) return 100;                            // точное совпадение
  if (l.includes(s)) return 90;                       // библиотечное содержит искомое
  if (s.includes(l)) return 85;                       // искомое содержит библиотечное
  // посчитаем долю совпадающих слов
  const sWords = s.split(" ").filter(w => w.length >= 3);
  const lWords = new Set(l.split(" "));
  if (!sWords.length) return 0;
  const matched = sWords.filter(w => lWords.has(w)).length;
  const ratio = matched / sWords.length;
  if (ratio >= 0.8) return Math.round(70 + ratio * 10);
  if (ratio >= 0.6) return Math.round(50 + ratio * 20);
  return 0;
}

// Кеш библиотеки — чтобы при создании серии блоков не запрашивать
// список шаблонов в каждой папке повторно.
let libraryCache = {
  preset_id: null,
  folders: null,      // [{folder_id, name, icon}]
  layoutsByFolder: {}, // folder_id -> [{layout_id, name, image_path, staff_only}]
};

function resetLibraryCache() {
  libraryCache = { preset_id: null, folders: null, layoutsByFolder: {} };
}

async function ensureLibraryFolders() {
  if (libraryCache.preset_id !== pagePresetId) resetLibraryCache();
  libraryCache.preset_id = pagePresetId;
  if (libraryCache.folders) return libraryCache.folders;
  const r = await send({ type: "listFolders", preset_id: pagePresetId });
  if (!r?.ok) throw new Error("не удалось загрузить категории библиотеки: " + JSON.stringify(r).slice(0, 200));
  libraryCache.folders = r.data?.result || [];
  return libraryCache.folders;
}

async function ensureFolderLayouts(folderId) {
  if (libraryCache.layoutsByFolder[folderId]) return libraryCache.layoutsByFolder[folderId];
  const r = await send({ type: "listLayouts", folder_id: folderId, preset_id: pagePresetId });
  if (!r?.ok) throw new Error(`не удалось загрузить шаблоны папки ${folderId}`);
  const layouts = (r.data?.result || []).filter(l => !l.staff_only);
  libraryCache.layoutsByFolder[folderId] = layouts;
  return layouts;
}

// Поиск layout_id по имени блока во всей библиотеке.
// Возвращает { layout_id, name, score, folder_name } или null.
async function findLayoutByName(searchName) {
  const folders = await ensureLibraryFolders();
  let best = null;
  // Сортируем папки так, чтобы в приоритете были те, что указаны в LIBRARY_SEARCH_FOLDERS
  const prioritized = [
    ...folders.filter(f => LIBRARY_SEARCH_FOLDERS.includes(f.name)),
    ...folders.filter(f => !LIBRARY_SEARCH_FOLDERS.includes(f.name)),
  ];
  for (const folder of prioritized) {
    // Пропускаем технические папки
    const fname = (folder.name || "").toLowerCase();
    if (/всплывающ|модул|меню|вакансии/.test(fname)) continue;
    try {
      const layouts = await ensureFolderLayouts(folder.folder_id);
      for (const l of layouts) {
        const score = matchBlockName(searchName, l.name);
        if (score > 0 && (!best || score > best.score)) {
          best = {
            layout_id: l.layout_id,
            name: l.name,
            score,
            folder_name: folder.name,
            image_path: l.image_path,
          };
          if (score === 100) return best; // точное совпадение — сразу возвращаем
        }
      }
    } catch (e) {
      // игнорируем ошибки конкретной папки, идём дальше
    }
  }
  return best;
}

// Предварительное разрешение всех имён блоков пресета в layout_id.
// Возвращает массив: [{ name, status: "ok"|"not_found", layout_id, match_name, score }]
async function resolvePresetBlocks(blockNames) {
  const results = [];
  for (let i = 0; i < blockNames.length; i++) {
    const name = blockNames[i];
    const found = await findLayoutByName(name);
    if (found) {
      results.push({
        index: i,
        name,
        status: "ok",
        layout_id: found.layout_id,
        match_name: found.name,
        score: found.score,
        folder_name: found.folder_name,
        image_path: found.image_path,
      });
    } else {
      results.push({
        index: i,
        name,
        status: "not_found",
      });
    }
  }
  return results;
}

// ================================================================
//       v0.9: АВТОРАЗБИВКА ПРЕСЕТА НА ЛОГИЧЕСКИЕ РАЗДЕЛЫ
// ================================================================

// Простая эвристика разбивки: разделы начинаются с "якорных" блоков
// (hero, обложка, преимущества, FAQ, баннер с кнопками и т.д.)
// или когда встречается блок "Заголовок" после пары обычных.
const SECTION_ANCHOR_PATTERNS = [
  { regex: /обложка|hero|баннер\b|главн/i, label: "Обложка / первый экран" },
  { regex: /преимуществ/i, label: "Преимущества" },
  { regex: /карточк|услуг/i, label: "Услуги / продукты" },
  { regex: /отзыв/i, label: "Отзывы" },
  { regex: /вопрос|ответ|faq|чаво/i, label: "Вопросы и ответы" },
  { regex: /контакт/i, label: "Контакты" },
  { regex: /форм/i, label: "Форма связи" },
  { regex: /сотрудник|команд/i, label: "Команда" },
  { regex: /партнёр|партнер/i, label: "Партнёры" },
  { regex: /сертификат/i, label: "Сертификаты" },
  { regex: /схема|этап/i, label: "Схема работы" },
];

// Определяет роль блока по имени: "anchor" (начинает новый раздел) или "filler" (продолжение)
function detectBlockRole(blockName) {
  for (const { regex, label } of SECTION_ANCHOR_PATTERNS) {
    if (regex.test(blockName)) return { role: "anchor", suggestedLabel: label };
  }
  return { role: "filler", suggestedLabel: null };
}

// Авторазбивка списка имён блоков на секции.
// Возвращает: [{ label, blocks: [indices в исходном массиве], topicHint }]
function autoSplitIntoSections(blockNames) {
  if (!blockNames.length) return [];

  const sections = [];
  let currentSection = null;

  const startSection = (label) => {
    currentSection = { label, blockIndexes: [], topicHint: "" };
    sections.push(currentSection);
  };

  blockNames.forEach((name, i) => {
    const { role, suggestedLabel } = detectBlockRole(name);

    if (role === "anchor") {
      // Новый раздел начинается с якорного блока
      startSection(suggestedLabel || "Раздел");
      currentSection.blockIndexes.push(i);
    } else {
      // Filler блок: если это "Заголовок" и предыдущий блок НЕ был "Заголовок" —
      // возможно, это начало нового смыслового раздела
      const isHeading = /^заголовок$/i.test(name.trim());
      if (isHeading && currentSection && currentSection.blockIndexes.length > 0) {
        // проверяем, был ли последний блок в текущем разделе тоже "Заголовок"
        const lastIdx = currentSection.blockIndexes[currentSection.blockIndexes.length - 1];
        const lastName = blockNames[lastIdx];
        if (!/^заголовок$/i.test(lastName.trim())) {
          // новый раздел
          startSection(`Раздел ${sections.length + 1}`);
        }
      }
      if (!currentSection) startSection(`Раздел ${sections.length + 1}`);
      currentSection.blockIndexes.push(i);
    }
  });

  // Переименуем разделы в порядке для удобства
  sections.forEach((s, idx) => {
    if (/^раздел\s*\d*$/i.test(s.label)) {
      s.label = `Раздел ${idx + 1}`;
    }
  });

  return sections;
}

// ================================================================
//          v0.9: UI — ПАНЕЛЬ ПРЕСЕТОВ И РЕДАКТОР РАЗБИВКИ
// ================================================================

let presetState = {
  currentPreset: null,    // выбранный пресет
  resolved: [],           // результаты resolvePresetBlocks
  sections: [],           // авторазбивка (пользователь может её править)
};

function openPresetsModal() {
  if (!pagePresetId) {
    log("⚠️ Сначала загрузи блоки страницы (нужен preset_id).");
    return;
  }
  $("presetsModal").classList.add("open");
  renderPresetsList();
}
function closePresetsModal() {
  $("presetsModal").classList.remove("open");
}

function renderPresetsList() {
  const body = $("presetsBody");
  const presets = Object.values(BUILTIN_PRESETS);
  const cards = presets.map(p => `
    <div class="preset-card" data-preset-id="${escape_(p.id)}">
      <div class="preset-icon">${p.icon}</div>
      <div class="preset-info">
        <div class="preset-name">${escape_(p.name)}</div>
        <div class="preset-desc">${escape_(p.description)}</div>
        <div class="preset-meta">${p.blocks.length} блоков</div>
      </div>
      <div class="preset-arrow">→</div>
    </div>
  `).join("");
  body.innerHTML = `
    <div class="preset-intro">
      Выбери готовый пресет — расширение создаст все блоки по порядку и (опционально) сразу сгенерирует тексты по твоему ТЗ.
    </div>
    <div class="preset-grid">${cards}</div>
  `;
  body.querySelectorAll(".preset-card").forEach(card => {
    card.addEventListener("click", () => {
      const presetId = card.dataset.presetId;
      selectPreset(presetId);
    });
  });
}

async function selectPreset(presetId) {
  const preset = BUILTIN_PRESETS[presetId];
  if (!preset) return;
  presetState.currentPreset = preset;

  const body = $("presetsBody");
  body.innerHTML = `
    <button class="modal-back" id="presetBackBtn">← Назад к пресетам</button>
    <div class="preset-loading">
      <div style="font-weight:600;margin-bottom:6px">${escape_(preset.name)}</div>
      Ищу блоки в библиотеке сайта...
    </div>
  `;
  $("presetBackBtn").addEventListener("click", renderPresetsList);

  try {
    const resolved = await resolvePresetBlocks(preset.blocks);
    presetState.resolved = resolved;
    presetState.sections = autoSplitIntoSections(preset.blocks);
    renderPresetPreview();
  } catch (e) {
    body.innerHTML = `
      <button class="modal-back" id="presetBackBtn">← Назад к пресетам</button>
      <div class="preset-loading" style="color:#dc2626">✗ ${escape_(e.message)}</div>
    `;
    $("presetBackBtn").addEventListener("click", renderPresetsList);
  }
}

function renderPresetPreview() {
  const preset = presetState.currentPreset;
  const resolved = presetState.resolved;
  const sections = presetState.sections;

  const notFound = resolved.filter(r => r.status === "not_found");
  const okCount = resolved.length - notFound.length;

  // Рендер разделов с редактируемыми названиями и темами
  const sectionsHtml = sections.map((section, sIdx) => {
    const blocksInSection = section.blockIndexes.map(bIdx => {
      const r = resolved[bIdx];
      const statusIcon = r.status === "ok" ? "✓" : "✗";
      const statusClass = r.status === "ok" ? "resolved-ok" : "resolved-missing";
      const scoreText = r.status === "ok" && r.score < 100 ? ` <span class="resolved-score">(${r.score}%)</span>` : "";
      return `
        <div class="resolved-block ${statusClass}">
          <span class="resolved-status">${statusIcon}</span>
          <span class="resolved-name">${escape_(r.name)}</span>${scoreText}
          ${r.status === "ok" && r.match_name !== r.name ? `<div class="resolved-match">→ ${escape_(r.match_name)}</div>` : ""}
        </div>
      `;
    }).join("");
    return `
      <div class="section-card">
        <div class="section-header">
          <span class="section-number">${sIdx + 1}</span>
          <input type="text" class="section-label" data-section-idx="${sIdx}" value="${escape_(section.label)}" placeholder="Название раздела">
        </div>
        <textarea class="section-topic" data-section-idx="${sIdx}" placeholder="Тема раздела: о чём здесь писать? (опционально — Gemini догадается по названию и блокам)">${escape_(section.topicHint)}</textarea>
        <div class="section-blocks">${blocksInSection}</div>
      </div>
    `;
  }).join("");

  const body = $("presetsBody");
  body.innerHTML = `
    <button class="modal-back" id="presetBackBtn">← Назад к пресетам</button>
    <div class="preset-title">${escape_(preset.name)}</div>
    <div class="preset-stats">
      ${okCount} из ${resolved.length} блоков найдено в библиотеке
      ${notFound.length ? `<span class="preset-stats-warn">· ${notFound.length} не найдено</span>` : ""}
    </div>
    ${notFound.length ? `
      <div class="preset-warn">
        ⚠ Не найдены в библиотеке: ${notFound.map(n => escape_(n.name)).join(", ")}.
        Расширение пропустит эти блоки при создании. Если нужно — добавь их в ЛК MegaGroup.
      </div>
    ` : ""}
    <div class="preset-sections-title">Логические разделы (можно отредактировать)</div>
    <div class="preset-sections">${sectionsHtml}</div>
    <div class="preset-options">
      <label class="check">
        <input type="checkbox" id="presetAutoGenerate" checked>
        <span>Сразу сгенерировать тексты после создания блоков</span>
      </label>
      ${getActiveProfile() ? `
      <label class="check" style="margin-top:8px">
        <input type="checkbox" id="presetApplyStyle" checked>
        <span>🎨 Применить стилевой профиль клиента к новым блокам</span>
      </label>
      ` : ""}
    </div>
    <div class="preset-actions">
      <button class="secondary" id="presetCancelBtn">Отмена</button>
      <button class="success" id="presetCreateBtn">📄 Создать ${okCount} блоков</button>
    </div>
  `;
  $("presetBackBtn").addEventListener("click", renderPresetsList);
  $("presetCancelBtn").addEventListener("click", closePresetsModal);
  $("presetCreateBtn").addEventListener("click", runPresetCreation);

  // Сохранение изменений разделов в state при вводе
  body.querySelectorAll("input.section-label").forEach(input => {
    input.addEventListener("input", (e) => {
      const idx = parseInt(e.target.dataset.sectionIdx, 10);
      if (sections[idx]) sections[idx].label = e.target.value;
    });
  });
  body.querySelectorAll("textarea.section-topic").forEach(ta => {
    ta.addEventListener("input", (e) => {
      const idx = parseInt(e.target.dataset.sectionIdx, 10);
      if (sections[idx]) sections[idx].topicHint = e.target.value;
    });
  });
}

// ================================================================
//       v0.9: СОЗДАНИЕ БЛОКОВ ПРЕСЕТА + ГЕНЕРАЦИЯ ТЕКСТОВ
// ================================================================

async function runPresetCreation() {
  const autoGenerate = $("presetAutoGenerate")?.checked !== false;
  const applyStyle = $("presetApplyStyle")?.checked === true;
  const preset = presetState.currentPreset;
  const resolved = presetState.resolved;
  const sections = presetState.sections;

  const okResolved = resolved.filter(r => r.status === "ok");
  if (!okResolved.length) {
    log("⚠ Нет блоков которые можно создать.");
    return;
  }

  const variant_id = $("variantId").value.trim();
  if (!variant_id) {
    log("⚠ variant_id не задан.");
    return;
  }

  closePresetsModal();
  log(`\n=== СОЗДАНИЕ ПРЕСЕТА: ${preset.name} ===`);
  log(`→ будет создано: ${okResolved.length} блоков`);

  // Определяем якорь: последний существующий блок страницы (type=after)
  // Если страница пустая — пока не поддерживаем (нет якоря).
  if (!loadedBlocks.length) {
    log("⚠ Пустая страница без блоков не поддерживается. Добавь хотя бы один блок вручную и повтори.");
    return;
  }
  let anchor = loadedBlocks[loadedBlocks.length - 1];
  let anchorPosition = anchor.position;
  let insertType = "after";

  // Создаём блоки по очереди. После каждого нового блока нужно перезагрузить
  // список (новый блок становится якорем для следующего), иначе position будет
  // неправильной.
  const createdBlockIds = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    if (r.status !== "ok") {
      log(`  · #${i + 1} "${r.name}" — пропуск (не найден в библиотеке)`);
      continue;
    }
    log(`  → #${i + 1} создаю "${r.match_name}"...`);
    try {
      const resp = await send({
        type: "createBlock",
        variant_id,
        layout_id: r.layout_id,
        position: anchorPosition,
        insertType,
      });
      if (!resp?.ok) {
        log(`    ✗ ошибка: ${JSON.stringify(resp).slice(0, 200)}`);
        failCount++;
        continue;
      }
      successCount++;
      // Пытаемся извлечь созданный блок из ответа
      const createdBlock = resp.data?.result;
      if (createdBlock && createdBlock.block_id) {
        createdBlockIds.push(String(createdBlock.block_id));
        // Новый блок становится якорем для следующего
        anchorPosition = createdBlock.position || anchorPosition;
      } else {
        // Если не вернулся блок — перезагрузим список и найдём последний
        const listR = await send({ type: "list", variant_id });
        const items = listR?.data?.result?.blocks || listR?.data?.result || [];
        if (items.length) {
          const sorted = [...items].sort((a, b) => (parseInt(a.position, 10) || 0) - (parseInt(b.position, 10) || 0));
          // берём блок с максимальной позицией как якорь для следующего
          const newLast = sorted[sorted.length - 1];
          anchorPosition = newLast.position;
          createdBlockIds.push(String(newLast.block_id));
        }
      }
      // Небольшая пауза чтобы не дрочить API
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      log(`    ✗ ${e.message}`);
      failCount++;
    }
  }

  log(`\n✅ создано: ${successCount} блоков, ошибок: ${failCount}`);

  // Перезагружаем список блоков, чтобы появились новые
  log("→ обновляю список блоков...");
  $("loadBtn").click();

  // Ждём немного чтобы список обновился
  await new Promise(r => setTimeout(r, 1500));

  // v1.1: применяем стиль клиента к созданным блокам если включена галочка
  if (applyStyle) {
    const profile = getActiveProfile();
    if (profile) {
      const newBlocks = createdBlockIds
        .map(id => loadedBlocks.find(b => String(b.block_id) === String(id)))
        .filter(Boolean);
      if (newBlocks.length) {
        log(`\n→ применяю стиль клиента к ${newBlocks.length} новым блокам...`);
        await applyStyleProfileToBlocks(newBlocks, profile);
        // Перезагружаем ещё раз чтобы получить обновлённые css_settings
        log("→ перечитываю блоки после применения стилей...");
        $("loadBtn").click();
        await new Promise(r => setTimeout(r, 1500));
      } else {
        log("⚠ не удалось найти созданные блоки в обновлённом списке для применения стилей");
      }
    } else {
      log("⚠ стилевой профиль не найден — пропускаю применение стилей");
    }
  }

  // Запускаем генерацию текстов если включена галочка
  if (autoGenerate) {
    log("\n→ запускаю генерацию текстов для созданных блоков...");
    await generatePresetTexts(createdBlockIds, sections, preset);
  } else {
    log("💡 Блоки созданы. Теперь можно запустить генерацию текстов вручную.");
  }
}

// Генерация текстов для созданных блоков пресета, с учётом разбивки по разделам
async function generatePresetTexts(createdBlockIds, sections, preset) {
  const apiKey = $("apiKey").value.trim();
  const model = $("model").value.trim() || "gemini-3.1-flash-lite-preview";
  const globalBrief = $("brief").value.trim();
  if (!apiKey) return log("⚠ Gemini API key не задан — пропускаю генерацию");
  if (!globalBrief) return log("⚠ ТЗ пустое — пропускаю генерацию (можно заполнить потом вручную)");

  // Собираем блоки пресета среди свежезагруженных
  const presetBlocks = createdBlockIds
    .map(id => loadedBlocks.find(b => String(b.block_id) === String(id)))
    .filter(Boolean);

  if (!presetBlocks.length) {
    log("⚠ Не удалось найти созданные блоки в обновлённом списке. Попробуй нажать 'Загрузить блоки' и сгенерировать вручную.");
    return;
  }

  // Формируем промпт с учётом разделов
  log(`→ отправляю ${presetBlocks.length} блоков в Gemini с разбивкой на ${sections.length} разделов...`);

  const blocksForPrompt = presetBlocks.map(b => {
    const parsed = extractEditableFields(b);
    const type = detectBlockType(b);
    return {
      block_id: b.block_id,
      name: b.name || `Блок ${b.block_id}`,
      type,
      parsed,
      block: b,
    };
  }).filter(b => hasAnythingEditable(b.parsed));

  // Находим для каждого созданного блока его раздел по индексу в пресете
  // (createdBlockIds идут в том же порядке что и resolved, а resolved — в порядке пресета)
  const blockIdxToSection = {};
  let cursor = 0;
  presetState.resolved.forEach((r, resolvedIdx) => {
    if (r.status !== "ok") return;
    if (cursor >= createdBlockIds.length) return;
    const blockId = createdBlockIds[cursor];
    // Находим в каком разделе этот индекс пресета
    for (const section of sections) {
      if (section.blockIndexes.includes(resolvedIdx)) {
        blockIdxToSection[blockId] = section;
        break;
      }
    }
    cursor++;
  });

  // Строим промпт вручную — модифицированная версия buildPagePromptGenerate
  const blocksDescWithSections = [];
  let currentSectionLabel = null;
  blocksForPrompt.forEach((b, i) => {
    const section = blockIdxToSection[String(b.block_id)];
    if (section && section.label !== currentSectionLabel) {
      currentSectionLabel = section.label;
      const topicPart = section.topicHint ? ` — ${section.topicHint}` : "";
      blocksDescWithSections.push(`\n  📍 РАЗДЕЛ: ${section.label}${topicPart}`);
    }
    const hint = BLOCK_TYPE_HINTS[b.type] || BLOCK_TYPE_HINTS.generic;
    const fieldsDesc = describeBlockFields(b.parsed);
    blocksDescWithSections.push(`  Блок ${i + 1}: "${b.name}" [тип: ${b.type}] (id: ${b.block_id})
    Инструкция: ${hint}
    Поля:
${fieldsDesc}`);
  });

  const prompt = `Ты — опытный SEO-копирайтер. Пишешь текст для лендинга созданного по шаблону "${preset.name}". Страница разделена на логические разделы — каждый раздел состоит из нескольких блоков которые работают вместе.

ТЗ ОТ КЛИЕНТА:
${globalBrief}

СТРУКТУРА СТРАНИЦЫ (${blocksForPrompt.length} блоков, сгруппированы по разделам):

${blocksDescWithSections.join("\n\n")}

${GLOBAL_RULES}

ЗАДАЧА:
Сгенерируй связный текст для ВСЕХ блоков.
- Внутри одного раздела блоки работают вместе: заголовок раздела + описание + список/карточки — это единое целое по одной теме.
- Между разделами — логическая последовательность: от введения к деталям к призыву к действию.
- Не повторяй одинаковые мысли в разных разделах.
- Если у раздела есть явная тема (указана после названия) — строго следуй ей.
- Если темы нет — догадывайся по названию раздела и типам блоков в нём.

ДЛЯ БЛОКОВ СО СПИСКАМИ: сохраняй указанное количество элементов.

ОТВЕТ — строго JSON:
{
  "block_id_1": { "title": "...", "text": "..." },
  "block_id_2": { "title": "...", "questions_list": [...] }
}
Верни ВСЕ ${blocksForPrompt.length} блоков.`;

  let generated;
  try {
    generated = await callGemini(apiKey, model, prompt);
  } catch (e) {
    log("✗ Gemini: " + e.message);
    return;
  }

  const returnedIds = Object.keys(generated);
  log(`← получен ответ: ${returnedIds.length} блоков`);

  // В черновик
  const blocksMap = {};
  blocksForPrompt.forEach(b => { blocksMap[b.block_id] = { block: b.block, parsed: b.parsed }; });

  for (const [block_id, fields] of Object.entries(generated)) {
    const info = blocksMap[block_id];
    if (!info) continue;
    const cleanGenerated = sanitizeGeneratedForBlock(fields, info.parsed);
    if (!Object.keys(cleanGenerated).length) continue;
    draft[block_id] = {
      fields: cleanGenerated,
      block_name: info.block.name,
      ts: Date.now(),
    };
  }
  await saveDraft();
  updateDraftUI();

  log(`\n✅ в черновике: ${Object.keys(draft).length} блоков`);
  log("💡 Проверь результаты в карточках блоков и нажми «Применить черновик».");
}

// ================================================================
//                   v0.8: БИБЛИОТЕКА БЛОКОВ
// ================================================================

// Состояние модалки: anchor — относительно какого блока вставлять,
// insertType — before/after. Если anchor null — вставка в конец.
let libraryState = {
  anchorBlockId: null,
  insertType: null,
  currentView: "folders", // "folders" | "layouts"
  currentFolder: null,
  folders: [],
  layouts: [],
};

function openLibraryModal({ anchorBlockId, insertType }) {
  if (!pagePresetId) {
    log("⚠️ preset_id не определён. Загрузи блоки страницы.");
    return;
  }
  libraryState.anchorBlockId = anchorBlockId;
  libraryState.insertType = insertType;
  libraryState.currentView = "folders";
  libraryState.currentFolder = null;

  // Информативный заголовок
  let subtitle = "Выбери категорию";
  if (anchorBlockId && insertType) {
    const anchor = loadedBlocks.find(b => String(b.block_id) === String(anchorBlockId));
    if (anchor) {
      const side = insertType === "before" ? "перед" : "после";
      subtitle = `Вставить ${side}: ${anchor.name || anchor.block_id}`;
    }
  } else {
    subtitle = "Вставить в конец страницы";
  }
  $("librarySubtitle").textContent = subtitle;

  $("libraryModal").classList.add("open");
  loadFoldersIntoModal();
}

function closeLibraryModal() {
  $("libraryModal").classList.remove("open");
  libraryState.anchorBlockId = null;
  libraryState.insertType = null;
}
$("libraryClose").addEventListener("click", closeLibraryModal);
$("libraryModal").addEventListener("click", (e) => {
  if (e.target.id === "libraryModal") closeLibraryModal();
});

// v0.9: пресеты
$("presetsBtn")?.addEventListener("click", openPresetsModal);
$("presetsClose")?.addEventListener("click", closePresetsModal);
$("presetsModal")?.addEventListener("click", (e) => {
  if (e.target.id === "presetsModal") closePresetsModal();
});

// Кнопка "➕ Добавить блок" — добавление в конец страницы
$("addBlockBtn").addEventListener("click", () => {
  if (!loadedBlocks.length) {
    log("⚠️ Сначала загрузи блоки страницы.");
    return;
  }
  // Вставка в конец = after последнего блока
  const last = loadedBlocks[loadedBlocks.length - 1];
  openLibraryModal({ anchorBlockId: last.block_id, insertType: "after" });
});

async function loadFoldersIntoModal() {
  $("libraryTitle").textContent = "Добавить блок";
  $("libraryBody").innerHTML = `<div class="modal-loading">Загрузка категорий...</div>`;
  try {
    const r = await send({ type: "listFolders", preset_id: pagePresetId });
    if (!r?.ok) {
      $("libraryBody").innerHTML = `<div class="modal-loading">✗ ошибка: ${escape_(JSON.stringify(r).slice(0, 200))}</div>`;
      return;
    }
    const folders = r.data?.result || [];
    // Фильтруем скрытые категории (staff_only, popup, модули, меню — обычно не нужны)
    libraryState.folders = folders.filter(f => {
      const name = (f.name || "").toLowerCase();
      // Прячем технические категории которые обычно не нужны для наполнения контентом
      if (/всплывающ|модул|меню|вакансии/.test(name)) return false;
      return true;
    });
    renderFolders();
  } catch (e) {
    $("libraryBody").innerHTML = `<div class="modal-loading">✗ ${escape_(e.message)}</div>`;
  }
}

function renderFolders() {
  libraryState.currentView = "folders";
  const body = $("libraryBody");
  const folders = libraryState.folders;
  if (!folders.length) {
    body.innerHTML = `<div class="modal-loading">Категории не найдены</div>`;
    return;
  }
  const cards = folders.map(f => {
    const iconUrl = f.icon ? `${pageOrigin}${f.icon}` : "";
    const iconHtml = iconUrl
      ? `<div class="folder-icon"><img src="${escape_(iconUrl)}" alt=""></div>`
      : `<div class="folder-icon">📦</div>`;
    return `
      <div class="folder-card" data-folder-id="${escape_(f.folder_id)}" data-folder-name="${escape_(f.name)}">
        ${iconHtml}
        <div class="folder-name">${escape_(f.name)}</div>
      </div>
    `;
  }).join("");
  body.innerHTML = `<div class="folder-grid">${cards}</div>`;
  body.querySelectorAll(".folder-card").forEach(card => {
    card.addEventListener("click", () => {
      const folderId = card.dataset.folderId;
      const folderName = card.dataset.folderName;
      loadLayoutsIntoModal(folderId, folderName);
    });
  });
}

async function loadLayoutsIntoModal(folderId, folderName) {
  libraryState.currentFolder = { id: folderId, name: folderName };
  libraryState.currentView = "layouts";
  $("libraryTitle").textContent = folderName;
  $("libraryBody").innerHTML = `<div class="modal-loading">Загрузка шаблонов...</div>`;
  try {
    const r = await send({
      type: "listLayouts",
      folder_id: folderId,
      preset_id: pagePresetId,
    });
    if (!r?.ok) {
      $("libraryBody").innerHTML = `<div class="modal-loading">✗ ошибка: ${escape_(JSON.stringify(r).slice(0, 200))}</div>`;
      return;
    }
    const layouts = r.data?.result || [];
    // Фильтруем staff_only — они для сотрудников MegaGroup, обычному пользователю не нужны
    libraryState.layouts = layouts.filter(l => !l.staff_only);
    renderLayouts();
  } catch (e) {
    $("libraryBody").innerHTML = `<div class="modal-loading">✗ ${escape_(e.message)}</div>`;
  }
}

function renderLayouts() {
  const body = $("libraryBody");
  const layouts = libraryState.layouts;
  const backBtn = `<button class="modal-back" id="modalBackBtn">← Назад к категориям</button>`;
  if (!layouts.length) {
    body.innerHTML = backBtn + `<div class="modal-loading">В этой категории нет шаблонов</div>`;
    $("modalBackBtn").addEventListener("click", renderFolders);
    return;
  }
  const cards = layouts.map(l => {
    const previewUrl = l.image_path ? `${pageOrigin}${l.image_path}` : "";
    const imgHtml = previewUrl
      ? `<img class="layout-preview" src="${escape_(previewUrl)}" alt="" loading="lazy">`
      : `<div class="layout-preview"></div>`;
    return `
      <div class="layout-card" data-layout-id="${escape_(l.layout_id)}" data-layout-name="${escape_(l.name)}">
        ${imgHtml}
        <div class="layout-name">${escape_(l.name)}</div>
      </div>
    `;
  }).join("");
  body.innerHTML = backBtn + `<div class="layout-grid">${cards}</div>`;
  $("modalBackBtn").addEventListener("click", renderFolders);
  body.querySelectorAll(".layout-card").forEach(card => {
    card.addEventListener("click", () => {
      const layoutId = card.dataset.layoutId;
      const layoutName = card.dataset.layoutName;
      createBlockFromLibrary(layoutId, layoutName);
    });
  });
}

async function createBlockFromLibrary(layoutId, layoutName) {
  const variant_id = $("variantId").value.trim();
  if (!variant_id) return log("⚠️ variant_id не задан.");

  // Находим блок-якорь чтобы узнать его position
  const anchor = loadedBlocks.find(b => String(b.block_id) === String(libraryState.anchorBlockId));
  if (!anchor) return log("✗ блок-якорь не найден");
  const position = anchor.position;
  const insertType = libraryState.insertType;

  closeLibraryModal();
  log(`\n→ создаю блок "${layoutName}" (layout_id ${layoutId}) ${insertType === "after" ? "после" : "перед"} "${anchor.name}"...`);

  try {
    const r = await send({
      type: "createBlock",
      variant_id,
      layout_id: layoutId,
      position,
      insertType,
    });
    if (!r?.ok) {
      log(`✗ ошибка создания: ${JSON.stringify(r).slice(0, 300)}`);
      return;
    }
    log(`✓ блок создан`);
    // Автоматически перезагружаем список блоков чтобы увидеть новый
    log(`→ обновляю список блоков...`);
    $("loadBtn").click();
  } catch (e) {
    log("✗ " + e.message);
  }
}

// ================================================================
//                           СТАРТ
// ================================================================
loadSettings().then(async () => {
  setTimeout(() => tryAutoVariant(false), 300);
});
