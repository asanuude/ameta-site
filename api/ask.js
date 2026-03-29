// Конфигурация через переменные окружения (Vercel → Settings → Environment Variables).
// Локально: скопируйте .env.example → .env.local и заполните.

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_URL =
    process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
const SITE_URL =
    process.env.SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://ameta.online');
const CATALOG_URL =
    process.env.CATALOG_URL ||
    'https://raw.githubusercontent.com/asanuude/1c-data/main/catalog.json';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

// Хранилище истории и корзины
const conversationHistory = new Map();
const shoppingCarts = new Map();

setInterval(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [key, value] of conversationHistory.entries()) {
        if (value.timestamp < oneHourAgo) conversationHistory.delete(key);
    }
    for (const [key, value] of shoppingCarts.entries()) {
        if (value.timestamp < oneHourAgo) shoppingCarts.delete(key);
    }
}, 60 * 60 * 1000);

let catalog = null;
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function loadCatalog() {
    const now = Date.now();
    if (catalog && now - lastFetch < CACHE_TTL) return catalog;
    
    try {
        const headers = {};
        if (GITHUB_TOKEN) {
            headers.Authorization = `token ${GITHUB_TOKEN}`;
        }
        const response = await fetch(CATALOG_URL, { headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        lastFetch = now;
        catalog = Array.isArray(data) ? data : (data.products || []);
        return catalog;
    } catch (error) {
        return catalog || [];
    }
}

// Функция для получения случайных товаров (резервный вариант)
function getRandomProducts(products, count = 3) {
    const inStock = products.filter(p => p.price > 0 && p.quantity > 0);
    return inStock.sort(() => 0.5 - Math.random()).slice(0, count);
}

// АВТОМАТИЧЕСКОЕ ОПРЕДЕЛЕНИЕ КАТЕГОРИЙ
function getCategoryStats(products) {
    const stats = {};
    const categoryKeywords = {
        'кассовые аппараты': ['ккм', 'касс', 'фр', 'фискальн'],
        'весы': ['вес', 'вэт', 'вр', 'мк'],
        'сканеры': ['скан', 'barcode'],
        'терминалы': ['терминал', 'тсд'],
        'pos-системы': ['pos', 'комп', 'моноблок'],
        'принтеры': ['принтер', 'печат', 'fprint'],
        'комплектующие': ['блок', 'плата', 'модуль', 'кнопк', 'кабель'],
        'пищевое оборудование': ['пище', 'кафе', 'ресторан', 'кухн'],
        'торговое оборудование': ['торг', 'магазин', 'витрин'],
        'весовое оборудование': ['вес', 'гир', 'платформ'],
        'кассовое оборудование': ['касс', 'ккм', 'денежн'],
        'складское оборудование': ['склад', 'стеллаж', 'полк'],
        'холодильное оборудование': ['холод', 'мороз', 'рефриж'],
        'упаковочное оборудование': ['упак', 'пленк', 'термо'],
        'фасовочное оборудование': ['фас', 'дозатор'],
        'оборудование для общепита': ['пище', 'столов', 'кафе', 'ресторан']
    };
    
    for (const cat in categoryKeywords) {
        stats[cat] = { count: 0, examples: [] };
    }
    stats['прочее'] = { count: 0, examples: [] };
    
    products.forEach(p => {
        if (!p.price || p.price <= 0 || !p.quantity || p.quantity <= 0) return;
        
        const name = (p.name || '').toLowerCase();
        let assigned = false;
        
        for (const [cat, keywords] of Object.entries(categoryKeywords)) {
            if (keywords.some(keyword => name.includes(keyword))) {
                stats[cat].count++;
                if (stats[cat].examples.length < 3) {
                    stats[cat].examples.push(p.name);
                }
                assigned = true;
                break;
            }
        }
        
        if (!assigned) {
            stats['прочее'].count++;
            if (stats['прочее'].examples.length < 3) {
                stats['прочее'].examples.push(p.name);
            }
        }
    });
    
    for (const cat in stats) {
        if (stats[cat].count === 0) {
            delete stats[cat];
        }
    }
    
    return stats;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { question, sessionId = 'default' } = req.body;
        
        console.log('🔍 ПОЛУЧЕН ЗАПРОС:', JSON.stringify({ question, sessionId }));
        
        const products = await loadCatalog();
        
        if (!conversationHistory.has(sessionId)) {
            conversationHistory.set(sessionId, { 
                messages: [], 
                timestamp: Date.now() 
            });
        }
        const session = conversationHistory.get(sessionId);
        session.timestamp = Date.now();
        
        const lowerQ = question.toLowerCase();
        
        // 1️⃣ ВЫСТАВЛЕНИЕ СЧЁТА
        if (lowerQ.includes('счет') || lowerQ.includes('счёт') || lowerQ.includes('выпиши') || lowerQ.includes('оплату')) {
            
            if (!shoppingCarts.has(sessionId)) {
                shoppingCarts.set(sessionId, { items: [], timestamp: Date.now() });
            }
            const cart = shoppingCarts.get(sessionId);
            
            let answer;
            if (cart.items.length > 0) {
                const itemsList = cart.items.map(item => 
                    `- ${item.name} (${item.quantity} шт.) — ${item.price * item.quantity} руб.`
                ).join('\n');
                const total = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                
                answer = `**Ваш заказ:**\n\n${itemsList}\n\n**Итого: ${total} руб.**\n\n` +
                    `⚠️ Функция автоматического выставления счетов в 1С находится в разработке.\n` +
                    `Пожалуйста, свяжитесь с менеджером для оформления заказа.\n\n` +
                    `📞 Телефон: +7 (3012) 333-000\n📧 Email: sales@ameta.online`;
            } else {
                answer = `Я вижу, вы хотите оформить заказ. Чтобы выписать счёт, сначала добавьте товары в корзину.\n\n` +
                    `Например, спросите:\n` +
                    `- "добавь детектор IRD-1000"\n` +
                    `- "положи в корзину весы BS 815"\n` +
                    `- "покажи корзину"`;
            }
            
            session.messages.push({ role: 'user', content: question });
            session.messages.push({ role: 'assistant', content: answer });
            
            return res.status(200).json({ answer });
        }
        
        // 2️⃣ ДОБАВЛЕНИЕ В КОРЗИНУ
        if (lowerQ.includes('добавь') || lowerQ.includes('положи') || lowerQ.includes('в корзину')) {
            
            const searchQuery = question.replace(/добавь|положи|в корзину|пожалуйста/gi, '').trim();
            
            if (!searchQuery) {
                const answer = `Что именно добавить? Например: "добавь детектор IRD-1000"`;
                session.messages.push({ role: 'user', content: question });
                session.messages.push({ role: 'assistant', content: answer });
                return res.status(200).json({ answer });
            }
            
            // Простой поиск для добавления в корзину
            const found = products
                .filter(p => p.price > 0 && p.quantity > 0)
                .filter(p => (p.name || '').toLowerCase().includes(searchQuery.toLowerCase()))
                .slice(0, 1);
            
            if (found.length > 0) {
                const product = found[0];
                
                if (!shoppingCarts.has(sessionId)) {
                    shoppingCarts.set(sessionId, { items: [], timestamp: Date.now() });
                }
                const cart = shoppingCarts.get(sessionId);
                
                const existing = cart.items.find(item => item.name === product.name);
                if (existing) {
                    existing.quantity++;
                } else {
                    cart.items.push({
                        name: product.name,
                        price: product.price,
                        quantity: 1
                    });
                }
                cart.timestamp = Date.now();
                
                const answer = `✅ **${product.name}** добавлен в корзину.\n` +
                    `Цена: ${product.price} руб.\n\n` +
                    `В корзине сейчас ${cart.items.length} товаров на сумму ${cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0)} руб.\n\n` +
                    `Чтобы оформить заказ, напишите "выпиши счёт".`;
                
                session.messages.push({ role: 'user', content: question });
                session.messages.push({ role: 'assistant', content: answer });
                
                return res.status(200).json({ answer });
            } else {
                const answer = `Товар "${searchQuery}" не найден. Попробуйте уточнить название.`;
                session.messages.push({ role: 'user', content: question });
                session.messages.push({ role: 'assistant', content: answer });
                return res.status(200).json({ answer });
            }
        }
        
        // 3️⃣ ПОКАЗАТЬ КОРЗИНУ
        if (lowerQ.includes('корзин') || lowerQ.includes('заказ') || lowerQ.includes('что выбрал')) {
            
            let answer;
            if (shoppingCarts.has(sessionId) && shoppingCarts.get(sessionId).items.length > 0) {
                const cart = shoppingCarts.get(sessionId);
                const itemsList = cart.items.map(item => 
                    `- ${item.name} — ${item.price} руб. (${item.quantity} шт.)`
                ).join('\n');
                const total = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                
                answer = `**Ваша корзина:**\n\n${itemsList}\n\n**Итого: ${total} руб.**\n\n` +
                    `Если хотите оформить заказ, напишите "выпиши счёт".`;
            } else {
                answer = `Ваша корзина пуста. Добавьте товары, например: "добавь сканер" или "положи в корзину весы".`;
            }
            
            session.messages.push({ role: 'user', content: question });
            session.messages.push({ role: 'assistant', content: answer });
            
            return res.status(200).json({ answer });
        }
        
        // 4️⃣ СИСТЕМНЫЙ ПРОМПТ
        const systemPrompt = `Ты — профессиональный консультант компании AMETA. Мы продаём ВСЁ, что может понадобиться для оснащения коммерческих помещений.

ПРЕДСТАВЬ, ЧТО ТЫ ЗАХОДИШЬ В ПОМЕЩЕНИЕ:
- 🏪 Магазин: кассы, весы, сканеры, принтеры, холодильники, витрины, стеллажи, тележки, ценники, кассовая лента, терминалы сбора данных
- 🍽️ Кухня ресторана или столовой: плиты, печи, пароконвектоматы, фритюрницы, грили, холодильники, морозильные лари, разделочные столы, мойки, посуда, ножи, кастрюли, сковороды
- 🏭 Производственный цех: технологические линии, фасовочное оборудование, дозаторы, упаковщики, конвейеры, весы, термометры, стеллажи, ёмкости, инвентарь
- 💻 Офис: компьютеры, принтеры, сканеры, ПО, 1С, Атол, Штрих-М, Poscenter, DataMobile
- 📦 Склад: стеллажи, поддоны, тележки, терминалы, весы, упаковка, маркировка

ТВОЯ ЗАДАЧА:
1. Отвечай как опытный консультант, используя данные из каталога
2. Если клиент спрашивает про конкретный товар — найди его в каталоге
3. Если клиент спрашивает про категорию — покажи все подходящие товары из каталога
4. Если товара нет в наличии — предложи под заказ
5. Всегда предлагай доставку и сервис`;

        // 5️⃣ ОПРЕДЕЛЯЕМ, ЭТО ЗАПРОС ПОМОЩИ
        const isHelpRequest = /помоги|посоветуй|категории|что есть|расскажи/i.test(question);
        
        if (isHelpRequest) {
            const stats = getCategoryStats(products);
            
            let answer = `**В нашем каталоге сейчас в наличии:**\n\n`;
            
            for (const [cat, data] of Object.entries(stats)) {
                if (data.count > 0) {
                    answer += `✅ **${cat}**: ${data.count} товаров\n`;
                    if (data.examples.length > 0) {
                        answer += `   Например: ${data.examples.join(', ')}\n`;
                    }
                }
            }
            
            answer += `\n📦 Также в наличии более 1000 различных комплектующих.\n\n`;
            answer += `Что именно вас интересует? Я помогу подобрать!`;
            
            session.messages.push({ role: 'user', content: question });
            session.messages.push({ role: 'assistant', content: answer });
            
            return res.status(200).json({ answer });
        }
        
        // 6️⃣ ВСЕ ОСТАЛЬНЫЕ ЗАПРОСЫ — ИСПОЛЬЗУЕМ AI КАК КОНСУЛЬТАНТА
        console.log('🔍 КОНСУЛЬТАНТ (запрос):', question);
        
        // Берём ВСЕ товары в наличии (без ограничения)
        const inStockProducts = products.filter(p => p.price > 0 && p.quantity > 0);
        console.log('🔍 ВСЕГО ТОВАРОВ В НАЛИЧИИ:', inStockProducts.length);
        
        // Для больших каталогов показываем только первые 200, чтобы не превысить лимит токенов
        const productsForAI = inStockProducts.slice(0, 200);
        console.log('🔍 ТОВАРОВ ПЕРЕДАНО AI:', productsForAI.length);
        
        const catalogContext = productsForAI.map(p => 
            `- ${p.name} | Цена: ${p.price} руб. | В наличии: ${p.quantity} шт.`
        ).join('\n');
        
        // Добавляем историю диалога (последние 6 сообщений)
        const recentMessages = session.messages.slice(-6);
        
        if (!OPENROUTER_API_KEY) {
            const answer =
                'Консультант временно недоступен: не настроен API-ключ ИИ (OPENROUTER_API_KEY). Обратитесь к администратору сайта.';
            session.messages.push({ role: 'user', content: question });
            session.messages.push({ role: 'assistant', content: answer });
            return res.status(200).json({ answer });
        }

        try {
            const aiResponse = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'HTTP-Referer': SITE_URL
                },
                body: JSON.stringify({
                    model: 'openrouter/free',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...recentMessages,
                        { role: 'user', content: `Вот наш каталог товаров в наличии (первые 200 позиций из ${inStockProducts.length}):\n\n${catalogContext}\n\nКлиент спрашивает: "${question}"\n\nПосмотри внимательно, есть ли подходящие товары. Если есть — перечисли их с ценами. Если нет — скажи честно и предложи варианты под заказ.` }
                    ],
                    temperature: 0.5,
                    max_tokens: 1000
                })
            });
            
            if (aiResponse.ok) {
                const aiData = await aiResponse.json();
                let answer = aiData.choices?.[0]?.message?.content;
                
                // Если ответ пустой или слишком короткий
                if (!answer || answer.length < 10) {
                    const randomProducts = getRandomProducts(products, 3);
                    answer = `**По вашему запросу ничего не найдено в текущей выборке.**\n\n` +
                        `Возможно, вас заинтересуют эти товары в наличии:\n\n` +
                        randomProducts.map(p => 
                            `- **${p.name}**\n  💰 ${p.price} руб. (📦 ${p.quantity} шт.)`
                        ).join('\n\n') +
                        `\n\nИли уточните запрос и попробуйте снова.`;
                }
                
                session.messages.push({ role: 'user', content: question });
                session.messages.push({ role: 'assistant', content: answer });
                
                if (session.messages.length > 20) {
                    session.messages = session.messages.slice(-20);
                }
                
                return res.status(200).json({ answer });
            } else {
                throw new Error(`OpenRouter error: ${aiResponse.status}`);
            }
        } catch (error) {
            console.error('OpenRouter error:', error);
            
            // Резервный ответ
            const randomProducts = getRandomProducts(products, 3);
            const answer = `**По вашему запросу ничего не найдено.**\n\n` +
                `Возможно, вас заинтересуют эти товары в наличии:\n\n` +
                randomProducts.map(p => 
                    `- **${p.name}**\n  💰 ${p.price} руб. (📦 ${p.quantity} шт.)`
                ).join('\n\n') +
                `\n\nИли уточните запрос и попробуйте снова.`;
            
            session.messages.push({ role: 'user', content: question });
            session.messages.push({ role: 'assistant', content: answer });
            
            if (session.messages.length > 20) {
                session.messages = session.messages.slice(-20);
            }
            
            return res.status(200).json({ answer });
        }

    } catch (error) {
        console.error('Ошибка:', error);
        res.status(500).json({ answer: 'Ошибка, попробуйте позже.' });
    }
}