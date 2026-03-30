// Конфигурация через переменные окружения (Vercel → Settings → Environment Variables).
// Локально: скопируйте .env.example → .env.local и заполните.

import { sendInvoiceRequestTo1C } from './lib/invoice-1c.js';
import { enrichCatalog } from './lib/catalog-enrich.js';

const MANAGER_CONTACT =
    '\n📞 Телефон: +7 (3012) 333-000\n📧 Email: sales@ameta.online';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_URL =
    process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
/** Список моделей: https://openrouter.ai/models — не используем openrouter/free (нестабильно на длинном каталоге). */
const OPENROUTER_MODEL =
    process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const OPENROUTER_MAX_TOKENS = Math.min(
    8192,
    Math.max(256, parseInt(process.env.OPENROUTER_MAX_TOKENS || '2048', 10) || 2048)
);
const SITE_URL =
    process.env.SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://ameta.online');
const CATALOG_URL =
    process.env.CATALOG_URL ||
    'https://raw.githubusercontent.com/asanuude/1c-data/main/catalog.json';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// Хранилище истории и корзины
const conversationHistory = new Map();
const shoppingCarts = new Map();

setInterval(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [key, value] of conversationHistory.entries()) {
        if (value.timestamp < oneHourAgo) conversationHistory.delete(key);
    }
    for (const [key, value] of shoppingCarts.entries()) {
        if (value.timestamp < oneHourAgo) shoppingCarts.delete(key);
    }
}, 60 * 60 * 1000);

/** Текст для поля «Описание» задачи менеджеру в 1С (история чата). */
function formatDialogTranscriptFor1C(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return '';
    const lines = [];
    for (const m of messages) {
        const role = m.role === 'assistant' ? 'Консультант' : 'Клиент';
        const text = String(m.content || '').trim();
        if (text) lines.push(`${role}: ${text}`);
    }
    return lines.join('\n\n');
}

