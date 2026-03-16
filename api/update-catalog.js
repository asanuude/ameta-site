import fs from 'fs';
import path from 'path';
import { parseString } from 'xml2js';

const UPDATE_SECRET = '0011524AaSs!!!';

export default async function handler(req, res) {
    // Устанавливаем CORS-заголовки для всех ответов
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Обрабатываем preflight запросы (OPTIONS)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Проверяем авторизацию для всех методов
    const authHeader = req.headers.authorization;
    let authorized = false;

    if (authHeader) {
        if (authHeader.startsWith('Basic ')) {
            // Basic Auth
            const base64Credentials = authHeader.split(' ')[1];
            const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
            const [username, password] = credentials.split(':');
            
            if (username === 'admin' && password === UPDATE_SECRET) {
                authorized = true;
            }
        } else if (authHeader === `Bearer ${UPDATE_SECRET}`) {
            // Bearer Token
            authorized = true;
        }
    }

    // Для GET-запросов (проверка соединения)
    if (req.method === 'GET') {
        if (!authorized) {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'Проверьте имя пользователя и пароль в настройках 1С'
            });
        }
        
        return res.status(200).json({ 
            status: 'ok', 
            message: 'Соединение с сервером установлено успешно',
            server_time: new Date().toISOString()
        });
    }

    // Для POST-запросов (выгрузка данных)
    if (req.method === 'POST') {
        if (!authorized) {
            return res.status(401).json({ 
                error: 'Unauthorized',
                message: 'Неверный логин или пароль'
            });
        }

        try {
            // Здесь будет код обработки выгрузки
            // Пока просто возвращаем успех для теста
            return res.status(200).json({ 
                success: true, 
                message: 'Данные успешно получены',
                files_received: req.body ? Object.keys(req.body).length : 0
            });
            
        } catch (error) {
            console.error('Update error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // Если метод не поддерживается
    return res.status(405).json({ 
        error: 'Method not allowed',
        message: `Метод ${req.method} не поддерживается. Используйте GET для проверки или POST для выгрузки.`
    });
}