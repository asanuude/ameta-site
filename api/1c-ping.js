export default function handler(req, res) {
    // Разрешаем всё
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    // Для preflight OPTIONS всегда отвечаем OK
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Для любого метода отвечаем 200 OK
    return res.status(200).json({
        status: 'ok',
        message: 'Соединение с сервером установлено',
        method: req.method,
        time: new Date().toISOString()
    });
}