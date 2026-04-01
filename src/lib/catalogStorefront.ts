import fs from 'node:fs';
import path from 'node:path';
import { stockAvailabilityBand } from './stockAvailability';
import { applyProductEnrichment, readProductEnrichmentCache, type ProductSpec } from './productEnrichment';

export interface Group {
	id: string;
	name: string;
	parentId?: string | null;
}

export interface Product {
	id?: string;
	name?: string;
	description?: string;
	sku?: string;
	price?: number | string;
	quantity?: number;
	groupId?: string | null;
	image?: string;
	enrichedDescription?: string;
	specs?: ProductSpec[];
	enrichmentSourceUrl?: string;
	enrichmentSourceTitle?: string;
	enrichmentConfidence?: number;
}

export interface GroupNode {
	id: string;
	name: string;
	products: Product[];
	children: GroupNode[];
	branchProductCount: number;
}

export interface CatalogSectionMeta {
	id: string;
	slug: string;
	name: string;
	sourceNames: string[];
	cardCopy: string;
	heroSummary: string;
	heroSupport: string;
	image: string;
	tags: string[];
}

export interface CatalogStorefrontSection {
	meta: CatalogSectionMeta;
	node: GroupNode;
}

export interface CatalogStorefrontResult {
	groups: Group[];
	products: Product[];
	sections: CatalogStorefrontSection[];
	stats: Array<{ value: string; label: string }>;
}

interface EquipmentBucket {
	id: string;
	name: string;
	priority: number;
	patterns: RegExp[];
}

interface SectionProductEntry {
	product: Product;
	trail: string[];
}

export const catalogSectionMetas: CatalogSectionMeta[] = [
	{
		id: 'public-retail',
		slug: 'retail',
		name: 'Автоматизация торговли',
		sourceNames: ['!Торговый зал', 'яТОРГОВЫЙ СКЛАД'],
		cardCopy: 'Кассовые узлы, весы, сканеры и техника для торговой точки.',
		heroSummary:
			'Раздел для магазинов и торговых объектов, где нужен подбор кассовой техники, периферии и программного обеспечения.',
		heroSupport:
			'Подходит для открытия новой точки, замены устаревшего оборудования, запуска кассовых мест и дальнейшего обслуживания.',
		image: '/section-images/retail.svg',
		tags: ['ККТ', 'Сканеры', 'Весы', 'Кассовые узлы'],
	},
	{
		id: 'public-food',
		slug: 'food',
		name: 'Пищевое и торговое оборудование',
		sourceNames: ['!ТТО', 'яСКЛАД ТТО'],
		cardCopy: 'Оборудование для кухни, производства, торгового зала и склада.',
		heroSummary:
			'Раздел для кафе, ресторанов, столовых, магазинов и производственных площадок, где важны рабочие линии, холод, тепло и нейтральное оборудование.',
		heroSupport:
			'Помогает собрать решение под формат предприятия: от отдельной зоны до комплексного оснащения объекта.',
		image: '/section-images/food.svg',
		tags: ['Кухня', 'Холод', 'Тепло', 'Производство'],
	},
	{
		id: 'public-video',
		slug: 'video',
		name: 'Видеонаблюдение и безопасность',
		sourceNames: ['ВИДЕО', 'яВИДЕО'],
		cardCopy: 'Системы наблюдения и контроля для объекта, склада и магазина.',
		heroSummary:
			'Раздел для собственника, которому нужен контроль торгового зала, склада, входных зон и технических помещений.',
		heroSupport:
			'Подходит для модернизации существующего объекта или запуска новой системы наблюдения с последующим обслуживанием.',
		image: '/section-images/video.svg',
		tags: ['Камеры', 'Регистраторы', 'Контроль', 'Безопасность'],
	},
	{
		id: 'public-software',
		slug: 'software',
		name: 'ПО, лицензии и ОФД',
		sourceNames: ['!ГЦТО'],
		cardCopy: 'Программное обеспечение, лицензии и сервисы для торговли и учета.',
		heroSummary:
			'Раздел для выбора программных продуктов, лицензий и цифровых сервисов, связанных с торговлей, учетом и рабочими местами.',
		heroSupport:
			'Нужен там, где вместе с оборудованием требуется запуск ПО, регистрация, настройка и техническое сопровождение.',
		image: '/section-images/software.svg',
		tags: ['Лицензии', 'ОФД', 'ПО', 'Учет'],
	},
];

