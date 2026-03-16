export const prerender = false;

export async function POST({ request }) {
    try {
        const { question } = await request.json();
        
        return new Response(JSON.stringify({ 
            answer: `Вы спросили: "${question}". API работает!` 
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ 
            answer: 'Ошибка на сервере: ' + error.message 
        }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}