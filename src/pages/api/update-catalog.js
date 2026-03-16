export const prerender = false;
import fs from 'fs';
import path from 'path';
import { parseString } from 'xml2js';

// Секретный ключ для Bearer-авторизации
const UPDATE_SECRET = '0011524AaSs!!!';

export async function POST({ request }) {
    try {
        // Проверяем авторизацию (поддерживаем оба варианта)
        const authHeader = request.headers.get('Authorization');
        const basicAuth = authHeader?.startsWith('Basic ');
        let authorized = false;

        // Если есть Basic Auth, проверяем логин/пароль
        if (basicAuth) {
            const base64Credentials = authHeader.split(' ')[1];
            const credentials = atob(base64Credentials);
            const [username, password] = credentials.split(':');
            
            if (username === 'admin' && password === UPDATE_SECRET) {
                authorized = true;
            }
        } 
        // Если есть Bearer token, проверяем его
        else if (authHeader === `Bearer ${UPDATE_SECRET}`) {
            authorized = true;
        }

        if (!authorized) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Получаем данные из 1С
        const formData = await request.formData();
        const files = [];
        
        // Собираем все загруженные файлы
        for (const [key, value] of formData.entries()) {
            if (value instanceof File) {
                files.push({
                    name: value.name,
                    content: await value.text()
                });
            }
        }

        if (files.length === 0) {
            return new Response(JSON.stringify({ error: 'No files uploaded' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
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
            
            // Считаем общее количество по всем складам
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

        // Сохраняем готовый каталог в JSON
        const catalogPath = path.join('/tmp', 'catalog.json');
        fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));

        // Также сохраняем копию в папку проекта (на всякий случай)
        const projectCatalogPath = path.join(process.cwd(), 'data', 'catalog.json');
        if (!fs.existsSync(path.join(process.cwd(), 'data'))) {
            fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
        }
        fs.writeFileSync(projectCatalogPath, JSON.stringify(catalog, null, 2));

        return new Response(JSON.stringify({ 
            success: true, 
            productsCount: catalog.length 
        }), { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Update error:', error);
        return new Response(JSON.stringify({ 
            error: error.message 
        }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
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