import fs from 'node:fs';
import path from 'node:path';

export interface ProductSpec {
	name: string;
	value: string;
}

export interface ProductEnrichmentRecord {
	modelKey: string;
	brand?: string;
	model?: string;
	aliases: string[];
	image?: string;
	description?: string;
	specs?: ProductSpec[];
	sourceUrl?: string;
	sourceTitle?: string;
	confidence?: number;
	updatedAt?: string;
}

export interface EnrichedProductFields {
	image?: string;
	enrichedDescription?: string;
	specs?: ProductSpec[];
	enrichmentSourceUrl?: string;
	enrichmentSourceTitle?: string;
	enrichmentConfidence?: number;
}

interface ProductLike {
	name?: string;
	sku?: string;
}

interface EnrichmentCacheFile {
	generatedAt?: string;
	items?: ProductEnrichmentRecord[];
}

function normalizeText(value: unknown): string {
	return String(value || '')
		.toLowerCase()
		.replace(/ё/g, 'е')
		.replace(/[()"]/g, ' ')
		.replace(/[^a-zа-я0-9]+/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function tokenizeProductName(value: unknown): string[] {
	return normalizeText(value)
		.split(' ')
		.filter(Boolean);
}

function cleanupModelKey(value: string): string {
	return normalizeText(value)
		.replace(
			/\b(ккт|ккм|онлайн|касса|кассовый|аппарат|фискальный|регистратор|смарт|терминал|сканер|штрихкода|шк|тсд|сбора|данных|моноблок|сенсорный|весы|торговые|настольные|принтер|этикеток|чеков|проводной|беспроводной|ручной|без|с|под|подставкой|фн|фн15|фн36)\b/g,
			' '
		)
		.replace(/\s+/g, ' ')
		.trim();
}

function isMeaningfulMatchKey(value: string): boolean {
	return value.length >= 6 && /[a-zа-я]/i.test(value);
}

function hasModelLikeToken(value: string): boolean {
	return normalizeText(value)
		.split(' ')
		.some((token) => /[a-zа-я]/i.test(token) && /\d/.test(token));
}

export function buildProductMeaningKeys(product: ProductLike): string[] {
	const rawName = normalizeText(product.name);
	const keys = new Set<string>();
	if (rawName) keys.add(rawName);

	const cleaned = cleanupModelKey(rawName);
	if (cleaned) keys.add(cleaned);

	const atolMatch = cleaned.match(/\bатол\s+([a-zа-я0-9-]+)/i);
	if (atolMatch) {
		keys.add(`атол ${atolMatch[1]}`);
	}

	const tokens = tokenizeProductName(product.name);
	for (let i = 0; i < tokens.length - 1; i += 1) {
		const pair = `${tokens[i]} ${tokens[i + 1]}`;
		if (/\d/.test(pair) && /[a-zа-я]/i.test(pair)) keys.add(cleanupModelKey(pair));
	}
	for (let i = 0; i < tokens.length - 2; i += 1) {
		const triple = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
		if (/\d/.test(triple) && /[a-zа-я]/i.test(triple)) keys.add(cleanupModelKey(triple));
	}

	const sku = normalizeText(product.sku);
	if (sku) keys.add(sku);

	return [...keys].filter(Boolean);
}

export function readProductEnrichmentCache(): ProductEnrichmentRecord[] {
	const cachePath = path.join(process.cwd(), 'data', 'product-enrichment-cache.json');
	try {
		const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as EnrichmentCacheFile;
		return Array.isArray(raw.items) ? raw.items : [];
	} catch {
		return [];
	}
}

export function matchProductEnrichment(
	product: ProductLike,
	records: ProductEnrichmentRecord[]
): ProductEnrichmentRecord | null {
	if (records.length === 0) return null;

	const aliasMap = new Map<string, ProductEnrichmentRecord>();
	for (const record of records) {
		const keys = [record.modelKey, ...(record.aliases || [])].map(normalizeText).filter(Boolean);
		for (const key of keys) {
			if (!aliasMap.has(key)) aliasMap.set(key, record);
		}
	}

	const productKeys = buildProductMeaningKeys(product);
	for (const key of productKeys) {
		const exact = aliasMap.get(key);
		if (exact) return exact;
	}

	for (const key of productKeys) {
		for (const [alias, record] of aliasMap.entries()) {
			if (!isMeaningfulMatchKey(alias) || !isMeaningfulMatchKey(key)) continue;
			if (!hasModelLikeToken(alias) || !hasModelLikeToken(key)) continue;
			if (key.includes(alias) || alias.includes(key)) {
				return record;
			}
		}
	}

	return null;
}

export function applyProductEnrichment<T extends ProductLike & { description?: string }>(
	product: T,
	records: ProductEnrichmentRecord[]
): T & EnrichedProductFields {
	const match = matchProductEnrichment(product, records);
	if (!match) return product;

	return {
		...product,
		image: match.image,
		enrichedDescription: String(match.description || '').trim() || String(product.description || '').trim(),
		specs: match.specs || [],
		enrichmentSourceUrl: match.sourceUrl,
		enrichmentSourceTitle: match.sourceTitle,
		enrichmentConfidence: match.confidence,
	};
}
