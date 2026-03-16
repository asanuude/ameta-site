export const prerender = false;
import { parseString } from 'xml2js';

// Конфигурация GitHub
const GITHUB_OWNER = 'asanuude';
const GITHUB_REPO = '1c-data';
const GITHUB_BRANCH = 'main';

// Список файлов для загрузки
const FILES = [
    'import0_1.xml',
    'import1_1.xml',
    'import2_1.xml',
    'offers0_1.xml',
    'offers1_1.xml',
    'offers2_1.xml'
];

// Кэш для каталога
let catalog = [];
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 минут

// Функция для парсинга XML
function parseXMLString(xmlString) {
    return new Promise((resolve, reject) => {
        parseString(xmlString, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

// Функция загрузки данных с GitHub
async function loadData() {
    const now = Date.now();
    
    // Используем кэш, если он свежий
    if (catalog.length > 0 && now - lastFetch < CACHE_TTL) {
        console.log('Используем кэшированные данные');
        return catalog;
    }
    
    try {
        console.log('Загрузка данных с GitHub...');
        const baseUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;
        
        let allProducts = [];
        let allOffers = [];
        
        // Загружаем все файлы параллельно
        const promises = FILES.map(async (file) => {
            try {
                const response = await fetch(`${baseUrl}/${file}`);
                if (!response.ok) {
                    console.log(`Файл ${file} не найден (${response.status})`);
                    return null;
                }
                const xmlText = await response.text();
                const parsed = await parseXMLString(xmlText);
                return { file, parsed };
            } catch (e) {
                console.log(`Ошибка загрузки ${file}:`, e.message);
                return null;
            }
        });
        
        const results = await Promise.all(promises);
        
        // Обрабатываем результаты
        results.forEach(result => {
            if (!result) return;
            
            const { file, parsed } = result;
            
            if (file.startsWith('import')) {
                const products = parsed?.КоммерческаяИнформация?.Каталог?.[0]?.Товары?.[0]?.Товар || [];
                allProducts = [...allProducts, ...products];
                console.log(`Загружено товаров из ${file}: ${products.length}`);
            }
            else if (file.startsWith('offers')) {
                const offers = parsed?.КоммерческаяИнформация?.ПакетПредложений?.[0]?.Предложения?.[0]?.Предложение || [];
                allOffers = [...allOffers, ...offers];
                console.log(`Загружено предложений из ${file}: ${offers.length}`);
            }
        });
        
        // Формируем единый каталог
        catalog = allProducts.map(product => {
            const offer = allOffers.find(o => o.Ид?.[0] === product.Ид?.[0]);
            
            // Считаем общее количество по всем складам
            let totalQuantity = 0;
            if (offer?.Склад) {
                offer.Склад.forEach(sklad => {
                    totalQuantity += Number(sklad.$.КоличествоНаСкладе || 0);
                });
            }
            
            // Получаем цену
            let price = 'Цена не указана';
            if (offer?.Цены?.[0]?.Цена?.[0]?.ЦенаЗаЕдиницу?.[0]) {
                price = offer.Цены[0].Цена[0].ЦенаЗаЕдиницу[0];
            }
            
            // Получаем артикул (код)
            let sku = '';
            const requisites = product.ЗначенияРеквизитов?.[0]?.ЗначениеРеквизита || [];
            const skuRequisite = requisites.find(r => r.Наименование?.[0] === 'Код');
            if (skuRequisite) {
                sku = skuRequisite.Значение?.[0]?.trim() || '';
            }
            
            return {
                id: product.Ид?.[0],
                name: product.Наименование?.[0]?.trim() || '',
                description: product.Описание?.[0] || '',
                price: price,
                quantity: totalQuantity,
                sku: sku
            };
        });
        
        lastFetch = now;
        console.log(`✅ Всего загружено товаров: ${catalog.length}`);
        return catalog;
        
    } catch (error) {
        console.error('❌ Ошибка загрузки с GitHub:', error);
        return catalog; // Возвращаем старые данные в случае ошибки
    }
}

// Функция поиска с синонимами
function searchProducts(query, products) {
    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(' ').filter(w => w.length > 1);
    
    // Расширяем запрос синонимами
    const searchTerms = new Set(words);
    
    words.forEach(word => {
        if (word.includes('касс') || word.includes('ккм')) {
            searchTerms.add('ккм');
            searchTerms.add('фр');
            searchTerms.add('фискальный');
            searchTerms.add('регистратор');
        }
        if (word.includes('вес')) {
            searchTerms.add('весы');
            searchTerms.add('вэт');
            searchTerms.add('вр');
            searchTerms.add('мк');
        }
        if (word.includes('принтер') || word.includes('печат')) {
            searchTerms.add('принтер');
            searchTerms.add('фр');
            searchTerms.add('fprint');
            searchTerms.add('печати');
        }
        if (word.includes('комп') || word.includes('pos')) {
            searchTerms.add('pos');
            searchTerms.add('компьютер');
            searchTerms.add('моноблок');
            searchTerms.add('терминал');
        }
        if (word.includes('скан')) {
            searchTerms.add('сканер');
            searchTerms.add('штрихкод');
        }
        if (word.includes('диск')) {
            searchTerms.add('диск');
            searchTerms.add('флэш');
            searchTerms.add('usb');
        }
    });
    
    // Ищем товары
    const results = products.filter(p => {
        const name = p.name.toLowerCase();
        const desc = (p.description || '').toLowerCase();
        const sku = (p.sku || '').toLowerCase();
        
        return Array.from(searchTerms).some(term => 
            name.includes(term) || desc.includes(term) || sku.includes(term)
        );
    });
    
    return results;
}

// Функция для получения популярных категорий
function getPopularCategories(products) {
    const categories = [];
    
    if (products.some(p => p.name.includes('POS') || p.name.includes('Комп'))) {
        categories.push('POS-системы');
    }
    if (products.some(p => p.name.includes('Вес'))) {
        categories.push('весы');
    }
    if (products.some(p => p.name.includes('ККМ') || p.name.includes('касс'))) {
        categories.push('кассовые аппараты');
    }
    if (products.some(p => p.name.includes('терминал'))) {
        categories.push('терминалы');
    }
    if (products.some(p => p.name.includes('принтер') || p.name.includes('FPrint'))) {
        categories.push('принтеры');
    }
    
    return categories;
}

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
        
        // Загружаем данные
        const products = await loadData();
        
        // Специальная обработка приветствия
        if (lowerQuestion.includes('привет') || lowerQuestion.includes('здравствуйте')) {
            const categories = getPopularCategories(products);
            return new Response(JSON.stringify({
                answer: `Здравствуйте! Я AI-консультант AMETA. В нашем каталоге есть: ${categories.join(', ')}.\nЧто именно вас интересует?`
            }), { status: 200 });
        }
        
        // Ищем товары
        const results = searchProducts(lowerQuestion, products);
        
        let answer = '';
        
        if (results.length === 0) {
            // Проверяем общие запросы
            const generalQueries = ['какие товары', 'что есть', 'ассортимент', 'каталог', 'все товары'];
            if (generalQueries.some(q => lowerQuestion.includes(q))) {
                const categories = getPopularCategories(products);
                answer = `В нашем каталоге представлены: ${categories.join(', ')}.\n\nУточните, что именно вас интересует?`;
            } else {
                const categories = getPopularCategories(products);
                answer = `Извините, я не нашёл товаров по вашему запросу. Попробуйте уточнить, например: ${categories.join(', ')}.`;
            }
        }
        else if (results.length === 1) {
            const p = results[0];
            const availability = p.quantity > 0 ? '✅ в наличии' : '❌ под заказ';
            answer = `${p.name}\n💰 Цена: ${p.price} руб.\n📦 Наличие: ${availability}\n📝 ${p.description || 'Описание отсутствует'}`;
        }
        else {
            answer = 'Я нашёл несколько товаров:\n\n' +
                results.slice(0, 5).map((p, i) => {
                    const availability = p.quantity > 0 ? 'в наличии' : 'под заказ';
                    return `${i+1}. ${p.name} — ${p.price} руб. (${availability})`;
                }).join('\n') +
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
        console.error('Ошибка в POST:', error);
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