import fs from 'fs';
import path from 'path';
import { parseString } from 'xml2js';

// Секретный ключ для Bearer-авторизации (тот же, что в 1С)
const UPDATE_SECRET = '0011524AaSs!!!';

export default async function handler(req, res) {
    // Разрешаем только POST-запросы
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Проверяем авторизацию (Basic Auth)
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const base64Credentials = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
        const [username, password] = credentials.split(':');

        if (username !== 'admin' || password !== UPDATE_SECRET) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Получаем файлы из form-data
        const files = [];
        for (const key in req.body) {
            if (req.body[key] && req.body[key].name && req.body[key].data) {
                files.push({
                    name: req.body[key].name,
                    content: req.body[key].data.toString('utf8')
                });
            }
        }

        if (files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        // Парсим и объединяем все товары
        let allProducts = [];
        let allOffers = [];

        for (const file of files) {
            if (file.name.startsWith('import')) {
                const parsed = await parseXMLString(file.content);
                const products = parsed?.КоммерческаяИнформация?.Каталог?.[0]?.Товары?.[0]?.Товар || [];
                allProducts = [...allProducts, ...products];
            }
            if (file.name.startsWith('offers')) {
                const parsed = await parseXMLString(file.content);
                const offers = parsed?.КоммерческаяИнформация?.ПакетПредложений?.[0]?.Предложения?.[0]?.Предложение || [];
                allOffers = [...allOffers, ...offers];
            }
        }

        // Формируем готовый каталог
        const catalog = allProducts.map(product => {
            const offer = allOffers.find(o => o.Ид?.[0] === product.Ид?.[0]);
            
            let totalQuantity = 0;
            if (offer?.Склад) {
                offer.Склад.forEach(sklad => {
                    totalQuantity += Number(sklad.$.КоличествоНаСкладе || 0);
                });
            }

            return {
                id: product.Ид?.[0],
                name: product.Наименование?.[0]?.trim() || '',
                description: product.Описание?.[0] || '',
                price: offer?.Цены?.[0]?.Цена?.[0]?.ЦенаЗаЕдиницу?.[0] || 'Цена не указана',
                quantity: totalQuantity,
                sku: product.ЗначенияРеквизитов?.[0]?.ЗначениеРеквизита?.find(
                    r => r.Наименование?.[0] === 'Код'
                )?.Значение?.[0]?.trim() || ''
            };
        });

        // Сохраняем каталог в папку data (доступно для ask.js)
        const projectCatalogPath = path.join(process.cwd(), 'data', 'catalog.json');
        if (!fs.existsSync(path.join(process.cwd(), 'data'))) {
            fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
        }
        fs.writeFileSync(projectCatalogPath, JSON.stringify(catalog, null, 2));

        return res.status(200).json({ 
            success: true, 
            productsCount: catalog.length 
        });

    } catch (error) {
        console.error('Update error:', error);
        return res.status(500).json({ error: error.message });
    }
}

// Вспомогательная функция для парсинга XML
async function parseXMLString(xmlString) {
    return new Promise((resolve, reject) => {
        parseString(xmlString, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}