function compareNames(a: string, b: string): number {
	return a.localeCompare(b, 'ru', { sensitivity: 'base' });
}

function isEnrichedProduct(product: Product): boolean {
	return Boolean(
		product.image ||
			product.enrichmentSourceUrl ||
			(Array.isArray(product.specs) && product.specs.length > 0) ||
			String(product.enrichedDescription || '').trim()
	);
}

function productEnrichmentScore(product: Product): number {
	return (
		(isEnrichedProduct(product) ? 1000 : 0) +
		(product.image ? 250 : 0) +
		(product.enrichmentSourceUrl ? 120 : 0) +
		(Array.isArray(product.specs) ? Math.min(product.specs.length, 6) * 25 : 0) +
		(String(product.enrichedDescription || '').trim() ? 80 : 0) +
		Math.round(Number(product.enrichmentConfidence || 0) * 10)
	);
}

function compareProducts(a: Product, b: Product): number {
	const enrichmentDiff = productEnrichmentScore(b) - productEnrichmentScore(a);
	if (enrichmentDiff !== 0) return enrichmentDiff;
	const stockDiff = Number(b.quantity || 0) - Number(a.quantity || 0);
	if (stockDiff !== 0) return stockDiff;
	return compareNames(String(a.name || ''), String(b.name || ''));
}

function compareGroups(a: GroupNode, b: GroupNode): number {
	if (b.branchProductCount !== a.branchProductCount) {
		return b.branchProductCount - a.branchProductCount;
	}
	return compareNames(a.name, b.name);
}

function parsePriceValue(raw: unknown): number {
	const n =
		typeof raw === 'number'
			? raw
			: parseFloat(String(raw ?? '').replace(/\s/g, '').replace(',', '.'));
	return Number.isFinite(n) ? n : 0;
}

