// Конфигурация через переменные окружения (Vercel → Settings → Environment Variables).
// Локально: скопируйте .env.example → .env.local и заполните.

import { sendInvoiceRequestTo1C } from './lib/invoice-1c.js';

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
        catalog = Array.isArray(data) ? data : (data.products || []);
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
    const l = q.toLowerCase();
    return (
        l.includes('счет') ||
        l.includes('счёт') ||
        l.includes('выпиши') ||
        l.includes('оплату')
    );
}

function parseRussianInn(text) {
    const d = String(text).replace(/\D/g, '');
    if (d.length === 10 || d.length === 12) return d;
    return null;
}

/** Нормализация для сопоставления с наименованием в каталоге */
function normalizeCatalogToken(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/[-–—_/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Убирает «1 шт.», «3 штуки» и т.п. из запроса */
function stripQuantityPhrases(text) {
    return String(text || '')
        .replace(/\(\s*\d+\s*(?:шт\.?|штук(?:и|а)?|pcs?)\s*\)/gi, ' ')
        .replace(/\b\d+\s*(?:шт\.?|штук(?:и|а)?|pcs?)\b/gi, ' ')
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
            /(?:^|\s)(?:дай|дайте|выпиши|сделай|оформи|сформируй|нужен|нужна|нужно|мне|нам)(?=\s|$|[.,;!?…])/gimu,
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
    let s = String(text || '').trim();
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
    const m = String(text || '').match(/(\d+)\s*(?:шт\.?|штук(?:и|а)?)\b/i);
    if (!m) return 1;
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n)) return 1;
    return Math.min(99, Math.max(1, n));
}

/**
 * Подбор одной позиции из каталога (в наличии): подстрока или все значимые токены в наименовании.
 */
function findBestCatalogMatch(rawQuery, inStockProducts) {
    let q = String(rawQuery || '')
        .replace(/добавь|положи|в\s+корзину|пожалуйста/gi, ' ')
        .trim();
    q = stripCatalogNoise(q);
    q = stripQuantityPhrases(q);
    q = stripInvoicePhrases(q);
    q = normalizeCatalogToken(q);
    if (!q || q.length < 2) return null;

    const pool = inStockProducts.map((p) => ({
        p,
        n: normalizeCatalogToken(p.name || ''),
    }));

    let hits = pool.filter(({ n }) => n.includes(q));
    if (hits.length === 0) {
        const tokens = q.split(' ').filter((t) => t.length >= 2);
        if (tokens.length === 0) return null;
        hits = pool.filter(({ n }) => tokens.every((t) => n.includes(t)));
    }
    if (hits.length === 0) return null;

    hits.sort((a, b) => a.n.length - b.n.length || String(a.p.name).localeCompare(String(b.p.name), 'ru'));
    return hits[0].p;
}

function formatInvoiceLinksBlock(onec) {
    const parts = [];
    const pdf = (onec.pdfUrl || onec.documentUrl || '').trim();
    const view = (onec.viewUrl || '').trim();
    if (view && /^https?:\/\//i.test(view)) {
        parts.push(`[Открыть в браузере](${view})`);
    }
    if (pdf && /^https?:\/\//i.test(pdf)) {
        parts.push(`[Скачать PDF счёта](${pdf})`);
    } else if (view && /^https?:\/\//i.test(view) && /\.pdf(\?|$)/i.test(view)) {
        parts.push(`[Скачать PDF счёта](${view})`);
    }
    if (parts.length === 0) {
        parts.push('PDF в ответе нет — счёт уточнит менеджер.');
    }
    return `\n\n${parts.join('\n')}`;
}

// Функция для получения случайных товаров (резервный вариант)
function getRandomProducts(products, count = 3) {
    const inStock = products.filter(isInStock);
    return inStock.sort(() => 0.5 - Math.random()).slice(0, count);
}

