/**
 * Вызов опубликованного HTTP-метода 1С для создания счёта по корзине сайта.
 *
 * Ожидаемый контракт (на стороне 1С вы реализуете сами):
 *   POST JSON: {
 *     sessionId, source, createdAt,
 *     counterparty: { organizationName, inn },
 *     items: [{ nomenclatureId, sku, name, quantity, price }]
 *   }
 *   1С: создать «Заказ клиента», по нему — счёт; вернуть ссылки на PDF (и при необходимости печатную форму в браузере).
 *   Заголовок: Authorization: Bearer <ONEC_INVOICE_WEBHOOK_SECRET>
 *   Успех 200 JSON: {
 *     invoiceNumber?, number?, orderNumber?,
 *     pdfUrl? — прямая ссылка на PDF (открытие/скачивание в браузере),
 *     viewUrl? — опционально HTML/веб-просмотр,
 *     url? — запасное поле ссылки
 *   }
 *   Ошибка: статус 4xx/5xx и по возможности { error: string }
 *
 * Идентификатор номенклатуры: nomenclatureId = поле id из catalog.json (Ид товара CommerceML).
 */

export async function sendInvoiceRequestTo1C({ sessionId, items, counterparty }) {
    const url = (process.env.ONEC_INVOICE_WEBHOOK_URL || '').trim();
    const secret = (process.env.ONEC_INVOICE_WEBHOOK_SECRET || '').trim();
    if (!url || !secret) {
        return { configured: false };
    }

    const payload = {
        sessionId,
        source: 'ameta-site',
        createdAt: new Date().toISOString(),
        counterparty: {
            organizationName: counterparty?.organizationName || '',
            inn: counterparty?.inn || '',
        },
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
        const orderNumber = data.orderNumber ?? data.order ?? data.Заказ ?? '';
        const pdfUrl = String(data.pdfUrl ?? data.pdf ?? data.PdfUrl ?? '');
        const viewUrl = String(data.viewUrl ?? data.browserUrl ?? data.printUrl ?? '');
        const documentUrl = String(data.url ?? data.href ?? data.link ?? '');

        return {
            configured: true,
            ok: true,
            invoiceNumber: String(invoiceNumber || ''),
            orderNumber: String(orderNumber || ''),
            pdfUrl,
            viewUrl,
            documentUrl,
        };
    } catch (e) {
        const msg = e.name === 'AbortError' ? 'Таймаут ответа 1С' : e.message;
        return { configured: true, ok: false, error: msg };
    } finally {
        clearTimeout(timer);
    }
}