function flattenNodes(nodes: GroupNode[]): GroupNode[] {
	return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

function sanitizeProductName(name: unknown): string {
	return String(name || '')
		.replace(/\s+/g, ' ')
		.replace(/\s+([,.;:!?])/g, '$1')
		.replace(/!{2,}/g, '!')
		.replace(/\(\s+/g, '(')
		.replace(/\s+\)/g, ')')
		.replace(/"\s+/g, '"')
		.replace(/\s+"/g, ' "')
		.trim();
}

function sanitizeProductDescription(desc: unknown): string {
	return String(desc || '').replace(/\s+/g, ' ').trim();
}

function normalizeProductMeaning(name: unknown): string {
	return sanitizeProductName(name)
		.toLowerCase()
		.replace(/ё/g, 'е')
		.replace(/[^a-zа-я0-9]+/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

const sectionEquipmentBuckets: Record<string, EquipmentBucket[]> = {
	retail: [
		{
			id: 'kkm',
			name: 'ККМ и фискальные регистраторы',
			priority: 1,
			patterns: [
				/(ккт|ккм|фискальн|онлайн касс|регистратор|ритейл 0\dф|вики принт|viki print|sigma|эвотор|нева|элвес|меркур|салют|атол \d+ф|штрих .*ф|штрих online|штрих on line)/i,
			],
		},
		{
			id: 'scales',
			name: 'Весы',
			priority: 2,
			patterns: [/(весы|весовой|m er|mer |marta|штрих принт|штрих принт м|штрих slim|штрих слим)/i],
		},
		{
			id: 'scanners',
			name: 'Сканеры штрихкода',
			priority: 3,
			patterns: [/(сканер|штрихкод|2d imager|impulse|sb3100|scan)/i],
		},
		{
			id: 'tsd',
			name: 'Терминалы сбора данных',
			priority: 4,
			patterns: [/(терминал сбора данных|тсд|urovo|idata|cipher|cipherlab|smart slim|smart lite|smart t\d+)/i],
		},
		{
			id: 'label-printers',
			name: 'Принтеры этикеток и чеков',
			priority: 5,
			patterns: [/(принтер|термопринтер|принтер этикет|принтер чек|tt 100|tt 200|tt41|tt42|tt631|tsc |te300|tdp 225|ttp 225|dh220|zebra|gk420|gk 420|printer)/i],
		},
		{
			id: 'cash-drawers',
			name: 'Денежные ящики и прикассовая периферия',
			priority: 6,
			patterns: [/(денежный ящик|ящик денежный|flip top|hpc 460|mk 410|ht 330|cd 330|дисплей покупателя|пин пад)/i],
		},
		{
			id: 'pos',
			name: 'POS-моноблоки и кассовые узлы',
			priority: 7,
			patterns: [/(моноблок|pos система|pos комп|pos компьютер|light pos|lightpos|minipos|atlas|sam4s|pos via|box pc|z1|pos[- ]?терминал|pos[- ]?система)/i],
		},
		{
			id: 'peripherals',
			name: 'Комплектующие и торговая периферия',
			priority: 8,
			patterns: [/(блок питания|аккумулятор|кабель|адаптер|комплект модерниз|комплект активац|модуль|флэш диск|дангл|ридер|считывател|клавиатур|подставк|базовый терминал|утм)/i],
		},
	],
	food: [
		{
			id: 'refrigeration',
			name: 'Холодильники и холод',
			priority: 1,
			patterns: [/(холодиль|морозиль|ларь|витрин.*холод|шкаф холодиль|камера холодиль|сплит система|бонет|чиллер|компрессор|испарител|льдогенератор)/i],
		},
		{
			id: 'ovens',
			name: 'Печи, плиты и тепловое оборудование',
			priority: 2,
			patterns: [/(печь|печ |плита|пароконвект|конвектомат|жароч|фритюр|гриль|мармит|котел|сковород|шкаф пекар|кипятиль|конфорк|тэн|термостат|нагрев|электросковород|вафельниц|блинниц|блинн|корн дог|хот дог|попкорн|сахарной ваты|рисоварк|чебуреч|расстоеч|пиццы)/i],
		},
		{
			id: 'processing',
			name: 'Оборудование для приготовления и переработки',
			priority: 3,
			patterns: [/(мясоруб|овощерез|тестомес|миксер|куттер|слайсер|упаков|вакуум|фаршемеш|пила|блендер|измельч|протироч|планетарн|тестораскат|тестодел|аппарат котлет|дозатор теста|дозатор жидкого теста|чипсов|электроглушения|лапшерезк|мешкозашивоч|запаив|фаршемес|шприц колбас|картофелеочист|тендерайзер|секач|тесторез)/i],
		},
		{
			id: 'neutral',
			name: 'Нейтральное оборудование и мебель',
			priority: 4,
			patterns: [/(стол|ванн|моечн|стеллаж|полк|прилавк|тележк|зонт|подтоварник|шкаф нейтрал|спэ|сцэ|сп с|спб с|подставк|троллей|полосовой путь|разнога|прилавок рабоч)/i],
		},
		{
			id: 'scales',
			name: 'Весы',
			priority: 5,
			patterns: [/(весы|m er|marta|штрих принт|штрих слим|вэт|вр 4900|тв м|тв s|мк 15|мк 6|мк 3|грузоприемн)/i],
		},
		{
			id: 'accessories',
			name: 'Торговые аксессуары и оснащение зала',
			priority: 6,
			patterns: [/(ценникодерж|крючок|корзина покупател|корзина для распродаж|корзина 600|стойка для распродаж|стойка для распрадаж|вешало|кассовый разделитель|стойка для сухофрукт|надставка для стойки|диспенсер|площадка гиревая|сейф|кассовый бокс|примерочн|гигрометр|рециркулятор|сушилка для рук|ящик сплошной|воздуховод)/i],
		},
		{
			id: 'utensils',
			name: 'Посуда и кухонный инвентарь',
			priority: 7,
			patterns: [/(посуда|тарелк|чашк|блюдц|ложк|вилк|нож |гастроемк|контейнер|поднос|миск|кастрюл|сотейн|лоток|противень|лопатк|лопата для пиццы|насадка кондитер|моющее ср|ополаскивающ|решетка приемная|сито|скалк|термос|ведро|дуршлаг|мусат|форма для пиццы|форма кондитер)/i],
		},
		{
			id: 'parts',
			name: 'Запчасти и комплектующие',
			priority: 8,
			patterns: [/(тэн|термостат|терморегулятор|датчик|реле|лампа|сальник|вентилятор|мотор|двигател|редуктор|подшипник|уплотн|прокладк|запчаст|ручк|переключател|выключател|комплектующ|втулк|полотно|провод|спирал|шатун|пульт управлен|колесо|шланг|скотч алюмин)/i],
		},
		{
			id: 'inventory',
			name: 'Инвентарь и принадлежности',
			priority: 9,
			patterns: [/(доска разделоч|совок|крышка|кружк|форма хлеб|сетка для пиццы|щипц|венчик|картофелемял|магнитный держатель|канистра)/i],
		},
	],
	video: [
		{
			id: 'cameras',
			name: 'Камеры',
			priority: 1,
			patterns: [/(камера|ip камера|hd tvi|ptz|купольн|цилиндрическ)/i],
		},
		{
			id: 'recorders',
			name: 'Регистраторы и хранение',
			priority: 2,
			patterns: [/(регистратор|nvr|dvr|видеосервер|жесткий диск)/i],
		},
		{
			id: 'access',
			name: 'Контроль доступа и безопасность',
			priority: 3,
			patterns: [/(контроль доступа|скуд|домофон|замок|считывател|турникет|кнопка выхода)/i],
		},
		{
			id: 'network',
			name: 'Сеть, питание и монтажная периферия',
			priority: 4,
			patterns: [/(коммутатор|poe|блок питания|кабель|разъем|кронштейн|источник питания)/i],
		},
	],
	software: [
		{
			id: 'licenses',
			name: 'ПО и лицензии',
			priority: 1,
			patterns: [/(лиценз|по |программ|розниц|управлен|касса|бухгалтер|сервис)/i],
		},
		{
			id: 'ofd',
			name: 'ОФД и цифровые сервисы',
			priority: 2,
			patterns: [/(офд|честный знак|маркировк|дримкас ключ|connect|обновлен)/i],
		},
	],
};

function collectSectionProductEntries(node: GroupNode, trail: string[] = []): SectionProductEntry[] {
	const nextTrail = [...trail, node.name];
	return [
		...node.products.map((product) => ({ product, trail: nextTrail })),
		...node.children.flatMap((child) => collectSectionProductEntries(child, nextTrail)),
	];
}

function classifySectionProduct(meta: CatalogSectionMeta, entry: SectionProductEntry): EquipmentBucket | null {
	const buckets = sectionEquipmentBuckets[meta.slug] || [];
	if (buckets.length === 0) return null;
	const productText = normalizeProductMeaning(
		[
			entry.product.name,
			entry.product.description,
			entry.product.enrichedDescription,
			entry.product.sku,
		].join(' ')
	);
	if (productText) {
		const directMatches = buckets.filter((bucket) => bucket.patterns.some((pattern) => pattern.test(productText)));
		if (directMatches.length > 0) {
			if (meta.slug === 'retail') {
				const byId = new Map(directMatches.map((bucket) => [bucket.id, bucket]));
				if (byId.has('scales') && /(весы|весовой)/i.test(productText)) return byId.get('scales') || null;
				if (
					byId.has('cash-drawers') &&
					/(денежный ящик|ящик денежный|дисплей покупателя|пин пад)/i.test(productText)
				) {
					return byId.get('cash-drawers') || null;
				}
				if (
					byId.has('label-printers') &&
					/(принтер|zebra|tsc|mertech dt|poscenter tt)/i.test(productText) &&
					!/(ккт|ккм|фискальн|фн|регистратор)/i.test(productText)
				) {
					return byId.get('label-printers') || null;
				}
				if (
					byId.has('peripherals') &&
					/(блок питания|аккумулятор|кабель|адаптер|комплект модерниз|комплект активац|модуль|флэш диск|дангл|ридер|считывател|клавиатур|подставк|базовый терминал|утм)/i.test(
						productText
					) &&
					!/(ккт|ккм|фискальн|регистратор)/i.test(productText)
				) {
					return byId.get('peripherals') || null;
				}
			}
			return directMatches[0];
		}
	}
	if (meta.slug === 'retail') return null;
	const trailText = normalizeProductMeaning(entry.trail.join(' '));
	return trailText
		? buckets.find((bucket) => bucket.patterns.some((pattern) => pattern.test(trailText))) || null
		: null;
}

function buildEquipmentSectionNode(meta: CatalogSectionMeta, node: GroupNode): GroupNode {
	const bucketDefs = sectionEquipmentBuckets[meta.slug] || [];
	if (bucketDefs.length === 0) return node;

	const bucketProducts = new Map<string, Product[]>();
	for (const bucket of bucketDefs) {
		bucketProducts.set(bucket.id, []);
	}
	const otherProducts: Product[] = [];
	const entries = collectSectionProductEntries(node);

	for (const entry of entries) {
		const bucket = classifySectionProduct(meta, entry);
		if (bucket) {
			bucketProducts.get(bucket.id)?.push(entry.product);
		} else {
			otherProducts.push(entry.product);
		}
	}

	const bucketNodes = bucketDefs
		.map((bucket) => {
			const products = (bucketProducts.get(bucket.id) || []).sort(compareProducts);
			if (products.length === 0) return null;
			return {
				bucket,
				node: {
					id: `${node.id}-bucket-${bucket.id}`,
					name: bucket.name,
					products,
					children: [],
					branchProductCount: products.length,
				} satisfies GroupNode,
			};
		})
		.filter((item): item is { bucket: EquipmentBucket; node: GroupNode } => Boolean(item));

	if (otherProducts.length > 0) {
		bucketNodes.push({
			bucket: {
				id: 'other',
				name: 'Прочее оборудование',
				priority: 999,
				patterns: [],
			},
			node: {
				id: `${node.id}-bucket-other`,
				name: 'Прочее оборудование',
				products: otherProducts.sort(compareProducts),
				children: [],
				branchProductCount: otherProducts.length,
			},
		});
	}

	const children = bucketNodes
		.sort((a, b) => {
			const enrichedDiff =
				b.node.products.filter((product) => isEnrichedProduct(product)).length -
				a.node.products.filter((product) => isEnrichedProduct(product)).length;
			if (enrichedDiff !== 0) return enrichedDiff;
			if (a.bucket.priority !== b.bucket.priority) return a.bucket.priority - b.bucket.priority;
			if (b.node.branchProductCount !== a.node.branchProductCount) {
				return b.node.branchProductCount - a.node.branchProductCount;
			}
			return compareNames(a.node.name, b.node.name);
		})
		.map((item) => item.node);

	return {
		...node,
		products: [],
		children,
		branchProductCount: children.reduce((sum, child) => sum + child.branchProductCount, 0),
	};
}

function scoreDisplayProduct(product: Product): number {
	return (
		(Number(product.quantity) > 0 ? 1000 : 0) +
		(parsePriceValue(product.price) > 0 ? 100 : 0) +
		(sanitizeProductDescription(product.description) ? 10 : 0) +
		(String(product.sku || '').trim() ? 5 : 0)
	);
}

function shouldHideDisplayProduct(product: Product): boolean {
	const name = sanitizeProductName(product.name).toLowerCase();
	const price = parsePriceValue(product.price);
	return (
		price < 50 ||
		/(автомой|автохим|шампун|запчаст|комплектующ)/i.test(name) ||
		/(ремонт|поверк|техническое обслуживание|техобслуж|монтаж|демонтаж|аренда|услуг|услуга|работы|возмещение расходов)/i.test(
			name
		)
	);
}

function prepareDisplayProduct(product: Product): Product {
	return {
		...product,
		name: sanitizeProductName(product.name),
		description: sanitizeProductDescription(product.description),
	};
}

function dedupeProductsForDisplay(products: Product[], seenKeys: Set<string>): Product[] {
	const bestByMeaning = new Map<string, Product>();

	for (const rawProduct of products) {
		const product = prepareDisplayProduct(rawProduct);
		if (shouldHideDisplayProduct(product)) continue;
		const key =
			normalizeProductMeaning(product.name) ||
			`${String(product.sku || '').trim()}::${String(product.id || '').trim()}`;
		if (!key) continue;
		const prev = bestByMeaning.get(key);
		if (!prev || scoreDisplayProduct(product) > scoreDisplayProduct(prev)) {
			bestByMeaning.set(key, product);
		}
	}

	return [...bestByMeaning.entries()]
		.filter(([key]) => {
			if (seenKeys.has(key)) return false;
			seenKeys.add(key);
			return true;
		})
		.map(([, product]) => product)
		.sort(compareProducts);
}

function sanitizeDisplayName(name: string): string {
	const manual = new Map([
		['!Торговый зал', 'Торговый зал'],
		['!ТТО', 'Торговое и пищевое оборудование'],
		['!ГЦТО', 'ПО, лицензии и сервис'],
		['яТОРГОВЫЙ СКЛАД', 'Торговый склад'],
		['яСКЛАД ТТО', 'Склад торгового и пищевого оборудования'],
		['яВИДЕО', 'Видеонаблюдение'],
		['яЗапчасти', 'Запчасти'],
		['яОборуд.пищевого производства', 'Оборудование пищевого производства'],
		['яОборудование для убойного цеха', 'Оборудование для убойного цеха'],
		['яТорговое оборудование', 'Торговое оборудование'],
		['яХолодильное оборудование', 'Холодильное оборудование'],
		['яХолодильные комплектующие', 'Холодильные комплектующие'],
		['яЗапчасти к мясорубкам', 'Запчасти к мясорубкам'],
		['яВанны моечные', 'Ванны моечные'],
		['яСтолы производственные', 'Столы производственные'],
		['яСтеллажи Водолей', 'Стеллажи Водолей'],
		['яСтеллажи STAHLER', 'Стеллажи STAHLER'],
		['яСтеллажи серии "Купец"', 'Стеллажи серии "Купец"'],
		['яСтеллаж Штрих', 'Стеллажи Штрих'],
		['яСтелаж архивный', 'Стеллаж архивный'],
		['яПрилавки торговые', 'Прилавки торговые'],
	]);
	if (manual.has(name)) return manual.get(name) || name;

	return name
		.replace(/^!+/, '')
		.replace(/^я+/i, '')
		.replace(/\s{2,}/g, ' ')
		.trim();
}

function shouldHidePublicNode(name: string): boolean {
	return (
		/^_+$/.test(name.trim()) ||
		/^(?:я+|!+)?(?:внутрен|яяя|яяя|перенесено|товар на ремонте|it отдел|материалы для собственных нужд|образцы|проекты|новое)/i.test(
			name.trim()
		) ||
		/(автомой|автохим|шампун|запчаст|комплектующ)/i.test(name) ||
		/(услуг|работы|ремонт|поверк|аренда|внутреннее потребление|журналы|справки|заявления)/i.test(
			name
		)
	);
}

function clonePublicNode(node: GroupNode): GroupNode | null {
	const visibleChildren = node.children
		.map((child) => clonePublicNode(child))
		.filter((child): child is GroupNode => Boolean(child));
	const visibleOwnProducts = node.products.map((product) => prepareDisplayProduct(product));
	const hidden = shouldHidePublicNode(node.name);

	if (hidden && visibleChildren.length === 0 && visibleOwnProducts.length === 0) {
		return null;
	}

	if (hidden && visibleChildren.length > 0 && visibleOwnProducts.length === 0) {
		return {
			id: `${node.id}-flattened`,
			name: sanitizeDisplayName(node.name),
			products: [],
			children: visibleChildren,
			branchProductCount: visibleChildren.reduce((sum, child) => sum + child.branchProductCount, 0),
		};
	}

	return {
		...node,
		name: sanitizeDisplayName(node.name),
		products: visibleOwnProducts,
		children: visibleChildren,
		branchProductCount:
			visibleOwnProducts.length +
			visibleChildren.reduce((sum, child) => sum + child.branchProductCount, 0),
	};
}

function dedupePublicNodeForDisplay(node: GroupNode, seenKeys: Set<string>): GroupNode | null {
	const children = node.children
		.map((child) => dedupePublicNodeForDisplay(child, seenKeys))
		.filter((child): child is GroupNode => Boolean(child));
	const products = dedupeProductsForDisplay(node.products, seenKeys);
	const branchProductCount = products.length + children.reduce((sum, child) => sum + child.branchProductCount, 0);

	if (branchProductCount === 0 && children.length === 0) {
		return null;
	}

	return {
		...node,
		products,
		children,
		branchProductCount,
	};
}

function makePublicSection(meta: CatalogSectionMeta, allNodes: GroupNode[]): GroupNode | null {
	const childNodes = meta.sourceNames
		.flatMap((sourceName) => allNodes.filter((node) => node.name === sourceName))
		.map((node) => clonePublicNode(node))
		.filter((node): node is GroupNode => Boolean(node))
		.filter((node, index, arr) => arr.findIndex((other) => other.id === node.id) === index)
		.sort(compareGroups);

	if (childNodes.length === 0) return null;

	return {
		id: meta.id,
		name: meta.name,
		products: [],
		children: childNodes,
		branchProductCount: childNodes.reduce((sum, child) => sum + child.branchProductCount, 0),
	};
}

function buildTree(groups: Group[], products: Product[], parentId: string | null | undefined): GroupNode[] {
	return groups
		.filter((group) => (group.parentId ?? null) === (parentId ?? null))
		.map((group) => {
			const children = buildTree(groups, products, group.id).sort(compareGroups);
			const ownProducts = products.filter((product) => product.groupId === group.id).sort(compareProducts);
			const inChildren = children.reduce((sum, child) => sum + child.branchProductCount, 0);
			return {
				id: group.id,
				name: group.name,
				products: ownProducts,
				children,
				branchProductCount: ownProducts.length + inChildren,
			};
		})
		.sort(compareGroups);
}

function readCatalog(): { groups: Group[]; products: Product[] } {
	const catalogPath = path.join(process.cwd(), 'public', 'catalog.json');
	let groups: Group[] = [];
	let products: Product[] = [];

	try {
		const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as
			| { groups?: Group[]; products?: Product[] }
			| Product[];
		if (Array.isArray(raw)) {
			products = raw;
		} else {
			groups = raw.groups ?? [];
			products = raw.products ?? [];
		}
	} catch {
		/* empty catalog */
	}

	return { groups, products };
}

export function getCatalogStorefront(): CatalogStorefrontResult {
	const { groups, products: rawProducts } = readCatalog();
	const enrichmentRecords = readProductEnrichmentCache();
	const products = rawProducts.map((product) => applyProductEnrichment(product, enrichmentRecords));
	const tree = buildTree(groups, products, null);
	const flatNodes = flattenNodes(tree);
	const publicSections = catalogSectionMetas
		.map((meta) => {
			const node = makePublicSection(meta, flatNodes);
			return node ? { meta, node } : null;
		})
		.filter((section): section is CatalogStorefrontSection => Boolean(section));

	const seenProductMeanings = new Set<string>();
	const sections = publicSections
		.map((section) => {
			const node = dedupePublicNodeForDisplay(section.node, seenProductMeanings);
			return node ? { ...section, node: buildEquipmentSectionNode(section.meta, node) } : null;
		})
		.filter((section): section is CatalogStorefrontSection => Boolean(section));

	const publicProductIds = new Set<string>();
	const publicNodeIds = new Set<string>();

	function collectPublicStats(nodes: GroupNode[]) {
		for (const node of nodes) {
			publicNodeIds.add(node.id);
			for (const product of node.products) {
				const pid = String(product.id || '');
				if (pid) publicProductIds.add(pid);
			}
			collectPublicStats(node.children);
		}
	}

	collectPublicStats(sections.map((section) => section.node));

	const totalProducts = publicProductIds.size || products.length;
	const totalGroups = publicNodeIds.size || groups.length;
	const inStockProducts = products.filter(
		(product) => publicProductIds.has(String(product.id || '')) && stockAvailabilityBand(product.quantity) !== 'order'
	).length;

	return {
		groups,
		products,
		sections,
		stats: [
			{ value: totalProducts.toLocaleString('ru-RU'), label: 'товаров на витрине' },
			{ value: totalGroups.toLocaleString('ru-RU'), label: 'публичных разделов и подпапок' },
			{ value: inStockProducts.toLocaleString('ru-RU'), label: 'позиций с остатком' },
		],
	};
}