// Подсказки: вопрос → подстроки в наименовании (каталог 4000+ позиций — в модель нельзя слать только «первые 200»)
const CATALOG_QUERY_HINTS = [
    {
        test: /касс|ккт|ккм|рро|фр\s|фиск|онлайн[\s-]?касс|чеков|эвотор|evotor|атол|atol|штрих|дримкас|арчер|каспик|автономн|регистратор|фн\s|офд/i,
        keys: [
            'ккм', 'касс', 'ккт', 'рро', 'фр-', 'фр ', 'фиск', 'онлайн', 'эвотор', 'evotor', 'атол', 'atol',
            'штрих', 'дримкас', 'арчер', 'каспик', 'pos', 'pos-', 'фн', 'офд', 'чек', 'каспро', 'viki',
            'смарт-терминал', 'терминал сбора', 'тсд', 'fprint', 'pay', 'pax', 'ingenico'
        ]
    },
    {
        test: /вес|вэ[тн]|вр\s|масса|торговые вес/i,
        keys: ['вес', 'вэт', 'вр-', 'мк-', 'масса-к', 'электронн', 'торгов', 'платформ', 'штуц', 'днепр']
    },
    {
        test: /сканер|штрих[\s-]?код|barcode|2d[\s-]?скан/i,
        keys: ['скан', 'штрих', 'barcode', 'honeywell', 'zebra', 'cipher', 'symbol']
    },
    {
        test: /принтер|печат|чековая лента|этикетк/i,
        keys: ['принтер', 'печат', 'fprint', 'этикет', 'термо', 'чеков']
    },
    {
        test: /мясоруб/i,
        keys: ['мясоруб']
    },
    {
        test: /холодиль|морозиль|рефриж|ларь|лари|ледоген|фризер|freezer|холодн.*шкаф|шкаф.*холод/i,
        keys: [
            'холодиль',
            'морозиль',
            'рефриж',
            'морозил',
            'ларь',
            'холодн',
            'морозн',
            'ледоген',
            'фризер',
            'freezer',
        ]
    },
    {
        test: /моноблок|pos[\s-]?комп|кассовый комп/i,
        keys: ['моноблок', 'pos', 'кассов', 'комп']
    }
];

const CATALOG_AI_MAX_ITEMS = Math.min(
    500,
    Math.max(200, parseInt(process.env.ASK_CATALOG_MAX_ITEMS || '400', 10) || 400)
);

