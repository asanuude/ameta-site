export default async function handler(req, res) {
    // Разрешаем CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Только POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { question } = req.body;
        
        // 1. Загружаем данные с GitHub
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
        
        let loadedFiles = 0;
        let errors = [];
        
        for (const file of files) {
            try {
                const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${file}`;
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `token ${GITHUB_TOKEN}`
                    }
                });
                
                if (response.ok) {
                    loadedFiles++;
                } else {
                    errors.push(`${file}: ${response.status}`);
                }
            } catch (e) {
                errors.push(`${file}: ${e.message}`);
            }
        }
        
        // Возвращаем отчёт о загрузке
        return res.status(200).json({ 
            answer: `Загружено файлов: ${loadedFiles} из ${files.length}`,
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