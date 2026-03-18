export default async function handler(req, res) {
    // Разрешаем CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Только POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { question } = req.body;
        
        // Отправляем запрос в OpenRouter
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer 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',
                'HTTP-Referer': 'https://ameta.online'
            },
            body: JSON.stringify({
                model: 'openrouter/free',
                messages: [
                    {
                        role: 'user',
                        content: question
                    }
                ]
            })
        });
        
        const data = await response.json();
        
        // Извлекаем ответ модели
        const answer = data.choices?.[0]?.message?.content || 'Извините, не удалось получить ответ.';
        
        return res.status(200).json({ answer });
        
    } catch (error) {
        console.error('OpenRouter error:', error);
        return res.status(500).json({ 
            answer: 'Извините, произошла ошибка. Попробуйте позже.'
        });
    }
}