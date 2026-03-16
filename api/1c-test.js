export default function handler(req, res) {
    // Этот эндпоинт создан специально для проверки соединения из 1С
    // Он принимает ЛЮБОЙ метод и всегда отвечает 200 OK
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Для preflight запросов
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Проверяем авторизацию
    const authHeader = req.headers.authorization;
    let authorized = false;
    
    if (authHeader) {
        if (authHeader.startsWith('Basic ')) {
            const base64Credentials = authHeader.split(' ')[1];
            const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
            const [username, password] = credentials.split(':');
            
            if (username === 'admin' && password === '0011524AaSs!!!') {
                authorized = true;
            }
        }
    }
    
    // Возвращаем понятный для 1С ответ
    return res.status(200).json({
        status: 'ok',
        connection: 'successful',
        authorized: authorized,
        message: authorized ? 'Авторизация успешна' : 'Авторизация не требуется для проверки',
        method: req.method,
        time: new Date().toISOString()
    });
}