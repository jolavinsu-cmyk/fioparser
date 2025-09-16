import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3000;

// Конфигурация OAuth (замените на свои данные)
const CLIENT_ID = process.env.AMOCRM_CLIENT_ID || 'd30b21ee-878a-4fe4-9434-ccc2a12b22fd';
const CLIENT_SECRET = process.env.AMOCRM_CLIENT_SECRET || '0pz2EXM02oankmHtCaZOgFa3rESLXT6F282gVIozREZLHuuYzVyNAFtyYDXMNd2u';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://fioparser.onrender.com/oauth/callback';
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN || 'insain0';

// Хранилище
let tokens = null;
let lastCheckTime = new Date();

app.use(cors());
app.use(express.json());

// Функция парсинга ФИО (оставляем как было)
function parseFIO(fullName) {
    const parts = fullName.trim().split(/\s+/).filter(part => part.length > 0);
    let lastName = '', firstName = '', middleName = '';

    if (parts.length === 1) lastName = parts[0];
    else if (parts.length === 2) { lastName = parts[0]; firstName = parts[1]; }
    else if (parts.length >= 3) { lastName = parts[0]; firstName = parts[1]; middleName = parts.slice(2).join(' '); }

    return { lastName, firstName, middleName };
}

// Авторизация (оставляем как было)
app.get('/auth', (req, res) => {
    const authUrl = `https://www.amocrm.ru/oauth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    res.redirect(authUrl);
});

app.get('/oauth/callback', async (req, res) => {
    try {
        const { code } = req.query;
        const tokenResponse = await axios.post(`https://${AMOCRM_DOMAIN}.amocrm.ru/oauth2/access_token`, {
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI
        });

        tokens = {
            access_token: tokenResponse.data.access_token,
            refresh_token: tokenResponse.data.refresh_token,
            expires_at: Date.now() + (tokenResponse.data.expires_in * 1000)
        };

        // Запускаем периодическую проверку после авторизации
        startPeriodicCheck();
        
        res.send('Авторизация успешна! Автопарсинг запущен.');
    } catch (error) {
        console.error('OAuth error:', error.response?.data);
        res.status(500).send('Ошибка авторизации');
    }
});

// Периодическая проверка новых контактов
async function startPeriodicCheck() {
    setInterval(async () => {
        try {
            if (!tokens) return;

            console.log('🔍 Проверяем новые контакты...');
            
            const contacts = await getRecentContacts();
            for (const contact of contacts) {
                await processContact(contact);
            }

            lastCheckTime = new Date();
            
        } catch (error) {
            console.error('Periodic check error:', error.message);
        }
    }, 30000); // Проверяем каждые 30 секунд
}

// Получение последних контактов
async function getRecentContacts() {
    try {
        const response = await axios.get(
            `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts?order[created_at]=desc&limit=20`,
            {
                headers: { 'Authorization': `Bearer ${tokens.access_token}` }
            }
        );

        return response.data._embedded.contacts.filter(contact => {
            const contactTime = new Date(contact.created_at * 1000);
            return contactTime > lastCheckTime;
        });

    } catch (error) {
        console.error('Get contacts error:', error.response?.data);
        return [];
    }
}

// Обработка контакта
async function processContact(contact) {
    try {
        if (!contact.name) return;

        console.log('Обрабатываем контакт:', contact.name);
        
        const parsed = parseFIO(contact.name);
        console.log('Результат парсинга:', parsed);

        // Обновляем контакт
        await updateContactInAmoCRM(contact.id, parsed);
        console.log('✅ Контакт обновлен');

    } catch (error) {
        console.error('Process contact error:', error.message);
    }
}

// Обновление контакта
async function updateContactInAmoCRM(contactId, parsedData) {
    try {
        const updateData = {
            first_name: parsedData.firstName || '',
            last_name: parsedData.lastName || ''
        };

        const response = await axios.patch(
            `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts/${contactId}`,
            updateData,
            {
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.status === 200;
    } catch (error) {
        console.error('Update contact error:', error.response?.data);
        return false;
    }
}

// Статус
app.get('/status', (req, res) => {
    res.json({
        authorized: !!tokens,
        last_check: lastCheckTime.toISOString(),
        domain: AMOCRM_DOMAIN
    });
});

app.get('/', (req, res) => {
    res.send(`
        <h1>FIOParser Auto</h1>
        <p>Статус: ${tokens ? 'Авторизован' : 'Не авторизован'}</p>
        <a href="/auth">Авторизовать</a> | 
        <a href="/status">Статус</a>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
