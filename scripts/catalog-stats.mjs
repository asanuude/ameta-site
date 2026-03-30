#!/usr/bin/env node
/**
 * Сводка по catalog.json: сколько позиций, сколько «в наличии» по правилам бота,
 * распределение по groupId, проблемные строки (без цены/количества).
 *
 *   node scripts/catalog-stats.mjs
 *   node scripts/catalog-stats.mjs --file ../public/catalog.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function isInStock(p) {
    const qty = Number(p.quantity);
    if (!Number.isFinite(qty) || qty <= 0) return false;
    const raw = p.price;
    if (raw === null || raw === undefined || raw === '') return false;
    if (typeof raw === 'string' && /не указан/i.test(raw)) return false;
    const pr = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(pr) && pr > 0;
}

function parseArgs() {
    const args = process.argv.slice(2);
    let file = path.join(repoRoot, 'public', 'catalog.json');
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--file' && args[i + 1]) {
            file = path.resolve(args[++i]);
        }
    }
    return { file };
}

function main() {
    const { file } = parseArgs();
    if (!fs.existsSync(file)) {
        console.error(`Файл не найден: ${file}`);
        process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const products = Array.isArray(raw) ? raw : raw.products || [];
    const groups = Array.isArray(raw.groups) ? raw.groups : raw.groups || [];

    const inStock = products.filter(isInStock);
    const noQty = products.filter((p) => !Number(p.quantity) || Number(p.quantity) <= 0);
    const badPrice = products.filter((p) => {
        const raw = p.price;
        if (raw === null || raw === undefined || raw === '') return true;
        if (typeof raw === 'string' && /не указан/i.test(raw)) return true;
        const pr =
            typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
        return !Number.isFinite(pr) || pr <= 0;
    });

    const byGroup = new Map();
    for (const p of inStock) {
        const g = p.groupId || '(no group)';
        byGroup.set(g, (byGroup.get(g) || 0) + 1);
    }

    const skuDup = new Map();
    for (const p of products) {
        const s = String(p.sku || '').trim();
        if (!s) continue;
        skuDup.set(s, (skuDup.get(s) || 0) + 1);
    }
    const dupSkus = [...skuDup.entries()].filter(([, n]) => n > 1);

    console.log('=== catalog.json (как бот ameta-site) ===\n');
    console.log(`Файл: ${file}`);
    console.log(`Всего позиций: ${products.length}`);
    console.log(`«В наличии» по правилам бота (isInStock): ${inStock.length}`);
    console.log(`Без остатка (qty<=0): ${noQty.length}`);
    console.log(`С проблемной ценой: ${badPrice.length}`);
    console.log(`Групп в meta: ${groups.length}`);
    if (dupSkus.length) {
        console.log(`\n⚠ Дубли sku (${dupSkus.length}):`, dupSkus.slice(0, 15).map(([s, n]) => `${s}×${n}`).join(', '));
    }

    console.log('\n--- Топ групп по числу позиций в наличии ---');
    const sorted = [...byGroup.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
    const gname = new Map(groups.map((g) => [g.id, g.name]));
    for (const [gid, n] of sorted) {
        const label = gname.get(gid) || gid;
        console.log(`  ${n}\t${label}`);
    }

    console.log('\n--- Примеры позиций без наличия (первые 8) ---');
    for (const p of noQty.slice(0, 8)) {
        console.log(`  - ${(p.name || '').slice(0, 80)} | qty=${p.quantity} price=${p.price}`);
    }

    console.log('\n--- Примеры позиций в наличии (первые 5) ---');
    for (const p of inStock.slice(0, 5)) {
        console.log(`  - ${(p.name || '').slice(0, 80)} | ${p.price} руб. × ${p.quantity}`);
    }
}

main();
