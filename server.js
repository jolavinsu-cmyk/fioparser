import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Конфигурация OAuth (замените на свои данные)
const CLIENT_ID = process.env.AMOCRM_CLIENT_ID || 'your_client_id';
const CLIENT_SECRET = process.env.AMOCRM_CLIENT_SECRET || 'your_client_secret';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://fioparser.onrender.com/oauth/callback';
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN || 'yourdomain';

// Хранилище токенов (в продакшене используйте БД)
let tokens = {
    access_token: null,
    refresh_token: null,
    expires_at: null
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Функция парсинга ФИО
function parseFIO(fullName) {
    const parts = fullName.trim().split(/\s+/).filter(part => part.length > 0);
    
    let lastName = '';
    let firstName = '';
    let middleName = '';

    if (parts.length === 1) {
        lastName = parts[0];
    } else if (parts.length === 2) {
        lastName = parts[0];
        firstName = parts[1];
    } else if (parts.length >= 3) {
        lastName = parts[0];
        firstName = parts[1];
        middleName = parts.slice(2).join(' ');
    }

    return { lastName, firstName, middleName };
}

// 1. Страница авторизации
app.get('/auth', (req, res) => {
    const authUrl = `https://www.amocrm.ru/oauth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=some_random_string`;
    res.redirect(authUrl);
});

// 2. Callback обработчик
app.get('/oauth/callback', async (req, res) => {
    try {
        const { code } = req.query;
        
        if (!code) {
            return res.status(400).send('No authorization code received');
        }

        // Получаем токены
        const tokenResponse = await axios.post(`https://${AMOCRM_DOMAIN}.amocrm.ru/oauth2/access_token`, {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI
        });

        // Сохраняем токены
        tokens = {
            access_token: tokenResponse.data.access_token,
            refresh_token: tokenResponse.data.refresh_token,
            expires_at: Date.now() + (tokenResponse.data.expires_in * 1000)
        };

        console.log('OAuth authorization successful');
        res.send('Авторизация успешна! Вы можете закрыть эту вкладку.');

    } catch (error) {
        console.error('OAuth error:', error.response?.data || error.message);
        res.status(500).send('Ошибка авторизации');
    }
});

// 3. Обновление токена
async function refreshToken() {
    try {
        if (!tokens.refresh_token) {
            throw new Error('No refresh token available');
        }

        const response = await axios.post(`https://${AMOCRM_DOMAIN}.amocrm.ru/oauth2/access_token`, {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            redirect_uri: REDIRECT_URI
        });

        tokens = {
            access_token: response.data.access_token,
            refresh_token: response.data.refresh_token,
            expires_at: Date.now() + (response.data.expires_in * 1000)
        };

        console.log('Token refreshed successfully');
        return true;

    } catch (error) {
        console.error('Token refresh error:', error.response?.data || error.message);
        return false;
    }
}

// 4. Проверка и получение валидного токена
async function getValidToken() {
    // Если токен истек или скоро истечет - обновляем
    if (!tokens.access_token || Date.now() >= tokens.expires_at - 300000) { // 5 минут до expiry
        console.log('Token expired or about to expire, refreshing...');
        await refreshToken();
    }
    return tokens.access_token;
}

// 5. Вебхук для обработки контактов
app.post('/webhook/contact', async (req, res) => {
    try {
        const { contact, account } = req.body;
        
        if (!contact || !contact.name) {
            return res.status(400).json({ error: 'No contact data' });
        }

        console.log('Processing contact:', contact.name);

        // Парсим ФИО
        const parsed = parseFIO(contact.name);
        
        // Обновляем контакт в amoCRM
        const success = await updateContactInAmoCRM(contact.id, parsed);
        
        if (success) {
            console.log('Contact updated successfully:', contact.id);
            res.json({ success: true, parsed });
        } else {
            res.status(500).json({ error: 'Failed to update contact' });
        }

    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 6. Функция обновления контакта
async function updateContactInAmoCRM(contactId, parsedData) {
    try {
        const accessToken = await getValidToken();
        
        if (!accessToken) {
            throw new Error('No valid access token');
        }

        const updateData = {
            first_name: parsedData.firstName || '',
            last_name: parsedData.lastName || ''
        };

        // Если есть отчество, добавляем в custom fields
        if (parsedData.middleName) {
            updateData.custom_fields_values = [
                {
                    field_code: 'PATRONYMIC', // или field_id: 123456
                    values: [{ value: parsedData.middleName }]
                }
            ];
        }

        const response = await axios.patch(
            `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts/${contactId}`,
            updateData,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        return response.status === 200;

    } catch (error) {
        console.error('API update error:', error.response?.data || error.message);
        return false;
    }
}

// 7. Статус авторизации
app.get('/status', (req, res) => {
    const isAuthorized = !!tokens.access_token;
    const expiresIn = tokens.expires_at ? Math.round((tokens.expires_at - Date.now()) / 60000) : 0;
    
    res.json({
        authorized: isAuthorized,
        expires_in_minutes: expiresIn,
        domain: AMOCRM_DOMAIN
    });
});

// 8. Главная страница с инструкцией
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Auto-parser server running on port ${PORT}`);
    console.log(`🔑 Auth URL: https://fioparser.onrender.com/auth`);
    console.log(`📊 Status: https://fioparser.onrender.com/status`);
});
