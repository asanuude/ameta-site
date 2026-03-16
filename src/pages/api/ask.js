// Файл: src/pages/api/ask.js
export async function POST({ request }) {
    try {
        const { question } = await request.json();
        
        const response = await fetch('https://api.ameta.online/ask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.API_KEY
            },
            body: JSON.stringify({ question })
        });
        
        const data = await response.json();
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ 
            answer: 'Извините, произошла ошибка. Попробуйте позже.' 
        }), { status: 500 });
    }
}