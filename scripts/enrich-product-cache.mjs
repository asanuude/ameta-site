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
		modelKey: 'атол 25ф',
		brand: 'АТОЛ',
		model: '25Ф',
		sourceUrl: 'https://torg.1c.ru/equipment/onlayn-kassy/kkt-atol-25f-fn-15/',
		sourceTitle: '1С:Торг - Атол 25Ф',
		imageFileName: 'atol-25f.png',
		aliases: ['атол 25ф', 'ккт атол 25ф', 'ккт атол 25ф без фн', 'ккм атол 25ф'],
		fallbackSpecs: [
			{ name: 'Скорость печати', value: 'До 250 мм/с' },
			{ name: 'Автоотрез чека', value: 'Да, до 2 000 000 отрезов' },
			{ name: 'Ширина чека', value: '80/58 мм' },
			{ name: 'Передача данных', value: 'USB, Ethernet' },
			{ name: 'Подключение к денежному ящику', value: 'RJ 12' },
			{ name: 'Габариты', value: '14 x 13 x 17,4 см' },
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
	{
		modelKey: 'атол sigma 7',
		brand: 'АТОЛ',
		model: 'Sigma 7',
		sourceUrl: 'https://torg.1c.ru/equipment/onlayn-kassy/smart-terminal-atol-sigma-7-1s-mobilnaya-kassa-fn36/',
		sourceTitle: '1С:Торг - Атол Sigma 7',
		imageFileName: 'atol-sigma-7.png',
		aliases: [
			'atol sigma 7',
			'атол sigma 7',
			'атол сигма 7',
			'ккт смарт терминал атол sigma 7 без фн',
			'смарт терминал атол sigma 7',
		],
		fallbackDescription:
			'Компактный смарт-терминал для запуска кассового места в магазине, точке питания или сервисной точке. Поддерживает 1С:Мобильная касса, подключение периферии и автономную работу.',
		fallbackSpecs: [
			{ name: 'Дисплей', value: '7 дюймов, 1024x600' },
			{ name: 'Операционная система', value: 'SIGMA OS' },
			{ name: 'Интерфейсы', value: 'Bluetooth, USB, Ethernet, Wi-Fi 2,4 ГГц, 3G' },
			{ name: 'Ширина чековой ленты', value: '57 мм' },
			{ name: 'Скорость печати', value: '70 мм/с' },
			{ name: 'Время автономной работы', value: 'До 5 часов' },
		],
	},
	{
		modelKey: 'атол sigma 10',
		brand: 'АТОЛ',
		model: 'Sigma 10',
		sourceUrl: 'https://torg.1c.ru/equipment/onlayn-kassy/smart-terminal-atol-sigma-10-1s-mobilnaya-kassa-its-na-1-god-bez-fn/',
		sourceTitle: '1С:Торг - Атол Sigma 10',
		imageFileName: 'atol-sigma-10.png',
		aliases: [
			'atol sigma 10',
			'атол sigma 10',
			'атол сигма 10',
			'ккт смарт терминал атол sigma 10 без фн',
			'смарт терминал атол sigma 10',
		],
		fallbackDescription:
			'Смарт-терминал с большим экраном для торговой точки, кафе и небольшого ресторана. Подходит для запуска рабочего места кассира с 1С:Мобильная касса и подключением периферии.',
		fallbackSpecs: [
			{ name: 'Дисплей', value: '10", IPS матрица' },
			{ name: 'Память', value: 'ROM 8 Гб, RAM 1 Гб' },
			{ name: 'Печатающий механизм', value: '100 мм/сек, ресурс 50 км' },
			{ name: 'Чековая лента', value: '57 мм / 32 м' },
			{ name: 'Интерфейсы к ОФД', value: 'Ethernet, Wi-Fi, 3G' },
			{ name: 'Подключение периферии', value: 'Bluetooth, 4 USB-A, RJ-11' },
		],
	},
	{
		modelKey: 'атол sb3100',
		brand: 'АТОЛ',
		model: 'SB3100',
		sourceUrl: 'https://torg.1c.ru/equipment/skanery-shtrikhkoda/skaner-shtrikhkoda-provodnoy-atol-sb3100-2d-usb-bez-podstavki/',
		sourceTitle: '1С:Торг - АТОЛ SB3100',
		imageFileName: 'atol-sb3100.png',
		aliases: ['атол sb3100', 'сканер атол sb3100', 'сканер штрихкода атол sb3100', 'sb3100'],
		fallbackSpecs: [
			{ name: 'Разрешение', value: '640x480' },
			{ name: 'Скорость сканирования', value: '120 fps' },
			{ name: 'Интерфейсы', value: 'RJ-50 (USB), RS-232, USB HID, VCOM' },
			{ name: 'Защита', value: 'IP42' },
			{ name: 'Габариты', value: '7 x 9,1 x 16,2 см' },
			{ name: 'Вес', value: '211 г' },
		],
	},
	{
		modelKey: 'атол sb3100 bt',
		brand: 'АТОЛ',
		model: 'SB3100 BT',
		sourceUrl: 'https://torg.1c.ru/equipment/skanery-shtrikhkoda/skaner-shtrikhkoda-atol-sb3100-bt-bluetooth-5-0-c-podstavkoy/',
		sourceTitle: '1С:Торг - АТОЛ SB3100 BT',
		imageFileName: 'atol-sb3100-bt.png',
		aliases: ['атол sb3100 bt', 'сканер атол sb3100 bt', 'sb3100 bt', 'атол sb3100 bluetooth'],
		fallbackSpecs: [
			{ name: 'Тип сканера', value: '2D Imager' },
			{ name: 'Разрешение', value: '640x480' },
			{ name: 'Интерфейсы', value: 'Bluetooth / USB' },
			{ name: 'Аккумулятор', value: '3200 мАч' },
			{ name: 'Защита', value: 'IP42' },
			{ name: 'Особенность', value: 'Работа в течение смены без подзарядки' },
		],
	},
	{
		modelKey: 'атол impulse 12',
		brand: 'АТОЛ',
		model: 'Impulse 12',
		sourceUrl:
			'https://torg.1c.ru/equipment/skanery-shtrikhkoda/skaner-shtrikhkoda-atol-impulse-12-v2-2d-chyernyy-usb-bez-podstavki/',
		sourceTitle: '1С:Торг - АТОЛ Impulse 12',
		imageFileName: 'atol-impulse-12.png',
		aliases: [
			'атол impulse 12',
			'сканер атол impulse 12',
			'сканер штрихкода атол impulse 12',
			'impulse 12',
		],
		fallbackSpecs: [
			{ name: 'Разрешение', value: '640 x 480, 0,3 Мп' },
			{ name: 'Скорость сканирования', value: '>= 100 скан/сек' },
			{ name: 'Дальность сканирования', value: 'До 25 см' },
			{ name: 'Класс защиты', value: 'IP52' },
			{ name: 'Интерфейсы', value: 'USB (HID, COM)' },
			{ name: 'Вес', value: '150 гр' },
		],
	},
];

