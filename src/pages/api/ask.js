// Файл: src/pages/api/ask.js
// API endpoint для обработки вопросов

export async function POST({ request }) {
    try {
        const { question } = await request.json();
        
        // Здесь будет подключение к моему API
        // Пока возвращаем тестовый ответ
        
        // Имитация ответа на основе вопроса
        let answer = '';
        
        if (question.toLowerCase().includes('привет') || question.toLowerCase().includes('здравствуйте')) {
            answer = 'Здравствуйте! Чем я могу вам помочь?';
        } else if (question.toLowerCase().includes('цена') || question.toLowerCase().includes('стоит')) {
            answer = 'Для точной информации о ценах, пожалуйста, уточните модель товара. Я могу найти информацию в базе данных.';
        } else if (question.toLowerCase().includes('наличие') || question.toLowerCase().includes('есть в наличии')) {
            answer = 'Да, большинство товаров есть в наличии. По конкретной модели могу уточнить точное количество.';
        } else {
            answer = 'Спасибо за вопрос! Я ещё учусь отвечать на такие вопросы. Скоро здесь будет подключён настоящий AI-консультант с данными из 1С.';
        }
        
        return new Response(JSON.stringify({ answer }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({ 
            answer: 'Извините, произошла ошибка. Пожалуйста, попробуйте позже.' 
        }), {
            status: 500,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
}