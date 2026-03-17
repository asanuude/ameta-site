import { parseString } from 'xml2js';

export default async function handler(req, res) {
    // Разрешаем CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Только POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { question } = req.body;
        
        // Настройки GitHub
        const GITHUB_OWNER = 'asanuude';
        const GITHUB_REPO = '1c-data';
        const GITHUB_BRANCH = 'main';
        const GITHUB_TOKEN = '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';
        
        const files = [
            'import0_1.xml',
            'import1_1.xml',
            'import2_1.xml',
            'offers0_1.xml',
            'offers1_1.xml',
            'offers2_1.xml'
        ];
        
        // Функция для парсинга XML
        function parseXMLString(xmlString) {
            return new Promise((resolve, reject) => {
                parseString(xmlString, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });
        }
        
        let allProducts = [];
        let allOffers = [];
        let errors = [];
        
        for (const file of files) {
            try {
                const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${file}`;
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`
                    }
                });
                
                if (!response.ok) {
                    errors.push(`${file}: HTTP ${response.status}`);
                    continue;
                }
                
                const xmlText = await response.text();
                const parsed = await parseXMLString(xmlText);
                
                if (file.startsWith('import')) {
                    const products = parsed?.КоммерческаяИнформация?.Каталог?.[0]?.Товары?.[0]?.Товар || [];
                    allProducts = [...allProducts, ...products];
                } else if (file.startsWith('offers')) {
                    const offers = parsed?.КоммерческаяИнформация?.ПакетПредложений?.[0]?.Предложения?.[0]?.Предложение || [];
                    allOffers = [...allOffers, ...offers];
                }
                
            } catch (e) {
                errors.push(`${file}: ${e.message}`);
            }
        }
        
        // Формируем каталог товаров
        const catalog = allProducts.map(product => {
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
            
            // Получаем артикул
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
        
        // Возвращаем статистику
        return res.status(200).json({ 
            answer: `Загружено товаров: ${catalog.length}`,
            products: catalog.slice(0, 3), // покажем первые 3 для проверки
            errors: errors.length ? errors : 'нет ошибок',
            question: question
        });
        
    } catch (error) {
        return res.status(500).json({ 
            error: error.message,
            answer: 'Извините, произошла внутренняя ошибка'
        });
    }
}