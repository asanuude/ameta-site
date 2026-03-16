export default function handler(req, res) {
    // Разрешаем и GET, и POST для проверки
    if (req.method === 'GET' || req.method === 'POST') {
        return res.status(200).json({ 
            status: 'ok', 
            message: 'Connection successful' 
        });
    }
    
    return res.status(405).json({ error: 'Method not allowed' });
}