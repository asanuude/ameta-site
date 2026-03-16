export const prerender = false;

export async function POST({ request }) {
    try {
        const { question } = await request.json();

        // Отправляем запрос к внутреннему API AMETA
        const response = await fetch('https://api.ameta.online/ask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.API_KEY
            },
            body: JSON.stringify({ question })
        });

        // Получаем ответ как простой текст
        const text = await response.text();

        // Возвращаем этот текст вместе со статусом HTTP от AMETA
        return new Response(JSON.stringify({
            ametaStatus: response.status,
            ametaResponse: text
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        // Если fetch вообще упал (например, сеть не доступна)
        return new Response(JSON.stringify({
            fatalError: error.message
        }), { status: 200 });
    }
}