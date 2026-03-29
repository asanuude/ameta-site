/**
 * Вызов опубликованного HTTP-метода 1С для создания счёта по корзине сайта.
 *
 * Ожидаемый контракт (на стороне 1С вы реализуете сами):
 *   POST JSON: { sessionId, source, createdAt, items: [{ nomenclatureId, sku, name, quantity, price }] }
 *   Заголовок: Authorization: Bearer <ONEC_INVOICE_WEBHOOK_SECRET>
 *   Успех 200 JSON: { invoiceNumber?: string, number?: string, url?: string }
 *   Ошибка: статус 4xx/5xx и по возможности { error: string }
 *
 * Идентификатор номенклатуры: nomenclatureId = поле id из catalog.json (Ид товара CommerceML).
 */

export async function sendInvoiceRequestTo1C({ sessionId, items }) {
    const url = (process.env.ONEC_INVOICE_WEBHOOK_URL || '').trim();
    const secret = (process.env.ONEC_INVOICE_WEBHOOK_SECRET || '').trim();
    if (!url || !secret) {
        return { configured: false };
    }

    const payload = {
        sessionId,
        source: 'ameta-site',
        createdAt: new Date().toISOString(),
        items: items.map((i) => ({
            nomenclatureId: i.id || null,
            sku: i.sku || '',
            name: i.name,
            quantity: i.quantity,
            price: Number(i.price),
        })),
    };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25000);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${secret}`,
            },
            body: JSON.stringify(payload),
            signal: ac.signal,
        });

        const text = await response.text();
        let data = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = { raw: text };
        }

        if (!response.ok) {
            return {
                configured: true,
                ok: false,
                error: data.error || data.message || text || `HTTP ${response.status}`,
            };
        }

        const invoiceNumber =
            data.invoiceNumber ?? data.number ?? data.Номер ?? data.invoice ?? '';
        const documentUrl = data.url ?? data.href ?? data.link ?? '';

        return {
            configured: true,
            ok: true,
            invoiceNumber: String(invoiceNumber || ''),
            documentUrl: String(documentUrl || ''),
        };
    } catch (e) {
        const msg = e.name === 'AbortError' ? 'Таймаут ответа 1С' : e.message;
        return { configured: true, ok: false, error: msg };
    } finally {
        clearTimeout(timer);
    }
}
