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

function compareProducts(a: Product, b: Product): number {
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
	return (
		parsePriceValue(product.price) <= 0 ||
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
			return node ? { ...section, node } : null;
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