let catalog = null;
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function loadCatalog() {
    const now = Date.now();
    if (catalog && now - lastFetch < CACHE_TTL) return catalog;
    
    try {
        const headers = {};
        if (GITHUB_TOKEN) {
            headers.Authorization = `token ${GITHUB_TOKEN}`;
        }
        const response = await fetch(CATALOG_URL, { headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        lastFetch = now;
        const raw = Array.isArray(data) ? data : (data.products || []);
        catalog = enrichCatalog(raw);
        return catalog;
    } catch (error) {
        return catalog || [];
    }
}

// Наличие: цена и остаток из CommerceML (число или строка)
function isInStock(p) {
    const qty = Number(p.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return false;
    const raw = p.price;
    if (raw === null || raw === undefined || raw === '') return false;
    if (typeof raw === 'string' && /не указан/i.test(raw)) return false;
    const pr = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(pr) && pr > 0;
}

function cartLineTotal(item) {
    const p =
        typeof item.price === 'number'
            ? item.price
            : parseFloat(String(item.price).replace(/\s/g, '').replace(',', '.')) || 0;
    return p * (item.quantity || 1);
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getOrCreateCart(sessionId) {
    if (!shoppingCarts.has(sessionId)) {
        shoppingCarts.set(sessionId, {
            items: [],
            timestamp: Date.now(),
            invoiceDraft: null,
        });
    }
    const c = shoppingCarts.get(sessionId);
    if (c.invoiceDraft === undefined) c.invoiceDraft = null;
    c.timestamp = Date.now();
    return c;
}

function isInvoiceCommand(q) {
    const l = String(q || '').toLowerCase();
    return (
        l.includes('счет') ||
        l.includes('счёт') ||
        l.includes('выпиши') ||
        l.includes('выставь') ||
        l.includes('оплату') ||
        l.includes('инвойс')
    );
}

function parseRussianInn(text) {
    const d = String(text).replace(/\D/g, '');
    if (d.length === 10 || d.length === 12) return d;
    return null;
}

/** Телефон для связи: не меньше 10 цифр (допускаются +7, 8, пробелы и скобки). */
function parseContactPhone(text) {
    let d = String(text || '').replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('8')) {
        d = '7' + d.slice(1);
    }
    if (d.length >= 10) {
        return d;
    }
    return null;
}

/** Нормализация для сопоставления с наименованием в каталоге */
function normalizeCatalogToken(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/(\d)\s*x(?=\s|$|[^\wа-яё])/gi, '$1х')
        .replace(/[-–—_/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Строка из ответа бота: «… | Цена: … | В наличии: …» — убрать хвост от первой «|». */
function stripPastedAssistantCatalogLine(text) {
    return String(text || '')
        .replace(/\s*\|[^\n]*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Закрытие количества без \b: в JS \b не работает после кириллицы («1 штуку» не срезалось). */
const QTY_END = '(?=\\s|$|[.,;!?…])';

/** Убирает «1 шт.», «3 штуки» и т.п. из запроса */
function stripQuantityPhrases(text) {
    const bareQty = new RegExp(
        `(?:^|[\\s,;])\\d+\\s*(?:шт\\.?|штук(?:и|а|у)?|pcs?)${QTY_END}`,
        'gi'
    );
    return String(text || '')
        .replace(/\(\s*\d+\s*(?:шт\.?|штук(?:и|а|у)?|pcs?)\s*\)/gi, ' ')
        .replace(bareQty, ' ')
        .replace(/\([\s.]*\)/g, ' ')
        .replace(/^\d+\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Убирает типовые слова про счёт/оплату — остаётся суть товара */
function stripInvoicePhrases(text) {
    return String(text || '')
        .replace(
            /сч(?:[её]|[eE])т(?:\s+на)?|на\s+оплату|(?:^|\s)оплату(?=\s|$|[.,;!?…])/gimu,
            ' '
        )
        .replace(
            /(?:^|\s)(?:дай|дайте|выпиши|выставь|выставьте|сделай|оформи|сформируй|нужен|нужна|нужно|мне|нам)(?=\s|$|[.,;!?…])/gimu,
            ' '
        )
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Убирает цену и служебные символы из строки, скопированной из ответа бота («— 62880 руб.»).
 */
/** Окончание суммы «руб»: нельзя использовать \b после кириллицы в JS (ё не «word char»). */
const RUB_END = '(?=\\s|[.,;!?()]|$)';

function stripCatalogNoise(text) {
    let s = stripPastedAssistantCatalogLine(String(text || '').trim());
    s = s.replace(/^\d+\.\s*/, '');
    const dashPrice = new RegExp(`\\s*[—–\\-]\\s*\\d[\\d\\s\\u00A0]*руб\\.?${RUB_END}`, 'gi');
    const barePrice = new RegExp(`\\b\\d[\\d\\s\\u00A0]*руб\\.?${RUB_END}`, 'gi');
    s = s.replace(dashPrice, ' ');
    s = s.replace(barePrice, ' ');
    s = s.replace(/[!?.…]+$/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

/** Количество из фразы «… 2 шт.» */
function extractQuantityFromText(text) {
    const m = String(text || '').match(
        new RegExp(`(\\d+)\\s*(?:шт\\.?|штук(?:и|а|у)?)${QTY_END}`, 'i')
    );
    if (!m) return 1;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n)) return 1;
    return Math.min(99, Math.max(1, n));
}

/**
 * Подбор одной позиции из каталога (в наличии): подстрока или все значимые токены в наименовании.
 */
/** Служебные слова запроса «покажи в наличии», не из названия товара */
function stripCatalogBrowseNoise(text) {
    return String(text || '')
        .replace(/\b(?:в\s+)?наличии\b/gi, ' ')
        .replace(
            /\b(?:подскажи|покажи|дайте?|дай|список|какие|какой|какая|какое|что\s+есть|есть\s+ли|что\s+у\s+вас|что\s+за|нужны?|нужен|нужна|хочу|посмотреть|интересуют|интересует|можете|можно|могу|могут|предложить|предложите|порекомендуйте|посоветуйте|расскажите|подскажите|на\s+сайте|сайт|вебсайт|весь|всю|все|всего|ассортимент|каталог|номенклатур|товары|продаете|продаёте|имеется|имеете)\b/gi,
            ' '
        )
        .replace(/\s+/g, ' ')
        .trim();
}

/** Токены вопроса, не участвующие в сопоставлении с наименованием */
const CATALOG_QUERY_STOPWORDS = new Set(
    [
        'какие',
        'какой',
        'какая',
        'какое',
        'что',
        'где',
        'есть',
        'ли',
        'для',
        'вас',
        'вам',
        'нам',
        'сайте',
        'сайт',
        'вебсайт',
        'можете',
        'можно',
        'могу',
        'могут',
        'предложить',
        'предложите',
        'подскажите',
        'расскажите',
        'посоветуйте',
        'товары',
        'товар',
        'все',
        'весь',
        'всю',
        'всего',
        'каталог',
        'ассортимент',
        'номенклатур',
        'продаете',
        'продаёте',
        'подскажи',
        'покажи',
        'дай',
        'дайте',
        'список',
        'нужен',
        'нужна',
        'нужны',
        'хочу',
        'посмотреть',
        'интересует',
        'интересуют',
        'имеется',
        'имеете',
        'наличии',
        'в',
        'на',
        'по',
        'из',
        'у',
        'и',
        'или',
        'а',
        'не',
        'то',
    ]
);

function catalogQueryTokens(qNorm) {
    return String(qNorm || '')
        .split(' ')
        .filter((t) => t.length >= 2 && !CATALOG_QUERY_STOPWORDS.has(t));
}

/** Общий вопрос «что есть на сайте / в каталоге» — показать выборку без узкого фильтра */
function isBroadCatalogListingIntent(question) {
    const raw = String(question || '').toLowerCase();
    return (
        /(?:какие|что|какой)\s+(?:товар|товары|есть)|товар(?:ы)?\s+(?:есть|на\s+сайте)|на\s+сайте|весь\s+каталог|все\s+товары|что\s+(?:у\s+вас|есть|прода)|ассортимент|номенклатур|что\s+можно\s+купить/i.test(
            raw
        )
    );
}

const BROWSE_FALLBACK_CAP = 100;

function resolveMatchedForPaging(question, productsForAI) {
    let matched = findAllCatalogMatches(question, productsForAI);
    if (matched.length >= CATALOG_PAGED_MIN) {
        return matched;
    }
    if (productsForAI.length < CATALOG_PAGED_MIN) {
        return matched;
    }
    if (isBroadCatalogListingIntent(question)) {
        return productsForAI.slice(0, BROWSE_FALLBACK_CAP);
    }
    return matched;
}

/**
 * Все позиции каталога по запросу (для пагинации на клиенте). Логика фильтра как у findBestCatalogMatch, но без выбора одной «лучшей».
 */
function findAllCatalogMatches(rawQuery, inStockProducts) {
    let q = String(rawQuery || '')
        .replace(/добавь|положи|в\s+корзину|пожалуйста/gi, ' ')
        .trim();
    q = stripCatalogNoise(q);
    q = stripQuantityPhrases(q);
    q = stripInvoicePhrases(q);
    q = stripCatalogBrowseNoise(q);
    q = normalizeCatalogToken(q);
    if (!q || q.length < 2) return [];

    const pool = inStockProducts.map((p) => ({
        p,
        n: normalizeCatalogToken(p.name || ''),
        h: p._searchHaystack || normalizeCatalogToken(p.name || ''),
    }));

    let hits = pool.filter(({ n, h }) => h.includes(q) || n.includes(q));
    if (hits.length === 0) {
        const tokens = catalogQueryTokens(q);
        if (tokens.length === 0) return [];
        hits = pool.filter(({ n, h }) => tokens.every((t) => h.includes(t) || n.includes(t)));
    }
    if (hits.length === 0) return [];

    hits.sort((a, b) => String(a.p.name).localeCompare(String(b.p.name), 'ru'));
    return hits.map((x) => x.p);
}

function serializeCatalogItem(p) {
    return {
        id: p.id || '',
        sku: p.sku || '',
        name: p.name || '',
        price: p.price,
        quantity: p.quantity,
    };
}

/** Полный нумерованный список для истории диалога (счёт, «пункт N»). */
function formatSessionCatalogMarkdown(products) {
    return products
        .map((p, i) => {
            const nm = sanitizeCatalogNameForAI(p.name);
            return `${i + 1}. ${nm} | Цена: ${p.price} руб. | В наличии: ${p.quantity} шт.`;
        })
        .join('\n');
}

const CATALOG_PAGED_MIN = 4;
const CATALOG_PAGE_SIZE_DEFAULT = 5;

const SHORT_INTRO_SYSTEM = `Ты — консультант AMETA по торговому оборудованию. Клиент увидит список товаров отдельным блоком на сайте.
Ответь ТОЛЬКО 1–2 коротких предложения по смыслу вопроса, дружелюбно.
ЗАПРЕЩЕНО: нумерованные списки, перечисление наименований и цен, таблицы. Не более 380 символов.`;

function findBestCatalogMatch(rawQuery, inStockProducts) {
    let q = String(rawQuery || '')
        .replace(/добавь|положи|в\s+корзину|пожалуйста/gi, ' ')
        .trim();
    q = stripCatalogNoise(q);
    q = stripQuantityPhrases(q);
    q = stripInvoicePhrases(q);
    q = stripCatalogBrowseNoise(q);
    q = normalizeCatalogToken(q);
    if (!q || q.length < 2) return null;

    const pool = inStockProducts.map((p) => ({
        p,
        n: normalizeCatalogToken(p.name || ''),
        h: p._searchHaystack || normalizeCatalogToken(p.name || ''),
    }));

    let hits = pool.filter(({ n, h }) => h.includes(q) || n.includes(q));
    if (hits.length === 0) {
        const tokens = catalogQueryTokens(q);
        if (tokens.length === 0) return null;
        hits = pool.filter(({ n, h }) => tokens.every((t) => h.includes(t) || n.includes(t)));
    }
    if (hits.length === 0) return null;

    const ambiguous = hits.length > 1;
    hits.sort((a, b) => {
        if (ambiguous) {
            return (
                b.n.length - a.n.length ||
                String(a.p.name).localeCompare(String(b.p.name), 'ru')
            );
        }
        return (
            a.n.length - b.n.length || String(a.p.name).localeCompare(String(b.p.name), 'ru')
        );
    });
    return hits[0].p;
}

/** Короткое «дай счёт» без названия товара (для поиска товара в истории). */
function isBareInvoiceRequest(text) {
    const t = String(text || '').trim();
    if (t.length > 55 || t.length < 4) return false;
    if (t.includes('|')) return false;
    if (!/(?:сч[её]т|счет)/iu.test(t)) return false;
    if (/\sна\s+\S{3,}/iu.test(t)) return false;
    return t.length <= 42;
}

/** Номерованные строки из ответа консультанта: «12. Название | …» */
function parseNumberedCatalogLinesFromAssistant(content) {
    const text = String(content || '');
    const out = [];
    const re = /^\s*(\d+)\.\s+([^\n|]+?)(?=\s*\||\s*$)/gim;
    let m;
    while ((m = re.exec(text)) !== null) {
        const idx = parseInt(m[1], 10);
        const name = stripPastedAssistantCatalogLine(m[2]).trim();
        if (name && Number.isFinite(idx)) out.push({ idx, name });
    }
    return out;
}

/**
 * Позиция для счёта: текущая фраза, пункт списка из последнего ответа ассистента, предыдущие реплики пользователя.
 */
function findProductForInvoice(session, question, inStockProducts, clientProductHint = '') {
    let g = findBestCatalogMatch(question, inStockProducts);
    if (g) return g;

    const hint = String(clientProductHint || '').trim();
    if (hint.length >= 8) {
        g = findBestCatalogMatch(hint, inStockProducts);
        if (g) return g;
    }

    const q = String(question || '').trim();
    const numHead = q.match(/^\s*(\d+)\.\s+/);
    if (numHead) {
        const wantIdx = parseInt(numHead[1], 10);
        for (let i = session.messages.length - 1; i >= 0; i--) {
            if (session.messages[i].role !== 'assistant') continue;
            const rows = parseNumberedCatalogLinesFromAssistant(session.messages[i].content);
            const row = rows.find((r) => r.idx === wantIdx);
            if (row) {
                g = findBestCatalogMatch(row.name, inStockProducts);
                if (g) return g;
            }
        }
    }

    const msgs = session.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role !== 'user') continue;
        const prev = msgs[i].content;
        if (isBareInvoiceRequest(prev)) continue;
        if (String(prev).trim().length < 6) continue;
        g = findBestCatalogMatch(prev, inStockProducts);
        if (g) return g;
    }

    for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role !== 'assistant') continue;
        const hint = String(msgs[i].content).match(
            /сч[её]т\s+на\s*[«"]([^»"]+)[»"]/iu
        );
        if (hint) {
            g = findBestCatalogMatch(hint[1], inStockProducts);
            if (g) return g;
        }
    }

    return null;
}

function formatInvoiceLinksBlock(onec) {
    const parts = [];
    const pdf = (onec.pdfUrl || onec.documentUrl || '').trim();
    const view = (onec.viewUrl || '').trim();
    if (view) {
        if (/^https?:\/\//i.test(view)) {
            parts.push(`[Открыть в браузере](${view})`);
        } else {
            parts.push(
                `Навигационная ссылка 1С (часто открывается из **того же** веб-клиента базы):\n\`${view}\``
            );
        }
    }
    if (pdf && /^https?:\/\//i.test(pdf)) {
        parts.push(`[Скачать PDF счёта](${pdf})`);
    } else if (view && /^https?:\/\//i.test(view) && /\.pdf(\?|$)/i.test(view)) {
        parts.push(`[Скачать PDF счёта](${view})`);
    }
    const oid = (onec.orderId || '').trim();
    const iid = (onec.invoiceId || '').trim();
    if (oid) {
        parts.push(`УИД заказа (для поиска в 1С): \`${escapeHtml(oid)}\``);
    }
    if (iid) {
        parts.push(`УИД счёта на оплату: \`${escapeHtml(iid)}\``);
    }
    if (parts.length === 0) {
        parts.push(
            'Прямой PDF в ответе 1С пока не отдаётся — документы смотрите в 1С по номеру или попросите PDF у менеджера.'
        );
    }
    return `\n\n${parts.join('\n')}`;
}

// Функция для получения случайных товаров (резервный вариант)
function getRandomProducts(products, count = 3) {
    const inStock = products.filter(isInStock);
    return inStock.sort(() => 0.5 - Math.random()).slice(0, count);
}

/** Лимит строк каталога в промпте ИИ: пусто / all / full = весь каталог; иначе положительное число. */
function parseAskCatalogMaxItems() {
    const raw = process.env.ASK_CATALOG_MAX_ITEMS;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return Infinity;
    }
    const s = String(raw).trim().toLowerCase();
    if (s === 'all' || s === 'full') {
        return Infinity;
    }
    const n = parseInt(s, 10);
    if (!Number.isFinite(n) || n <= 0) {
        return Infinity;
    }
    return n;
}
const ASK_CATALOG_MAX_ITEMS_EFFECTIVE = parseAskCatalogMaxItems();

/** Имя в строке каталога для ИИ: не ломать разделитель « | Цена: » */
function sanitizeCatalogNameForAI(name) {
    return String(name || '')
        .replace(/\|/g, '¦')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Одна позиция в контексте модели: цена, остаток, автосинонимы и ручные aliases из JSON. */
function formatCatalogLineForAI(p) {
    const nm = sanitizeCatalogNameForAI(p.name);
    const base = `- ${nm} | Цена: ${p.price} руб. | В наличии: ${p.quantity} шт.`;
    const aliases = Array.isArray(p._aliases) ? p._aliases : [];
    const nameNorm = normalizeCatalogToken(p.name || '');
    const show = aliases
        .filter((a) => normalizeCatalogToken(a) !== nameNorm)
        .slice(0, 18);
    if (!show.length) return base;
    return `${base} | Поиск: ${show.join(', ')}`;
}

/**
 * Весь каталог (в наличии) в контекст консультанта, без усечения по теме запроса.
 * @returns {{ products: object[], source: 'full'|'capped' }}
 */
function selectProductsForConsultant(_question, inStockProducts) {
    let list = inStockProducts;
    if (
        Number.isFinite(ASK_CATALOG_MAX_ITEMS_EFFECTIVE) &&
        ASK_CATALOG_MAX_ITEMS_EFFECTIVE < list.length
    ) {
        return {
            products: list.slice(0, ASK_CATALOG_MAX_ITEMS_EFFECTIVE),
            source: 'capped',
        };
    }
    return { products: list, source: 'full' };
}

// АВТОМАТИЧЕСКОЕ ОПРЕДЕЛЕНИЕ КАТЕГОРИЙ
function getCategoryStats(products) {
    const stats = {};
    const categoryKeywords = {
        'кассовые аппараты': ['ккм', 'касс', 'фр', 'фискальн'],
        'весы': ['вес', 'вэт', 'вр', 'мк'],
        'сканеры': ['скан', 'barcode'],
        'терминалы': ['терминал', 'тсд'],
        'pos-системы': ['pos', 'комп', 'моноблок'],
        'принтеры': ['принтер', 'печат', 'fprint'],
        'комплектующие': ['блок', 'плата', 'модуль', 'кнопк', 'кабель'],
        'пищевое оборудование': ['пище', 'кафе', 'ресторан', 'кухн'],
        'торговое оборудование': ['торг', 'магазин', 'витрин'],
        'весовое оборудование': ['вес', 'гир', 'платформ'],
        'кассовое оборудование': ['касс', 'ккм', 'денежн'],
        'складское оборудование': ['склад', 'стеллаж', 'полк'],
        'холодильное оборудование': ['холод', 'мороз', 'рефриж'],
        'упаковочное оборудование': ['упак', 'пленк', 'термо'],
        'фасовочное оборудование': ['фас', 'дозатор'],
        'оборудование для общепита': ['пище', 'столов', 'кафе', 'ресторан']
    };
    
    for (const cat in categoryKeywords) {
        stats[cat] = { count: 0, examples: [] };
    }
    stats['прочее'] = { count: 0, examples: [] };
    
    products.forEach(p => {
        if (!isInStock(p)) return;
        
        const name = (p.name || '').toLowerCase();
        let assigned = false;
        
        for (const [cat, keywords] of Object.entries(categoryKeywords)) {
            if (keywords.some(keyword => name.includes(keyword))) {
                stats[cat].count++;
                if (stats[cat].examples.length < 3) {
                    stats[cat].examples.push(p.name);
                }
                assigned = true;
                break;
            }
        }
        
        if (!assigned) {
            stats['прочее'].count++;
            if (stats['прочее'].examples.length < 3) {
                stats['прочее'].examples.push(p.name);
            }
        }
    });
    
    for (const cat in stats) {
        if (stats[cat].count === 0) {
            delete stats[cat];
        }
    }
    
    return stats;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { question, sessionId = 'default', lastUserProductQuery = '' } = req.body;
        
        console.log('🔍 ПОЛУЧЕН ЗАПРОС:', JSON.stringify({ question, sessionId }));
        
        const products = await loadCatalog();
        
        if (!conversationHistory.has(sessionId)) {
            conversationHistory.set(sessionId, { 
                messages: [], 
                timestamp: Date.now() 
            });
        }
        const session = conversationHistory.get(sessionId);
        session.timestamp = Date.now();
        
        const lowerQ = question.toLowerCase().trim();

        const pushAndReturn = (text) => {
            session.messages.push({ role: 'user', content: question });
            session.messages.push({ role: 'assistant', content: text });
            return res.status(200).json({ answer: text });
        };

        const tq = question.trim();
        if (tq.length <= 70) {
            const onlySmallTalk =
                /^(привет|здравствуй|здравствуйте|добрый(\s+(день|вечер|утро))?)[!.?\s]*$/iu.test(
                    tq
                ) ||
                /^как\s+дела[!.?\s]*$/iu.test(tq) ||
                /^что\s+нового[!.?\s]*$/iu.test(tq) ||
                /^как\s+поживаете[!.?\s]*$/iu.test(tq);
            if (onlySmallTalk) {
                return pushAndReturn(
                    'Здравствуйте. По наличию и подбору оборудования напишите, что нужно — например: «сканеры штрихкода», «холодильники в наличии».'
                );
            }
        }

        // Отмена пошагового счёта
        const cartExisting = shoppingCarts.has(sessionId) ? shoppingCarts.get(sessionId) : null;
        if (
            cartExisting?.invoiceDraft &&
            /отмен|не\s*надо|хватит|^стоп$|отказ/i.test(lowerQ)
        ) {
            cartExisting.invoiceDraft = null;
            cartExisting.timestamp = Date.now();
            return pushAndReturn(
                'Оформление счёта **отменено**. Корзина сохранена — можете снова написать «выпиши счёт».'
            );
        }

        // Ответ на вопрос про организацию
        if (cartExisting?.invoiceDraft?.step === 'await_org') {
            if (!cartExisting.items?.length) {
                cartExisting.invoiceDraft = null;
                return pushAndReturn(
                    'Корзина пуста — добавьте товары, затем снова запросите счёт.'
                );
            }
            if (isInvoiceCommand(question)) {
                return pushAndReturn(
                    'Вы уже оформляете счёт. Напишите одним сообщением **наименование организации** (не повторяйте «выпиши счёт»).'
                );
            }
            const org = question.trim();
            if (org.length < 2) {
                return pushAndReturn(
                    'Уточните, пожалуйста: **на какую организацию выставить счёт?** (полное или краткое наименование).'
                );
            }
            cartExisting.invoiceDraft = { step: 'await_inn', organizationName: org };
            cartExisting.timestamp = Date.now();
            const safeOrg = escapeHtml(org).replace(/\*/g, '');
            return pushAndReturn(
                `Организация: **${safeOrg}**\n\n` +
                    `ИНН (10 или 12 цифр). **Отмена** — прервать.`
            );
        }

        // Ответ с ИНН → шаг телефона
        if (cartExisting?.invoiceDraft?.step === 'await_inn') {
            if (!cartExisting.items?.length) {
                cartExisting.invoiceDraft = null;
                return pushAndReturn('Корзина пуста — начните с добавления товаров.');
            }
            if (isInvoiceCommand(question)) {
                return pushAndReturn(
                    'Сейчас нужен **ИНН** (10 или 12 цифр). Введите его одним сообщением или напишите **отмена**.'
                );
            }
            const inn = parseRussianInn(question);
            if (!inn) {
                return pushAndReturn(
                    'ИНН не распознан. Нужно **10** или **12** цифр подряд (например 032600556314). Попробуйте ещё раз.'
                );
            }
            const organizationName = cartExisting.invoiceDraft.organizationName || '';
            cartExisting.invoiceDraft = {
                step: 'await_phone',
                organizationName,
                inn,
            };
            cartExisting.timestamp = Date.now();
            const safeOrg = escapeHtml(organizationName).replace(/\*/g, '');
            return pushAndReturn(
                `${safeOrg}, ИНН **${inn}**\n\n` +
                    `**Телефон для связи** (мобильный или городской, не меньше 10 цифр). **Отмена** — прервать.`
            );
        }

        // Телефон → вызов 1С (заказ + счёт)
        if (cartExisting?.invoiceDraft?.step === 'await_phone') {
            if (!cartExisting.items?.length) {
                cartExisting.invoiceDraft = null;
                return pushAndReturn('Корзина пуста — начните с добавления товаров.');
            }
            if (isInvoiceCommand(question)) {
                return pushAndReturn(
                    'Сейчас нужен **телефон** для связи. Введите номер одним сообщением или напишите **отмена**.'
                );
            }
            const phone = parseContactPhone(question);
            if (!phone) {
                return pushAndReturn(
                    'Телефон не распознан. Укажите **не меньше 10 цифр** (например +7 903 123-45-67).'
                );
            }
            const organizationName = cartExisting.invoiceDraft.organizationName || '';
            const inn = cartExisting.invoiceDraft.inn || '';
            cartExisting.invoiceDraft = null;
            cartExisting.timestamp = Date.now();

            const itemsList = cartExisting.items
                .map(
                    (item) =>
                        `- ${item.name} (${item.quantity} шт.) — ${cartLineTotal(item)} руб.`
                )
                .join('\n');
            const total = cartExisting.items.reduce((sum, item) => sum + cartLineTotal(item), 0);

            const dialogFor1c = [...session.messages, { role: 'user', content: question }];
            const chatTranscript = formatDialogTranscriptFor1C(dialogFor1c);

            const onec = await sendInvoiceRequestTo1C({
                sessionId,
                items: cartExisting.items,
                counterparty: { organizationName, inn, phone },
                chatTranscript,
            });

            let mid = '';
            if (!onec.configured) {
                mid = `\n\n⚠️ Вебхук 1С не настроен в Vercel (**ONEC_INVOICE_WEBHOOK_***).`;
            } else if (onec.ok) {
                const ord = onec.orderNumber ? ` **Заказ клиента № ${escapeHtml(onec.orderNumber)}**.` : '';
                const inv = onec.invoiceNumber
                    ? ` **Счёт на оплату № ${escapeHtml(onec.invoiceNumber)}**.`
                    : ' Счёт на оплату создан или совпадает с номером заказа.';
                mid =
                    `\n\n✅ В базе 1С созданы документы.${ord}${inv}` +
                    formatInvoiceLinksBlock(onec);
            } else {
                mid = `\n\n⚠️ **1С:** ${escapeHtml(onec.error || 'ошибка')}`;
            }

            const safeOrg = escapeHtml(organizationName).replace(/\*/g, '');
            const safePhone = escapeHtml(phone).replace(/\*/g, '');
            const answer =
                `${safeOrg}, ИНН **${inn}**, тел. **${safePhone}**\n\n${itemsList}\n**Итого: ${total} руб.**` +
                mid +
                (onec.ok ? `\n\nВопросы:${MANAGER_CONTACT}` : `\n\n${MANAGER_CONTACT}`);

            return pushAndReturn(answer);
        }

        // 1️⃣ Старт: запрос счёта → сначала организация и ИНН
        if (isInvoiceCommand(question)) {
            const cart = getOrCreateCart(sessionId);
            const inStock = products.filter(isInStock);

            if (cart.items.length === 0) {
                const guessed = findProductForInvoice(
                    session,
                    question,
                    inStock,
                    lastUserProductQuery
                );
                if (guessed) {
                    const qty = extractQuantityFromText(question);
                    cart.items = [
                        {
                            id: guessed.id || '',
                            sku: guessed.sku || '',
                            name: guessed.name,
                            price: guessed.price,
                            quantity: qty,
                        },
                    ];
                    cart.timestamp = Date.now();
                } else {
                    return pushAndReturn(
                        'Товар не распознан. Напишите, например: **счёт на Мясорубка МИМ-80** или **добавь МИМ-80 в корзину**.'
                    );
                }
            }

            cart.invoiceDraft = { step: 'await_org' };
            const lines = cart.items
                .map((i) => `- **${i.name}** — ${i.quantity} шт. (${cartLineTotal(i)} руб.)`)
                .join('\n');
            const answer = `В счёте:\n${lines}\n\n**Наименование организации**, затем **ИНН** и **телефон для связи**. **Отмена** — отменить.`;
            return pushAndReturn(answer);
        }
        
        // 2️⃣ ДОБАВЛЕНИЕ В КОРЗИНУ
        if (lowerQ.includes('добавь') || lowerQ.includes('положи') || lowerQ.includes('в корзину')) {
            const searchQuery = question.replace(/добавь|положи|в корзину|пожалуйста/gi, '').trim();

            if (!searchQuery) {
                const answer = `Что именно добавить? Например: «добавь детектор IRD-1000» или «Мясорубка ТС-32 — в корзину 1 шт.»`;
                session.messages.push({ role: 'user', content: question });
                session.messages.push({ role: 'assistant', content: answer });
                return res.status(200).json({ answer });
            }

            const inStock = products.filter(isInStock);
            const product = findBestCatalogMatch(searchQuery, inStock);
            const addQty = extractQuantityFromText(question);

            if (product) {
                const cart = getOrCreateCart(sessionId);

                const existing = cart.items.find((item) => item.name === product.name);
                if (existing) {
                    existing.quantity += addQty;
                } else {
                    cart.items.push({
                        id: product.id || '',
                        sku: product.sku || '',
                        name: product.name,
                        price: product.price,
                        quantity: addQty,
                    });
                }
                cart.timestamp = Date.now();
                
                const answer = `✅ **${product.name}** добавлен в корзину.\n` +
                    `Цена: ${product.price} руб.\n\n` +
                    `В корзине сейчас ${cart.items.length} товаров на сумму ${cart.items.reduce((sum, item) => sum + cartLineTotal(item), 0)} руб.\n\n` +
                    `Чтобы оформить заказ, напишите **«выпиши счёт»** — спросим организацию, ИНН и телефон, затем отправим данные в 1С.`;
                
                session.messages.push({ role: 'user', content: question });
                session.messages.push({ role: 'assistant', content: answer });
                
                return res.status(200).json({ answer });
            } else {
                const short = stripQuantityPhrases(
                    searchQuery.replace(/добавь|положи|в\s+корзину|пожалуйста/gi, ' ').trim()
                );
                const answer =
                    `Товар по запросу «${escapeHtml(short)}» в наличии не нашёл. Напишите **как в каталоге** ` +
                    `(например *Мясорубка ТС-32* — без лишних слов «1 шт.» в середине названия), ` +
                    `или скопируйте строку из моего предыдущего списка **до знака «|»**.`;
                session.messages.push({ role: 'user', content: question });
                session.messages.push({ role: 'assistant', content: answer });
                return res.status(200).json({ answer });
            }
        }
        
        // 3️⃣ ПОКАЗАТЬ КОРЗИНУ
        // Не путать с «заказ на сумму / доставку заказа» — только просмотр корзины
        const wantsCartSummary =
            lowerQ.includes('корзин') ||
            lowerQ.includes('что выбрал') ||
            /\bмой\s+заказ\b/.test(lowerQ) ||
            (/\bпокажи\b/u.test(lowerQ) && lowerQ.includes('заказ'));
        if (wantsCartSummary) {
            
            let answer;
            if (shoppingCarts.has(sessionId) && shoppingCarts.get(sessionId).items.length > 0) {
                const cart = shoppingCarts.get(sessionId);
                const itemsList = cart.items.map(item => 
                    `- ${item.name} — ${item.price} руб. (${item.quantity} шт.)`
                ).join('\n');
                const total = cart.items.reduce((sum, item) => sum + cartLineTotal(item), 0);
                
                answer = `**Ваша корзина:**\n\n${itemsList}\n\n**Итого: ${total} руб.**\n\n` +
                    `Если хотите оформить заказ, напишите **«выпиши счёт»** — уточним организацию, ИНН и телефон.`;
            } else {
                answer = `Ваша корзина пуста. Добавьте товары, например: "добавь сканер" или "положи в корзину весы".`;
            }
            
            session.messages.push({ role: 'user', content: question });
            session.messages.push({ role: 'assistant', content: answer });
            
            return res.status(200).json({ answer });
        }
        
        // 4️⃣ СИСТЕМНЫЙ ПРОМПТ
        const systemPrompt = `Ты — консультант AMETA (торговое и кухонное оборудование, кассы, весы, холод, склад).

ФОРМАТ: 1–2 коротких предложения + нумерованный список. В каждой позиции **полное наименование** из каталога (как в строке до « | Цена:»), цена и остаток — **точно как в строке**. Не обрывай название на скобке «(» или на «2D |». Символ ¦ в названии заменяет вертикальную черту.
В каждой строке каталога может быть поле **«Поиск:»** — это синонимы, артикулы и варианты написания; используй их, чтобы сопоставить вопрос клиента с позицией.
Не пиши общих фраз вроде «у нас всё хорошо» или выдуманных новостей компании.
Если в **переданном ниже** списке нет подходящей позиции — одна фраза: совпадений нет, предложи уточнить тип/бренд/артикул; не утверждай, что товара нет на складе, если его не было в этом списке.
Контакты менеджера — только по запросу счёта/доставки или если список пуст.
После списка одна строка: счёт — «счёт на [точное название]» или «добавь [название] в корзину».`;

        // 5️⃣ ОПРЕДЕЛЯЕМ, ЭТО ЗАПРОС ПОМОЩИ
        // Без сырого «что есть» — иначе срабатывает на «что есть в наличии до … руб»
        const isHelpRequest =
            /помоги|посоветуй|категори|какие\s+разделы|что\s+у\s+вас\s+в\s+продаже|расскажи/i.test(
                question
            );
        
        if (isHelpRequest) {
            const stats = getCategoryStats(products);
            
            let answer = `**В нашем каталоге сейчас в наличии:**\n\n`;
            
            for (const [cat, data] of Object.entries(stats)) {
                if (data.count > 0) {
                    answer += `✅ **${cat}**: ${data.count} товаров\n`;
                    if (data.examples.length > 0) {
                        answer += `   Например: ${data.examples.join(', ')}\n`;
                    }
                }
            }
            
            answer += `\n📦 Также в наличии более 1000 различных комплектующих.\n\n`;
            answer += `Что именно вас интересует? Я помогу подобрать!`;
            
            session.messages.push({ role: 'user', content: question });
            session.messages.push({ role: 'assistant', content: answer });
            
            return res.status(200).json({ answer });
        }
        
        // 6️⃣ ВСЕ ОСТАЛЬНЫЕ ЗАПРОСЫ — ИСПОЛЬЗУЕМ AI КАК КОНСУЛЬТАНТА
        console.log('🔍 КОНСУЛЬТАНТ (запрос):', question);
        
        const inStockProducts = products.filter(isInStock);
        console.log('🔍 ВСЕГО ТОВАРОВ В НАЛИЧИИ:', inStockProducts.length);
        
        const { products: productsForAI, source: catalogSource } = selectProductsForConsultant(
            question,
            inStockProducts
        );
        console.log('🔍 ТОВАРОВ ПЕРЕДАНО AI:', productsForAI.length, 'источник:', catalogSource);

        const matchedForPaging = resolveMatchedForPaging(question, productsForAI);
        if (matchedForPaging.length >= CATALOG_PAGED_MIN) {
            let intro = '';
            if (OPENROUTER_API_KEY) {
                try {
                    const introRes = await fetch(OPENROUTER_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                            'HTTP-Referer': SITE_URL,
                        },
                        body: JSON.stringify({
                            model: OPENROUTER_MODEL,
                            messages: [
                                { role: 'system', content: SHORT_INTRO_SYSTEM },
                                {
                                    role: 'user',
                                    content:
                                        `Вопрос клиента: "${question}"\n\n` +
                                        `По каталогу подобрано позиций: ${matchedForPaging.length}. Список товаров покажет интерфейс сайта (не перечисляй товары).`,
                                },
                            ],
                            temperature: 0.3,
                            max_tokens: 400,
                        }),
                    });
                    if (introRes.ok) {
                        const jd = await introRes.json();
                        intro = (jd.choices?.[0]?.message?.content || '').trim();
                    }
                } catch (e) {
                    console.error('short intro AI:', e);
                }
            }
            if (!intro || intro.length < 12) {
                intro =
                    `Нашёл **${matchedForPaging.length}** позиций по запросу. Список ниже — листайте кнопкой **«Дальше»**.`;
            }
            const fullList = formatSessionCatalogMarkdown(matchedForPaging);
            const assistantFull =
                `${intro}\n\n${fullList}\n\n` +
                `Счёт — «счёт на [точное название из списка]» или «добавь [название] в корзину».`;
            session.messages.push({ role: 'user', content: question });
            session.messages.push({ role: 'assistant', content: assistantFull });
            if (session.messages.length > 20) {
                session.messages = session.messages.slice(-20);
            }
            return res.status(200).json({
                answer: intro,
                catalogItems: matchedForPaging.map(serializeCatalogItem),
                catalogPageSize: CATALOG_PAGE_SIZE_DEFAULT,
            });
        }

        const catalogContext =
            productsForAI.length > 0
                ? productsForAI.map((p) => formatCatalogLineForAI(p)).join('\n')
                : '(список пуст — нет позиций в наличии в каталоге)';
        
        // Добавляем историю диалога (последние 6 сообщений)
        const recentMessages = session.messages.slice(-6);
        
        if (!OPENROUTER_API_KEY) {
            const answer =
                'Консультант временно недоступен: не настроен API-ключ ИИ (OPENROUTER_API_KEY). Обратитесь к администратору сайта.';
            session.messages.push({ role: 'user', content: question });
            session.messages.push({ role: 'assistant', content: answer });
            return res.status(200).json({ answer });
        }

        try {
            const aiResponse = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'HTTP-Referer': SITE_URL
                },
                body: JSON.stringify({
                    model: OPENROUTER_MODEL,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...recentMessages,
                        {
                            role: 'user',
                            content: `Каталог (режим ${catalogSource}: ${productsForAI.length} позиций в наличии в этом сообщении). В каждой строке — наименование, цена, остаток; поле «Поиск:» — синонимы и варианты для подбора. Копируй наименование целиком до « | Цена:».\n\n${catalogContext}\n\nВопрос: "${question}"\n\nОтветь только по этим строкам.`
                        }
                    ],
                    temperature: 0.25,
                    max_tokens: OPENROUTER_MAX_TOKENS
                })
            });
            
            if (aiResponse.ok) {
                const aiData = await aiResponse.json();
                let answer = aiData.choices?.[0]?.message?.content;
                
                // Если ответ пустой или слишком короткий
                if (!answer || answer.length < 10) {
                    const randomProducts = getRandomProducts(products, 3);
                    answer = `**По вашему запросу ничего не найдено в текущей выборке.**\n\n` +
                        `Возможно, вас заинтересуют эти товары в наличии:\n\n` +
                        randomProducts.map(p => 
                            `- **${p.name}**\n  💰 ${p.price} руб. (📦 ${p.quantity} шт.)`
                        ).join('\n\n') +
                        `\n\nИли уточните запрос и попробуйте снова.`;
                }
                
                session.messages.push({ role: 'user', content: question });
                session.messages.push({ role: 'assistant', content: answer });
                
                if (session.messages.length > 20) {
                    session.messages = session.messages.slice(-20);
                }
                
                return res.status(200).json({ answer });
            } else {
                throw new Error(`OpenRouter error: ${aiResponse.status}`);
            }
        } catch (error) {
            console.error('OpenRouter error:', error);
            
            // Резервный ответ
            const randomProducts = getRandomProducts(products, 3);
            const answer = `**По вашему запросу ничего не найдено.**\n\n` +
                `Возможно, вас заинтересуют эти товары в наличии:\n\n` +
                randomProducts.map(p => 
                    `- **${p.name}**\n  💰 ${p.price} руб. (📦 ${p.quantity} шт.)`
                ).join('\n\n') +
                `\n\nИли уточните запрос и попробуйте снова.`;
            
            session.messages.push({ role: 'user', content: question });
            session.messages.push({ role: 'assistant', content: answer });
            
            if (session.messages.length > 20) {
                session.messages = session.messages.slice(-20);
            }
            
            return res.status(200).json({ answer });
        }

    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ answer: 'Ошибка, попробуйте позже.' });
    }
}