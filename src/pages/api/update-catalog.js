export const prerender = false;
import fs from 'fs';
import path from 'path';
import { parseString } from 'xml2js';

// Секретный ключ для Bearer-авторизации
const UPDATE_SECRET = '0011524AaSs!!!';

export async function POST({ request }) {
    try {
        const authHeader = request.headers.get('Authorization');
        const basicAuth = authHeader?.startsWith('Basic ');
        let authorized = false;

        if (basicAuth) {
            const base64Credentials = authHeader.split(' ')[1];
            const credentials = atob(base64Credentials);
            const [username, password] = credentials.split(':');

            if (username === 'admin' && password === UPDATE_SECRET) {
                authorized = true;
            }
        } else if (authHeader === `Bearer ${UPDATE_SECRET}`) {
            authorized = true;
        }

        if (!authorized) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const formData = await request.formData();
        const files = [];

        for (const [, value] of formData.entries()) {
            if (value instanceof File) {
                files.push({
                    name: value.name,
                    content: await value.text(),
                });
            }
        }

        if (files.length === 0) {
            return new Response(JSON.stringify({ error: 'No files uploaded' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        let allProducts = [];
        let allOffers = [];
        const groupMap = new Map();

        for (const file of files) {
            if (file.name.startsWith('import')) {
                const parsed = await parseXMLString(file.content);
                const ci = parsed?.КоммерческаяИнформация;
                const classifierRoot =
                    ci?.[0]?.Классификатор?.[0]?.Группы?.[0]?.Группа ??
                    ci?.Классификатор?.[0]?.Группы?.[0]?.Группа;
                flattenCommerceGroups(classifierRoot, null, groupMap);

                const catalogBlock = ci?.[0]?.Каталог?.[0] ?? ci?.Каталог?.[0];
                const rawProducts = catalogBlock?.Товары?.[0]?.Товар;
                const products = asArray(rawProducts);
                allProducts = [...allProducts, ...products];
            }
            if (file.name.startsWith('offers')) {
                const parsed = await parseXMLString(file.content);
                const ci = parsed?.КоммерческаяИнформация;
                const rawOffers =
                    ci?.[0]?.ПакетПредложений?.[0]?.Предложения?.[0]?.Предложение ??
                    ci?.ПакетПредложений?.[0]?.Предложения?.[0]?.Предложение;
                const offers = asArray(rawOffers);
                allOffers = [...allOffers, ...offers];
            }
        }

        const groups = [...groupMap.values()];

        const products = allProducts.map((product) => {
            const offer = allOffers.find((o) => o.Ид?.[0] === product.Ид?.[0]);

            let totalQuantity = 0;
            if (offer?.Склад) {
                offer.Склад.forEach((sklad) => {
                    totalQuantity += Number(sklad.$.КоличествоНаСкладе || 0);
                });
            }

            const gid = extractProductGroupId(product);

            return {
                id: product.Ид?.[0],
                name: product.Наименование?.[0]?.trim() || '',
                description: product.Описание?.[0] || '',
                price: offer?.Цены?.[0]?.Цена?.[0]?.ЦенаЗаЕдиницу?.[0] || 'Цена не указана',
                quantity: totalQuantity,
                sku:
                    product.ЗначенияРеквизитов?.[0]?.ЗначениеРеквизита?.find(
                        (r) => r.Наименование?.[0] === 'Код'
                    )?.Значение?.[0]?.trim() || '',
                groupId: gid,
            };
        });

        const dedupedProducts = dedupeCatalogProducts(products);
        const payload = { groups, products: dedupedProducts };

        const catalogPath = path.join('/tmp', 'catalog.json');
        fs.writeFileSync(catalogPath, JSON.stringify(payload, null, 2));

        const dataDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(path.join(dataDir, 'catalog.json'), JSON.stringify(payload, null, 2));

        const publicDir = path.join(process.cwd(), 'public');
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, { recursive: true });
        }
        fs.writeFileSync(path.join(publicDir, 'catalog.json'), JSON.stringify(payload, null, 2));

        return new Response(
            JSON.stringify({
                success: true,
                productsCount: dedupedProducts.length,
                groupsCount: groups.length,
            }),
            {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    } catch (error) {
        console.error('Update error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

async function parseXMLString(xmlString) {
    return new Promise((resolve, reject) => {
        parseString(xmlString, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

function asArray(x) {
    if (x == null) return [];
    return Array.isArray(x) ? x : [x];
}

function extractProductGroupId(product) {
    return (
        product.ИдГруппы?.[0] ||
        product.Группы?.[0]?.Ид?.[0] ||
        product.Группы?.[0]?.Группа?.[0]?.Ид?.[0] ||
        null
    );
}

function parsePriceValue(raw) {
    const n =
        typeof raw === 'number'
            ? raw
            : parseFloat(String(raw ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
}

function scoreCatalogProduct(product) {
    return (
        (Number(product.quantity) > 0 ? 1000 : 0) +
        (parsePriceValue(product.price) > 0 ? 100 : 0) +
        (product.description ? 10 : 0) +
        (product.sku ? 5 : 0)
    );
}

function dedupeCatalogProducts(products) {
    const byKey = new Map();
    for (const product of products) {
        const key =
            product.id ||
            `${String(product.sku || '').trim()}::${String(product.name || '').trim().toLowerCase()}`;
        if (!key) continue;
        const prev = byKey.get(key);
        if (!prev || scoreCatalogProduct(product) > scoreCatalogProduct(prev)) {
            byKey.set(key, product);
        }
    }
    return [...byKey.values()];
}

function flattenCommerceGroups(nodes, parentId, groupMap) {
    for (const node of asArray(nodes)) {
        const id = node.Ид?.[0];
        const name = (node.Наименование?.[0] || '').trim();
        if (id && name && !groupMap.has(id)) {
            groupMap.set(id, { id, parentId: parentId ?? null, name });
        }
        const inner = node.Группы?.[0]?.Группа;
        flattenCommerceGroups(inner, id || parentId, groupMap);
    }
}
