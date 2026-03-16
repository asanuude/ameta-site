export default function handler(req, res) {
    // Разрешаем всё
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Для preflight OPTIONS
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Проверяем авторизацию
    const authHeader = req.headers.authorization;
    let authorized = false;
    let username = '';
    let password = '';

    if (authHeader && authHeader.startsWith('Basic ')) {
        const base64Credentials = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
        [username, password] = credentials.split(':');
        
        // Проверяем логин и пароль
        if (username === 'admin' && password === '0011524AaSs!!!') {
            authorized = true;
        }
    }

    if (!authorized) {
        // Возвращаем ошибку авторизации, как требует 1С
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Неверное имя пользователя или пароль'
        });
    }

    // Если авторизация успешна
    return res.status(200).json({
        status: 'ok',
        message: 'Авторизация успешна. Соединение установлено.',
        username: username,
        method: req.method,
        time: new Date().toISOString()
    });
}