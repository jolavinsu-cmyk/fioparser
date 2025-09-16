import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Функция парсинга ФИО
function parseFIO(fullName) {
    const parts = fullName.trim().split(/\s+/).filter(part => part.length > 0);
    
    let lastName = '';
    let firstName = '';
    let middleName = '';

    if (parts.length === 1) {
        // Только фамилия
        lastName = parts[0];
    } else if (parts.length === 2) {
        // Фамилия и имя
        lastName = parts[0];
        firstName = parts[1];
    } else if (parts.length >= 3) {
        // Фамилия, имя и отчество
        lastName = parts[0];
        firstName = parts[1];
        middleName = parts.slice(2).join(' ');
    }

    return { lastName, firstName, middleName };
}

// Routes
app.get('/', (req, res) => {
    res.send('FIOParser Server is running!');
});

app.get('/widget.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'widget.js'));
});

app.post('/api/parse', (req, res) => {
    try {
        const { fullName } = req.body;
        
        if (!fullName || typeof fullName !== 'string') {
            return res.status(400).json({ error: 'Full name is required' });
        }

        const parsed = parseFIO(fullName);
        res.json({
            success: true,
            data: parsed
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📋 Widget: https://fioparser.onrender.com/widget.html`);
});
