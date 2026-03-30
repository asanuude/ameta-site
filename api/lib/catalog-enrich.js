/**
 * Автосинонимы и поисковая строка для каждой позиции каталога.
 * Ручные синонимы: поле aliases в JSON — строка или массив строк.
 */

function normalizeCatalogToken(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/ё/g, 'е')
        .replace(/(\d)\s*x(?=\s|$|[^\wа-яё])/gi, '$1х')
        .replace(/[-–—_/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Собирает варианты написания для матчинга запроса клиента.
 * @param {object} p — элемент catalog.json
 * @returns {string[]}
 */
export function collectAutoAliases(p) {
    const name = String(p.name || '');
    const sku = String(p.sku || '').trim();
    const id = String(p.id || '').trim();
    const desc = String(p.description || '').trim();
    let manual = [];
    if (Array.isArray(p.aliases)) {
        manual = p.aliases.map((x) => String(x).trim()).filter(Boolean);
    } else if (typeof p.aliases === 'string' && p.aliases.trim()) {
        manual = [p.aliases.trim()];
    }

    const set = new Set();
    const add = (s) => {
        const n = normalizeCatalogToken(s);
        if (n.length >= 2) set.add(n);
    };

    add(name);
    if (sku) add(sku);
    if (id) add(id);
    if (desc.length >= 3 && desc.length < 200) add(desc);
    manual.forEach((m) => add(m));

    const paren = name.match(/\(([^)]+)\)/g);
    if (paren) {
        paren.forEach((x) => add(x.replace(/[()]/g, '')));
    }

    const codeLike =
        name.match(/[a-zа-яё]{2,}[\s-]*\d+[a-zа-яё0-9.\s-]*/gi) || [];
    codeLike.forEach((c) => add(c));

    const latinNum = name.match(/\b[A-Z]{2,}[\s-]?\d{2,}[A-Z0-9.-]*\b/g);
    if (latinNum) latinNum.forEach((c) => add(c));

    name.split(/[|,/;]+/).forEach((chunk) => {
        const t = chunk.trim();
        if (t.length >= 2) add(t);
    });

    name.split(/[^a-zа-яё0-9]+/i).forEach((w) => {
        if (w.length >= 3) add(w);
    });

    const compactSku = sku.replace(/\s/g, '');
    if (compactSku.length >= 2) add(compactSku);

    return [...set];
}

/**
 * @param {object} p
 * @returns {object} p с полями _aliases, _searchHaystack
 */
export function enrichCatalogProduct(p) {
    const copy = { ...p };
    if (copy._enriched) return copy;
    const aliases = collectAutoAliases(copy);
    const hay = normalizeCatalogToken(
        [copy.name, copy.sku, copy.id, ...aliases].filter(Boolean).join(' ')
    );
    copy._aliases = aliases;
    copy._searchHaystack = hay;
    copy._enriched = true;
    return copy;
}

/**
 * @param {object[]} products
 * @returns {object[]}
 */
export function enrichCatalog(products) {
    if (!Array.isArray(products)) return [];
    return products.map((p) => enrichCatalogProduct(p));
}
