#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const cachePath = path.join(repoRoot, 'data', 'product-enrichment-cache.json');
const productImageDir = path.join(repoRoot, 'public', 'product-images');

const providers = [
	{
		modelKey: 'атол 1ф',
		brand: 'АТОЛ',
		model: '1Ф',
		sourceUrl: 'https://torg.1c.ru/equipment/onlayn-kassy/atol-1f-fn15/',
		sourceTitle: '1С:Торг - Атол 1Ф',
		imageFileName: 'atol-1f.png',
		aliases: [
			'атол 1ф',
			'ккт атол 1ф',
			'ккт атол 1ф без фн',
			'ккм атол 1ф',
			'ккм атол 1ф без фн',
			'онлайн касса атол 1ф',
		],
		fallbackSpecs: [
			{ name: 'Способ печати', value: 'Термопечать' },
			{ name: 'Ширина чека', value: '58 мм' },
			{ name: 'Скорость печати', value: 'До 50 мм/сек' },
			{ name: 'Интерфейс подключения', value: 'Micro-USB' },
			{ name: 'Диаметр рулона', value: '47 мм' },
			{ name: 'Габариты', value: '8,5 x 11,5 x 5,6 см' },
		],
	},
	{
		modelKey: 'атол 30ф',
		brand: 'АТОЛ',
		model: '30Ф',
		sourceUrl: 'https://torg.1c.ru/equipment/onlayn-kassy/atol-30f/',
		sourceTitle: '1С:Торг - Атол 30Ф',
		imageFileName: 'atol-30f.png',
		aliases: [
			'атол 30ф',
			'ккт атол 30ф',
			'ккт атол 30ф без фн',
			'ккм atol 30ф',
			'ккм f print атол 30ф',
			'онлайн касса атол 30ф',
		],
		fallbackSpecs: [
			{ name: 'Качество печати', value: '203 dpi' },
			{ name: 'Скорость печати', value: 'До 75 мм/с' },
			{ name: 'Питание', value: 'USB, 9В, 1А от блока питания' },
			{ name: 'Ширина бумаги', value: '58 мм' },
			{ name: 'Подключение к ПК', value: 'RS, USB' },
			{ name: 'Габариты', value: '8,7 x 16 x 7,9 см' },
		],
	},
	{
		modelKey: 'атол 55ф',
		brand: 'АТОЛ',
		model: '55Ф',
		sourceUrl: 'https://torg.1c.ru/equipment/onlayn-kassy/atol-55f/',
		sourceTitle: '1С:Торг - Атол 55Ф',
		imageFileName: 'atol-55f.png',
		aliases: ['атол 55ф', 'ккт атол 55ф', 'ккт атол 55ф без фн', 'ккм атол 55ф'],
		fallbackSpecs: [
			{ name: 'Способ печати', value: 'Термопечать' },
			{ name: 'Автоотрез', value: 'Да' },
			{ name: 'Ширина чека', value: '58/44' },
			{ name: 'Скорость печати', value: 'До 200 мм/сек' },
			{ name: 'Интерфейс подключения', value: 'Ethernet, USB, RS-232C' },
			{ name: 'Габариты', value: '11,5 x 13,5 x 20 см' },
		],
	},
	{
		modelKey: 'ритейл 02ф',
		brand: 'Ритейл / Штрих',
		model: 'РИТЕЙЛ-02Ф',
		sourceUrl: 'https://torg.1c.ru/equipment/onlayn-kassy/KKTRTL02DO/',
		sourceTitle: '1С:Торг - Ритейл-02Ф (Штрих-ФР-02Ф)',
		imageFileName: 'retail-02f.png',
		aliases: [
			'ритейл 02ф',
			'ккт ритейл 02ф',
			'ккт ритейл 02ф rs usb без фн',
			'штрих фр 02ф',
			'штрих-фр-02ф',
			'ккт ритейл-02ф',
		],
		fallbackSpecs: [
			{ name: 'Способ печати', value: 'Термопечать' },
			{ name: 'Скорость печати', value: 'До 125 мм/сек' },
			{ name: 'Ширина чековой ленты', value: '57, 44' },
			{ name: 'Отрезчик', value: 'Автоотрезчик, ресурс 1 500 000 операций' },
			{ name: 'Габариты', value: '9,2 x 14,2 x 10,4 см' },
			{ name: 'Вес', value: '700 гр' },
		],
	},
];

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

async function enrichFrom1CTorg(provider) {
	const response = await fetch(provider.sourceUrl);
	if (!response.ok) {
		throw new Error(`Не удалось получить страницу товара: ${provider.sourceUrl} (${response.status})`);
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

	const localImagePath = path.join(productImageDir, provider.imageFileName);
	if (imageUrl) {
		await downloadFile(imageUrl, localImagePath);
	}

	return {
		modelKey: provider.modelKey,
		brand: provider.brand,
		model: provider.model,
		aliases: provider.aliases,
		image: `/product-images/${provider.imageFileName}`,
		description,
		specs: specs.length > 0 ? specs : provider.fallbackSpecs,
		sourceUrl: provider.sourceUrl,
		sourceTitle: provider.sourceTitle,
		confidence: 0.98,
		updatedAt: new Date().toISOString(),
	};
}

async function main() {
	const items = [];
	for (const provider of providers) {
		items.push(await enrichFrom1CTorg(provider));
	}
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
