import fs from 'fs';
import path from 'path';
import { parseString } from 'xml2js';

export const config = {
    api: {
        bodyParser: false, // Отключаем встроенный парсер, чтобы получить raw данные
    },
};

export default async function handler(req, res) {
    // Разрешаем CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Только POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Получаем файлы из multipart/form-data
        const files = [];
        
        // Простейший парсинг (для начала)
        // В реальности лучше использовать formidable или multer
        
        return res.status(200).json({ 
            success: true, 
            message: 'Файлы получены',
            filesCount: files.length
        });
        
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}