function decodeHtmlJsonString(value) {
	return String(value || '').replaceAll('\\/', '/');
}

function decodeHtmlEntities(value) {
	return String(value || '')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}

function cleanText(value) {
	return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' '))
		.replace(/\s+/g, ' ')
		.trim();
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

function extractByAnchorIds(html, startId, endIds) {
	const endIdList = Array.isArray(endIds) ? endIds : [endIds];
	for (const endId of endIdList) {
		const pattern = new RegExp(
			`id="${startId}"[\\s\\S]*?<div class="content-wrap[^"]*">([\\s\\S]*?)<div class="scrollspy font_h2" id="${endId}"`,
			'i'
		);
		const match = html.match(pattern)?.[1];
		if (match) return match;
	}
	return '';
}

function cleanupDescription(value) {
	return cleanText(value)
		.replace(/^О продукте\s*/i, '')
		.replace(/^(?:Экономьте|При покупке).+?(?=(?:АТОЛ|Атол|ККТ|Сканер|Смарт-терминал))/i, '')
		.replace(/^Экономьте.+?онлайн-кассы\.\s*/i, '')
		.replace(/^Экономьте.+?руб\.\s*/i, '')
		.replace(/Чтобы программное обеспечение.+?электронная поставка\)\s*\.?/i, '')
		.replace(/Первые 12 месяцев.+?бесплатные\.\s*/i, '')
		.replace(/Для продления обновлений.+?штрафа,?\s*рекомендуем.+?\.\s*/i, '')
		.replace(/При первом включении смарт-терминала.+$/i, '')
		.replace(/\s+/g, ' ')
		.trim();
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

	const productSection = extractByAnchorIds(html, 'pills-products', [
		'pills-application',
		'pills-characteristics',
		'pills-set',
		'pills-photo',
	]);
	const specsSection = extractByAnchorIds(html, 'pills-characteristics', [
		'pills-set',
		'pills-documentation',
		'pills-photo',
	]);
	const description = cleanupDescription(productSection);
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
		description: description || provider.fallbackDescription || '',
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
