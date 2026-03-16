export default async function handler(req, res) {
    // Разрешаем CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Только POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { question } = req.body;
        
        // Простейший ответ
        return res.status(200).json({ 
            answer: `Вы спросили: "${question}". Функция работает!` 
        });
        
    } catch (error) {
        return res.status(500).json({ 
            error: error.message,
            answer: 'Извините, произошла внутренняя ошибка'
        });
    }
}