// api/ask.js — финальная версия с каталогом из 1С

const OPENROUTER_API_KEY = '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';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SITE_URL = 'https://ameta.online';

// GitHub — ваш репозиторий с данными
const CATALOG_URL = 'https://raw.githubusercontent.com/asanuude/1c-data/main/catalog.json';

// Кэш для каталога
let catalog = null;
let lastFetch = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 минут

async function loadCatalog() {
    const now = Date.now();
    if (catalog && now - lastFetch < CACHE_TTL) return catalog;
    
    try {
        const response = await fetch(CATALOG_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        catalog = await response.json();
        lastFetch = now;
        console.log(`Загружено ${catalog.length} товаров`);
        return catalog;
    } catch (error) {
        console.error('Ошибка загрузки каталога:', error);
        return catalog || [];
    }
}

// ... остальной код (поиск и отправка в OpenRouter)