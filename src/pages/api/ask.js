export const prerender = false;
import fs from 'fs';
import path from 'path';

let catalog = [];
let lastLoad = 0;
const CACHE_TTL = 60000; // 60 секунд

// Функция загрузки каталога
function loadCatalog() {
    const now = Date.now();
    if (now - lastLoad < CACHE_TTL && catalog.length > 0) {
        return catalog;
    }

    try {
        // Сначала пробуем из /tmp (самые свежие)
        const tmpPath = path.join('/tmp', 'catalog.json');
        if (fs.existsSync(tmpPath)) {
            catalog = JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
        } else {
            // Если нет, берём из проекта
            const projectPath = path.join(process.cwd(), 'data', 'catalog.json');
            if (fs.existsSync(projectPath)) {
                catalog = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
            }
        }
        lastLoad = now;
        console.log(`Loaded ${catalog.length} products`);
    } catch (error) {
        console.error('Error loading catalog:', error);
    }
    return catalog;
}

// Улучшенный поиск с синонимами
function searchProducts(query, products) {
    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(' ').filter(w => w.length > 1);
    
    // Расширяем запрос синонимами
    const searchTerms = new Set(words);
    
    words.forEach(word => {
        if (word.includes('касс') || word.includes('ккм')) {
            searchTerms.add('ккм'); searchTerms.add('фр'); 
            searchTerms.add('фискальный'); searchTerms.add('регистратор');
        }
        if (word.includes('вес')) {
            searchTerms.add('весы'); searchTerms.add('вэт'); 
            searchTerms.add('вр'); searchTerms.add('мк');
        }
        if (word.includes('принтер') || word.includes('печат')) {
            searchTerms.add('принтер'); searchTerms.add('фр');
            searchTerms.add('fprint'); searchTerms.add('печати');
        }
        if (word.includes('комп') || word.includes('pos')) {
            searchTerms.add('pos'); searchTerms.add('компьютер');
            searchTerms.add('моноблок'); searchTerms.add('терминал');
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

export async function POST({ request }) {
    try {
        const { question } = await request.json();
        const products = loadCatalog();
        
        // Специальная обработка приветствия
        if (question.toLowerCase().includes('привет')) {
            const categories = [
                'POS-системы', 'весы', 'кассовые аппараты (ККМ)', 
                'терминалы', 'комплектующие'
            ];
            return new Response(JSON.stringify({ 
                answer: `Здравствуйте! Я AI-консультант. Могу помочь с подбором товаров.\n\nВ нашем каталоге есть: ${categories.join(', ')}.\nЧто именно вас интересует?`
            }), { status: 200 });
        }

        const results = searchProducts(question, products);

        let answer = '';
        if (results.length === 0) {
            answer = 'Извините, не нашёл таких товаров. Попробуйте спросить иначе или уточните категорию (POS-системы, весы, ККМ).';
        } else if (results.length === 1) {
            const p = results[0];
            answer = `${p.name}\n💰 Цена: ${p.price} руб.\n📦 Наличие: ${p.quantity > 0 ? 'есть' : 'нет'} на складе\n📝 ${p.description || 'Описание отсутствует'}`;
        } else {
            answer = 'Нашёл несколько вариантов:\n\n' + 
                results.slice(0, 5).map((p, i) => 
                    `${i+1}. ${p.name} — ${p.price} руб. (${p.quantity > 0 ? 'в наличии' : 'под заказ'})`
                ).join('\n') + 
                '\n\nУточните, какой именно товар вас интересует?';
        }

        return new Response(JSON.stringify({ answer }), { status: 200 });
    } catch (error) {
        return new Response(JSON.stringify({ 
            answer: 'Извините, произошла ошибка. Попробуйте ещё раз.' 
        }), { status: 200 });
    }
}