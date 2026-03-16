export const prerender = false;
import fs from 'fs';
import path from 'path';
import { parseString } from 'xml2js';

// Функция для чтения и парсинга XML-файлов
async function parseXMLFile(filePath) {
    const xmlContent = fs.readFileSync(filePath, 'utf8');
    return new Promise((resolve, reject) => {
        parseString(xmlContent, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

// Загружаем все данные при старте функции
let catalog = [];
let offers = [];

async function loadData() {
    try {
        // Путь к папке с данными
        const dataDir = path.join(process.cwd(), 'data');
        
        // Загружаем каталоги товаров
        const import0 = await parseXMLFile(path.join(dataDir, 'import0_1.xml'));
        const import1 = await parseXMLFile(path.join(dataDir, 'import1_1.xml'));
        
        // Загружаем предложения (цены и остатки)
        const offers0 = await parseXMLFile(path.join(dataDir, 'offers0_1.xml'));
        const offers1 = await parseXMLFile(path.join(dataDir, 'offers1_1.xml'));
        
        // Собираем все товары из каталогов
        const allProducts = [
            ...(import0?.КоммерческаяИнформация?.Каталог?.[0]?.Товары?.[0]?.Товар || []),
            ...(import1?.КоммерческаяИнформация?.Каталог?.[0]?.Товары?.[0]?.Товар || [])
        ];
        
        // Собираем все предложения
        const allOffers = [
            ...(offers0?.КоммерческаяИнформация?.ПакетПредложений?.[0]?.Предложения?.[0]?.Предложение || []),
            ...(offers1?.КоммерческаяИнформация?.ПакетПредложений?.[0]?.Предложения?.[0]?.Предложение || [])
        ];
        
        // Создаем удобную структуру: товар + его цена и остатки
        catalog = allProducts.map(product => {
            const offer = allOffers.find(o => o.Ид?.[0] === product.Ид?.[0]);
            const price = offer?.Цены?.[0]?.Цена?.[0]?.ЦенаЗаЕдиницу?.[0] || 'Цена не указана';
            const quantity = offer?.Количество?.[0] || 0;
            
            return {
                id: product.Ид?.[0],
                name: product.Наименование?.[0]?.trim() || '',
                description: product.Описание?.[0] || '',
                price: price,
                quantity: quantity,
                sku: product.ЗначенияРеквизитов?.[0]?.ЗначениеРеквизита?.find(r => r.Наименование?.[0] === 'Код')?.Значение?.[0]?.trim() || ''
            };
        });
        
        console.log(`Загружено товаров: ${catalog.length}`);
    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
    }
}

// Загружаем данные при инициализации
loadData();

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
        const lowerQuestion = question.toLowerCase();
        
        // Ищем товары по ключевым словам в названии
        const results = catalog.filter(product => {
            const name = product.name.toLowerCase();
            return lowerQuestion.split(' ').some(word => 
                word.length > 2 && name.includes(word)
            );
        });
        
        let answer = '';
        
        if (results.length === 0) {
            // Если ничего не нашли — предлагаем уточнить
            answer = 'Извините, я не нашёл товаров по вашему запросу. Уточните, пожалуйста, что именно вас интересует (например, "POS-система", "весы", "процессор")?';
        } else if (results.length === 1) {
            // Нашли один товар — показываем подробно
            const p = results[0];
            answer = `${p.name}\n💰 Цена: ${p.price} руб.\n📦 Наличие: ${p.quantity > 0 ? 'есть' : 'нет'} на складе\n📝 ${p.description || 'Описание отсутствует'}`;
        } else {
            // Нашли несколько — показываем список
            answer = 'Я нашёл несколько товаров:\n\n' + 
                results.slice(0, 5).map((p, i) => 
                    `${i+1}. ${p.name} — ${p.price} руб. (${p.quantity > 0 ? 'в наличии' : 'под заказ'})`
                ).join('\n') + 
                '\n\nУточните, какой именно товар вас интересует?';
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