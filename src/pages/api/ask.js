export async function POST({ request }) {
    try {
        const { question } = await request.json();
        
        // Простой ответ, который точно должен работать
        return new Response(JSON.stringify({ 
            answer: `Вы спросили: "${question}". Я пока учусь, но скоро буду отвечать!` 
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({ 
            answer: 'Ошибка на сервере' 
        }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}