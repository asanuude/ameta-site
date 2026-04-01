#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const cachePath = path.join(repoRoot, 'data', 'product-enrichment-cache.json');
const productImageDir = path.join(repoRoot, 'public', 'product-images');

function decodeHtmlJsonString(value) {
	return String(value || '').replaceAll('\\/', '/');
}

function cleanText(value) {
	return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseSpecs(sectionHtml) {
	const matches = [...sectionHtml.matchAll(/<p>\s*([^:<]+):\s*([^<;]+)[;<]?\s*<\/p>/gi)];
	return matches
		.map((match) => ({
			name: cleanText(match[1]),
			value: cleanText(match[2]),
		}))
		.filter((spec) => spec.name && spec.value);
}

function extractByAnchorIds(html, startId, endId) {
	const pattern = new RegExp(`id="${startId}"[\\s\\S]*?<div class="content-wrap[^"]*">([\\s\\S]*?)<div class="scrollspy font_h2" id="${endId}"`, 'i');
	return html.match(pattern)?.[1] || '';
}

async function downloadFile(url, filePath) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Не удалось скачать файл: ${url} (${response.status})`);
	}
	const buffer = Buffer.from(await response.arrayBuffer());
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, buffer);
}

async function enrichAtol1F() {
	const sourceUrl = 'https://torg.1c.ru/equipment/onlayn-kassy/atol-1f-fn15/';
	const response = await fetch(sourceUrl);
	if (!response.ok) {
		throw new Error(`Не удалось получить страницу товара: ${response.status}`);
	}

	const html = await response.text();
	const imageMatch =
		html.match(/"image"\s*:\s*"([^"]+)"/i) ||
		html.match(/https?:\/\/[^"' ]+\.(?:png|jpg|jpeg|webp)/i);
	const rawImageUrl = decodeHtmlJsonString(imageMatch?.[1] || imageMatch?.[0] || '');
	const imageUrl = rawImageUrl.startsWith('http') ? rawImageUrl : `https://torg.1c.ru${rawImageUrl}`;

	const productSection = extractByAnchorIds(html, 'pills-products', 'pills-application');
	const specsSection = extractByAnchorIds(html, 'pills-characteristics', 'pills-set');
	const description = cleanText(productSection)
		.replace(/^О продукте\s*/i, '')
		.replace(/^Экономьте.+?покупке\.\s*/i, '')
		.trim();
	const specs = parseSpecs(specsSection);
	const fallbackSpecs = [
		{ name: 'Способ печати', value: 'Термопечать' },
		{ name: 'Ширина чека', value: '58 мм' },
		{ name: 'Скорость печати', value: 'До 50 мм/сек' },
		{ name: 'Интерфейс подключения', value: 'Micro-USB' },
		{ name: 'Диаметр рулона', value: '47 мм' },
		{ name: 'Габариты', value: '8,5 x 11,5 x 5,6 см' },
	];

	const localImagePath = path.join(productImageDir, 'atol-1f.png');
	if (imageUrl) {
		await downloadFile(imageUrl, localImagePath);
	}

	return {
		modelKey: 'атол 1ф',
		brand: 'АТОЛ',
		model: '1Ф',
		aliases: [
			'атол 1ф',
			'ккт атол 1ф',
			'ккт атол 1ф без фн',
			'ккм атол 1ф',
			'ккм атол 1ф без фн',
			'онлайн касса атол 1ф',
		],
		image: '/product-images/atol-1f.png',
		description,
		specs: specs.length > 0 ? specs : fallbackSpecs,
		sourceUrl,
		sourceTitle: '1С:Торг - Атол 1Ф',
		confidence: 0.98,
		updatedAt: new Date().toISOString(),
	};
}

async function main() {
	const items = [await enrichAtol1F()];
	fs.mkdirSync(path.dirname(cachePath), { recursive: true });
	fs.writeFileSync(
		cachePath,
		JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				items,
			},
			null,
			2
		),
		'utf8'
	);

	console.log(`OK: ${cachePath}`);
	console.log(`  enriched items: ${items.length}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
