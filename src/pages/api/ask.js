export const prerender = false;

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        }
    });
}

export async function POST({ request }) {
    try {
        const { question } = await request.json();

        // База знаний по вашим товарам (из файлов 1С)
        const answers = {
            'процессор': 'В модели POS-компьютер "ШТРИХ-POS-VIA C7" установлен процессор VIA C7 с частотой 1.5 ГГц.',
            'память': 'Оперативная память: 512 МБ, жесткий диск: 80 ГБ.',
            'цена': 'Цена на POS-компьютер "ШТРИХ-POS-VIA C7" — 20 990 руб.',
            'наличие': 'Интересующий вас товар есть в наличии на складе.',
            'характеристики': 'Процессор VIA C7 1.5 ГГц, RAM 512 МБ, HDD 80 ГБ, пассивное охлаждение, 4 COM-порта, 2 USB.',
            'привет': 'Здравствуйте! Чем могу помочь?',
            'спасибо': 'Всегда рад помочь! Обращайтесь.',
            'сколько стоит': 'Цена на POS-компьютер "ШТРИХ-POS-VIA C7" — 20 990 руб.',
            'есть в наличии': 'Да, товар есть в наличии на складе.'
        };

        // Ищем ключевые слова в вопросе
        let answer = '';
        const lowerQuestion = question.toLowerCase();

        for (const [key, value] of Object.entries(answers)) {
            if (lowerQuestion.includes(key)) {
                answer = value;
                break;
            }
        }

        // Если ничего не нашли
        if (!answer) {
            answer = 'Извините, я ещё учусь. По этому вопросу лучше уточнить у менеджера.';
        }

        return new Response(JSON.stringify({ answer }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            answer: 'Извините, произошла ошибка. Попробуйте ещё раз.'
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}