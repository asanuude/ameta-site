/** Шкала отображения остатка на сайте (без точного числа). Синхронизируйте с клиентским дублем в index.astro при изменении правил. */

export type StockBand = 'order' | 'low' | 'medium' | 'plenty';

export function parseCatalogQuantity(raw: unknown): number {
	if (raw === null || raw === undefined || raw === '') return NaN;
	const n =
		typeof raw === 'number'
			? raw
			: parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
	return Number.isFinite(n) ? n : NaN;
}

export function stockAvailabilityBand(raw: unknown): StockBand {
	const n = parseCatalogQuantity(raw);
	if (!Number.isFinite(n) || n <= 0) return 'order';
	if (n <= 2) return 'low';
	if (n <= 10) return 'medium';
	return 'plenty';
}

export function stockAvailabilityLabel(raw: unknown): string {
	switch (stockAvailabilityBand(raw)) {
		case 'order':
			return 'Под заказ';
		case 'low':
			return 'Мало';
		case 'medium':
			return 'Много';
		case 'plenty':
			return 'Не иссякаемо';
	}
}
