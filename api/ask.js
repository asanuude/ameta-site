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
    
    if (catalog.length > 0 && now - lastFetch < CACHE_TTL) {
        return catalog;
    }
    
    try {
        const baseUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;
        
        let allProducts = [];
        let allOffers = [];
        
        const promises = FILES.map(async (file) => {
            try {
                const response = await fetch(`${baseUrl}/${file}`);
                if (!response.ok) return null;
                const xmlText = await response.text();
                const parsed = await parseXMLString(xmlText);
                return { file, parsed };
            } catch {
                return null;
            }
        });
        
        const results = await Promise.all(promises);
        
        results.forEach(result => {
            if (!result) return;
            
            const { file, parsed } = result;
            
            if (file.startsWith('import')) {
                const products = parsed?.КоммерческаяИнформация?.Каталог?.[0]?.Товары?.[0]?.Товар || [];
                allProducts = [...allProducts, ...products];
            }
            else if (file.startsWith('offers')) {
                const offers = parsed?.КоммерческаяИнформация?.ПакетПредложений?.[0]?.Предложения?.[0]?.Предложение || [];
                allOffers = [...allOffers, ...offers];
            }
        });
        
        catalog = allProducts.map(product => {
            const offer = allOffers.find(o => o.Ид?.[0] === product.Ид?.[0]);
            
            let totalQuantity = 0;
            if (offer?.Склад) {
                offer.Склад.forEach(sklad => {
                    totalQuantity += Number(sklad.$.КоличествоНаСкладе || 0);
                });
            }
            
            let price = 'Цена не указана';
            if (offer?.Цены?.[0]?.Цена?.[0]?.ЦенаЗаЕдиницу?.[0]) {
                price = offer.Цены[0].Цена[0].ЦенаЗаЕдиницу[0];
            }
            
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
        return catalog;
        
    } catch (error) {
        return catalog;
    }
}

// Функция поиска с синонимами
function searchProducts(query, products) {
    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(' ').filter(w => w.length > 1);
    
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

// Основной обработчик для Vercel
export default async function handler(req, res) {
    // Разрешаем CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Обрабатываем preflight запросы
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Разрешаем только POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { question } = req.body;
        const lowerQuestion = question.toLowerCase();
        
        const products = await loadData();
        
        // Приветствие
        if (lowerQuestion.includes('привет') || lowerQuestion.includes('здравствуйте')) {
            const categories = getPopularCategories(products);
            return res.status(200).json({
                answer: `Здравствуйте! Я AI-консультант AMETA. В нашем каталоге есть: ${categories.join(', ')}.\nЧто именно вас интересует?`
            });
        }
        
        const results = searchProducts(lowerQuestion, products);
        
        let answer = '';
        
        if (results.length === 0) {
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
        
        return res.status(200).json({ answer });
        
    } catch (error) {
        return res.status(500).json({
            answer: 'Извините, произошла ошибка. Попробуйте ещё раз.'
        });
    }
}