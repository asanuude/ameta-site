// Вместо текущей проверки авторизации вставьте это:

// Проверяем авторизацию (поддерживаем оба варианта)
const authHeader = request.headers.get('Authorization');
const basicAuth = request.headers.get('Authorization')?.startsWith('Basic ');

// Если есть Basic Auth, проверяем логин/пароль
if (basicAuth) {
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = atob(base64Credentials);
    const [username, password] = credentials.split(':');
    
    // Проверяем логин/пароль
    if (username !== 'admin' || password !== '0011524AaSs!!!') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
            status: 401 
        });
    }
} 
// Если нет Basic Auth, проверяем Bearer token
else if (!authHeader || authHeader !== `Bearer ${UPDATE_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401 
    });
}