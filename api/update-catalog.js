import fs from 'fs';
import path from 'path';
import { parseString } from 'xml2js';

const UPDATE_SECRET = '0011524AaSs!!!';

export default async function handler(req, res) {
    // Разрешаем всё
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Собираем ВСЮ информацию о запросе для отладки
    const debugInfo = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body,
        query: req.query,
        timestamp: new Date().toISOString()
    };

    // Для GET — просто показываем, что пришло
    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'debug',
            message: 'Получен GET-запрос',
            debug: debugInfo,
            instructions: 'Для выгрузки используйте POST с Basic Auth'
        });
    }

    // Для POST — проверяем авторизацию
    if (req.method === 'POST') {
        const authHeader = req.headers.authorization || '';
        
        // Парсим авторизацию
        let authInfo = { present: !!authHeader };
        if (authHeader) {
            authInfo.type = authHeader.startsWith('Basic ') ? 'Basic' : 'Unknown';
            if (authInfo.type === 'Basic') {
                try {
                    const base64Credentials = authHeader.split(' ')[1];
                    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
                    const [username, password] = credentials.split(':');
                    authInfo.username = username;
                    authInfo.password_received = !!password;
                    authInfo.password_length = password ? password.length : 0;
                    
                    // Проверяем правильность
                    authInfo.valid = (username === 'admin' && password === UPDATE_SECRET);
                } catch (e) {
                    authInfo.error = e.message;
                }
            }
        }

        // Возвращаем подробный отчёт
        return res.status(200).json({
            status: 'debug',
            message: 'Получен POST-запрос',
            auth: authInfo,
            debug: debugInfo
        });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}