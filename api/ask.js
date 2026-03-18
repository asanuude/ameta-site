// Файл: api/ask.js
// Полноценный AI-консультант с данными из 1С

// Настройки OpenRouter
const OPENROUTER_API_KEY = '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';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SITE_URL = 'https://ameta.online';

// Настройки GitHub
const GITHUB_OWNER = 'asanuude';
const GITHUB_REPO = '1c-data';
const GITHUB_BRANCH = 'main';
const GITHUB_TOKEN = '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';

// Кэш для каталога
let catalog = [];
let lastFetch = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 минут

// Функция загрузки каталога с GitHub
async function loadCatalog() {
    const now = Date.now();
    
    // Используем кэш, если он свежий
    if (catalog.length > 0 && now - lastFetch < CACHE_TTL) {
        return catalog;
    }
    
    try {
        // Пытаемся загрузить catalog.json (если есть)
        const jsonUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/catalog.json`;
        const jsonResponse = await fetch(jsonUrl, {
            headers: GITHUB_TOKEN ? { 'Authorization': `token ${GITHUB_TOKEN}` } : {}
        });
        
        if (jsonResponse.ok) {
            catalog = await jsonResponse.json();
            console.log(`Загружен catalog.json: ${catalog.length} товаров`);
            lastFetch = now;
            return catalog;
        }
        
        // Если нет catalog.json, возвращаем пустой массив
        // (можно добавить загрузку из XML, но это уже есть в предыдущих версиях)
        catalog = [];
        lastFetch = now;
        return catalog;
        
    } catch (error) {
        console.error('Ошибка загрузки каталога:', error);
        return catalog;
    }
}

// Функция поиска товаров по вопросу
function searchProducts(query, products, limit = 5) {
    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(' ').filter(w => w.length > 2);
    
    if (words.length === 0) return [];
    
    // Оцениваем релевантность каждого товара
    const scored = products.map(product => {
        const name = (product.name || '').toLowerCase();
        const desc = (product.description || '').toLowerCase();
        const sku = (product.sku || '').toLowerCase();
        
        let score = 0;
        words.forEach(word => {
            if (name.includes(word)) score += 3;
            if (desc.includes(word)) score += 2;
            if (sku.includes(word)) score += 5; // артикул — самый важный
        });
        
        return { product, score };
    });
    
    // Сортируем по убыванию релевантности и берём первые limit
    return scored
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(item => item.product);
}

// Основной обработчик
export default async function handler(req, res) {
    // Разрешаем CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Только POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { question } = req.body;
        
        if (!question || question.trim() === '') {
            return res.status(400).json({ answer: 'Пожалуйста, задайте вопрос.' });
        }
        
        // 1. Загружаем каталог товаров
        const products = await loadCatalog();
        
        // 2. Ищем релевантные товары
        const relevantProducts = searchProducts(question, products, 5);
        
        // 3. Формируем контекст для AI
        let contextText = '';
        if (relevantProducts.length > 0) {
            contextText = 'Вот товары из нашего каталога, которые могут быть релевантны вопросу:\n\n' +
                relevantProducts.map((p, i) => 
                    `${i+1}. ${p.name}\n   Цена: ${p.price} руб.\n   Наличие: ${p.quantity > 0 ? 'в наличии' : 'под заказ'}\n   ${p.description || ''}`
                ).join('\n\n');
        }
        
        // 4. Формируем системный промпт
        const systemPrompt = `Ты — опытный консультант магазина кассовой техники и оборудования. 
Отвечай вежливо и по-русски. Используй информацию из каталога товаров для ответов.
Если товара нет в наличии, предложи аналоги. Если не знаешь точного ответа, честно скажи об этом.
Не выдумывай характеристики и цены — используй только данные из каталога.`;

        // 5. Отправляем запрос в OpenRouter
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: question }
        ];
        
        // Добавляем контекст, если есть товары
        if (contextText) {
            messages.splice(1, 0, { role: 'assistant', content: contextText });
        }
        
        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'HTTP-Referer': SITE_URL
            },
            body: JSON.stringify({
                model: 'openrouter/free',
                messages: messages,
                temperature: 0.3,
                max_tokens: 1000
            })
        });
        
        const data = await response.json();
        
        // Извлекаем ответ модели
        const answer = data.choices?.[0]?.message?.content || 
                      'Извините, не удалось получить ответ от AI.';
        
        return res.status(200).json({ answer });
        
    } catch (error) {
        console.error('OpenRouter error:', error);
        return res.status(500).json({ 
            answer: 'Извините, произошла внутренняя ошибка. Попробуйте позже.'
        });
    }
}