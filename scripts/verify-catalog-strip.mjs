/** Локальная проверка цепочки strip + findBestCatalogMatch (node scripts/verify-catalog-strip.mjs) */
import { enrichCatalog } from '../api/lib/catalog-enrich.js';

function normalizeCatalogToken(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/(\d)\s*x(?=\s|$|[^\wа-яё])/gi, '$1х')
        .replace(/[-–—_/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function stripQuantityPhrases(text) {
    return String(text || '')
        .replace(/\(\s*\d+\s*(?:шт\.?|штук(?:и|а)?|pcs?)\s*\)/gi, ' ')
        .replace(/\b\d+\s*(?:шт\.?|штук(?:и|а)?|pcs?)\b/gi, ' ')
        .replace(/\([\s.]*\)/g, ' ')
        .replace(/^\d+\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();
}
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
        h: p._searchHaystack || normalizeCatalogToken(p.name || ''),
    }));
    let hits = pool.filter(({ n, h }) => h.includes(q) || n.includes(q));
    if (hits.length === 0) {
        const tokens = q.split(' ').filter((t) => t.length >= 2);
        if (tokens.length === 0) return null;
        hits = pool.filter(({ n, h }) => tokens.every((t) => h.includes(t) || n.includes(t)));
    }
    if (hits.length === 0) return null;
    hits.sort((a, b) => a.n.length - b.n.length || String(a.p.name).localeCompare(String(b.p.name), 'ru'));
    return hits[0].p;
}

const question = 'Мясорубка МИМ-80 — 62880 руб. (1 шт.) дай счет на оплату';
let forMatch = question.replace(/добавь|положи|в\s+корзину/gi, ' ').trim();
forMatch = stripCatalogNoise(forMatch);
forMatch = stripQuantityPhrases(forMatch);
forMatch = stripInvoicePhrases(forMatch);
const products = enrichCatalog([
    { name: 'Мясорубка  МИМ-80', price: 62880, quantity: 1, id: 'x' },
]);
const m = findBestCatalogMatch(forMatch, products);
console.log('stripped forMatch:', JSON.stringify(forMatch));
console.log('match:', m?.name || null);
process.exit(m ? 0 : 1);