/** Имя в строке каталога для ИИ: не ломать разделитель « | Цена: » */
function sanitizeCatalogNameForAI(name) {
    return String(name || '')
        .replace(/\|/g, '¦')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Если точное слово не встречается в названиях (мн. ч.), пробуем короче */
function expandSearchTokens(tokens) {
    const out = new Set();
    for (const t of tokens) {
        if (t.length < 3) continue;
        out.add(t);
        if (t.length >= 8) {
            out.add(t.slice(0, -1));
            out.add(t.slice(0, -2));
        } else if (t.length >= 6) {
            out.add(t.slice(0, -1));
        }
    }
    return [...out];
}

/**
 * Подмножество каталога под конкретный вопрос; иначе срез с начала (как раньше).
 * @returns {{ products: object[], source: 'filtered'|'tokens'|'head' }}
 */
function selectProductsForConsultant(question, inStockProducts) {
    const q = (question || '').toLowerCase();
    const nameMatch = (p, keys) => {
        const n = (p.name || '').toLowerCase();
        return keys.some((k) => n.includes(k.toLowerCase()));
    };

    for (const hint of CATALOG_QUERY_HINTS) {
        if (hint.test.test(question)) {
            const hit = inStockProducts.filter((p) => nameMatch(p, hint.keys));
            if (hit.length > 0) {
                return { products: hit.slice(0, CATALOG_AI_MAX_ITEMS), source: 'filtered' };
            }
            break;
        }
    }

    const stop = new Set([
        'какие',
        'какой',
        'какая',
        'какое',
        'есть',
        'наличии',
        'наличие',
        'сколько',
        'что',
        'мне',
        'нас',
        'вас',
        'про',
        'для',
        'или',
        'ли',
        'все',
        'весь',
        'покажи',
        'подскажи',
        'скажи',
        'хочу',
        'нужен',
        'нужна',
        'нужно',
        'дайте',
        'можно'
    ]);
    const tokens = q
        .split(/[^a-zа-яё0-9]+/i)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !stop.has(t));

    if (tokens.length > 0) {
        const tryTokens = (toks) =>
            inStockProducts.filter((p) => {
                const n = (p.name || '').toLowerCase();
                return toks.some((t) => n.includes(t));
            });
        let hit = tryTokens(tokens);
        if (hit.length === 0) hit = tryTokens(expandSearchTokens(tokens));
        if (hit.length > 0) {
            return { products: hit.slice(0, CATALOG_AI_MAX_ITEMS), source: 'tokens' };
        }
    }

    return { products: inStockProducts.slice(0, CATALOG_AI_MAX_ITEMS), source: 'head' };
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
        const { question, sessionId = 'default' } = req.body;
        
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

        // Ответ с ИНН → вызов 1С (заказ + счёт)
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
            cartExisting.invoiceDraft = null;
            cartExisting.timestamp = Date.now();

            const itemsList = cartExisting.items
                .map(
                    (item) =>
                        `- ${item.name} (${item.quantity} шт.) — ${cartLineTotal(item)} руб.`
                )
                .join('\n');
            const total = cartExisting.items.reduce((sum, item) => sum + cartLineTotal(item), 0);

            const onec = await sendInvoiceRequestTo1C({
                sessionId,
                items: cartExisting.items,
                counterparty: { organizationName, inn },
            });

            let mid = '';
            if (!onec.configured) {
                mid = `\n\n⚠️ Вебхук 1С не настроен в Vercel (**ONEC_INVOICE_WEBHOOK_***).`;
            } else if (onec.ok) {
                const ord = onec.orderNumber ? ` Заказ: **${escapeHtml(onec.orderNumber)}**.` : '';
                mid =
                    `\n\n✅ В 1С оформлено.${ord} Счёт: ${onec.invoiceNumber ? `**№ ${escapeHtml(onec.invoiceNumber)}**` : 'создан'}.` +
                    formatInvoiceLinksBlock(onec);
            } else {
                mid = `\n\n⚠️ **1С:** ${escapeHtml(onec.error || 'ошибка')}`;
            }

            const safeOrg = escapeHtml(organizationName).replace(/\*/g, '');
            const answer =
                `${safeOrg}, ИНН **${inn}**\n\n${itemsList}\n**Итого: ${total} руб.**` +
                mid +
                (onec.ok ? `\n\nВопросы:${MANAGER_CONTACT}` : `\n\n${MANAGER_CONTACT}`);

            return pushAndReturn(answer);
        }

        // 1️⃣ Старт: запрос счёта → сначала организация и ИНН
        if (isInvoiceCommand(question)) {
            const cart = getOrCreateCart(sessionId);
            const inStock = products.filter(isInStock);

            if (cart.items.length === 0) {
                let forMatch = question.replace(/добавь|положи|в\s+корзину/gi, ' ').trim();
                forMatch = stripCatalogNoise(forMatch);
                forMatch = stripQuantityPhrases(forMatch);
                forMatch = stripInvoicePhrases(forMatch);
                const guessed = findBestCatalogMatch(forMatch, inStock);
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
            const answer = `В счёте:\n${lines}\n\n**Наименование организации** (потом ИНН). **Отмена** — отменить.`;
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
                    `Чтобы оформить заказ, напишите **«выпиши счёт»** — спросим организацию и ИНН, затем отправим данные в 1С.`;
                
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
                    `Если хотите оформить заказ, напишите **«выпиши счёт»** — уточним организацию и ИНН.`;
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
Не пиши общих фраз вроде «у нас всё хорошо» или выдуманных новостей компании.
Если в списке нет подходящих позиций — одна фраза: в этой выборке нет, предложи уточнить тип/бренд; не утверждай, что товара нет во всём магазине.
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
        
        const catalogContext =
            productsForAI.length > 0
                ? productsForAI
                      .map((p) => {
                          const nm = sanitizeCatalogNameForAI(p.name);
                          return `- ${nm} | Цена: ${p.price} руб. | В наличии: ${p.quantity} шт.`;
                      })
                      .join('\n')
                : '(список пуст — под запрос не найдено позиций в наличии в каталоге)';
        
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
                            content: `Каталог (режим ${catalogSource}, в базе ~${inStockProducts.length} позиций, здесь до ${CATALOG_AI_MAX_ITEMS} строк). Копируй наименование целиком до « | Цена:».\n\n${catalogContext}\n\nВопрос: "${question}"\n\nОтветь только по этим строкам.`
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