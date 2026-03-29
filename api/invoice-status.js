/**
 * GET — проверка, что вебхук счёта и организация продавца заданы в Vercel (без раскрытия секретов).
 */
export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const rawUrl = (process.env.ONEC_INVOICE_WEBHOOK_URL || '').trim();
    const hasSecret = !!(process.env.ONEC_INVOICE_WEBHOOK_SECRET || '').trim();
    const org = (process.env.AMETA_1C_ORGANIZATION_NAME || '').trim();
    let host = null;
    let pathOk = null;
    try {
        const u = new URL(rawUrl);
        host = u.hostname || null;
        pathOk = /\/hs\/agent\/ameta\/invoice\/?$/i.test(u.pathname || '');
    } catch {
        host = null;
    }

    return res.status(200).json({
        webhookUrlConfigured: !!rawUrl,
        webhookSecretConfigured: hasSecret,
        webhookHost: host,
        webhookPathLooksLikeAmetaInvoice: pathOk,
        sellerOrganizationConfigured: !!org,
        readyForInvoiceCall: !!(rawUrl && hasSecret && org),
    });
}
