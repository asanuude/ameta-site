#!/usr/bin/env node
/**
 * Собирает catalog.json из CommerceML (import*.xml + offers*.xml) — та же логика, что в src/pages/api/update-catalog.js
 *
 * Использование:
 *   node scripts/commerceml-to-catalog.mjs
 *   node scripts/commerceml-to-catalog.mjs --data-dir ./data --out ./catalog.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseString } from 'xml2js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parseArgs() {
    const args = process.argv.slice(2);
    let dataDir = path.join(repoRoot, 'data');
    let outFile = path.join(repoRoot, 'catalog.json');
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--data-dir' && args[i + 1]) {
            dataDir = path.resolve(args[++i]);
        } else if (args[i] === '--out' && args[i + 1]) {
            outFile = path.resolve(args[++i]);
        }
    }
    return { dataDir, outFile };
}

function parseXMLString(xmlString) {
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

async function main() {
    const { dataDir, outFile } = parseArgs();

    if (!fs.existsSync(dataDir)) {
        console.error(`Папка не найдена: ${dataDir}`);
        process.exit(1);
    }

    const names = fs.readdirSync(dataDir);
    const importFiles = names.filter((n) => n.toLowerCase().startsWith('import') && n.endsWith('.xml'));
    const offerFiles = names.filter((n) => n.toLowerCase().startsWith('offers') && n.endsWith('.xml'));

    if (importFiles.length === 0) {
        console.error(
            `Нет файлов import*.xml в ${dataDir}. Положите выгрузку CommerceML из 1С (import0_1.xml, offers0_1.xml и т.д.).`
        );
        process.exit(1);
    }

    let allProducts = [];
    let allOffers = [];
    const groupMap = new Map();

    for (const name of importFiles) {
        const content = fs.readFileSync(path.join(dataDir, name), 'utf8');
        const parsed = await parseXMLString(content);
        const ci = parsed?.КоммерческаяИнформация;
        const classifierRoot =
            ci?.[0]?.Классификатор?.[0]?.Группы?.[0]?.Группа ??
            ci?.Классификатор?.[0]?.Группы?.[0]?.Группа;
        flattenCommerceGroups(classifierRoot, null, groupMap);

        const catalogBlock = ci?.[0]?.Каталог?.[0] ?? ci?.Каталог?.[0];
        const rawProducts = catalogBlock?.Товары?.[0]?.Товар;
        allProducts = [...allProducts, ...asArray(rawProducts)];
    }

    for (const name of offerFiles) {
        const content = fs.readFileSync(path.join(dataDir, name), 'utf8');
        const parsed = await parseXMLString(content);
        const ci = parsed?.КоммерческаяИнформация;
        const rawOffers =
            ci?.[0]?.ПакетПредложений?.[0]?.Предложения?.[0]?.Предложение ??
            ci?.ПакетПредложений?.[0]?.Предложения?.[0]?.Предложение;
        allOffers = [...allOffers, ...asArray(rawOffers)];
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

    const payload = { groups, products, generatedAt: new Date().toISOString() };

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');

    console.log(
        `OK: ${outFile}\n  groups: ${groups.length}\n  products: ${products.length}\n  import XML: ${importFiles.join(', ')}\n  offers XML: ${offerFiles.length ? offerFiles.join(', ') : '(нет — цены/остатки могут быть пустыми)'}`
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
