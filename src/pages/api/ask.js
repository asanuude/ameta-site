export const prerender = false;

export async function OPTIONS() {
    return new Response(null, { status: 204 });
}

export async function POST({ request }) {
    try {
        const { question } = await request.json();

        // 1. Проверим, есть ли ключ
        const keyStatus = process.env.API_KEY ? "✅ Ключ есть" : "❌ Ключа нет";

        // 2. Попробуем вызвать AMETA и вернуть сырой результат
        const response = await fetch('https://api.ameta.online/ask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.API_KEY || ''
            },
            body: JSON.stringify({ question })
        });

        const text = await response.text(); // Сначала как текст, чтобы увидеть реальный ответ

        return new Response(JSON.stringify({ 
            keyStatus,
            ametaStatus: response.status,
            ametaResponse: text
        }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ 
            error: error.message,
            stack: error.stack
        }), { 
            status: 200, // Отдаём 200, чтобы увидеть ошибку в интерфейсе
            headers: { 'Content-Type': 'application/json' }
        });
    }
}