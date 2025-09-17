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
const CLIENT_ID = process.env.AMOCRM_CLIENT_ID || 'd30b21ee-878a-4fe4-9434-ccc2a12b22fd';
const CLIENT_SECRET = process.env.AMOCRM_CLIENT_SECRET || '0pz2EXM02oankmHtCaZOgFa3rESLXT6F282gVIozREZLHuuYzVyNAFtyYDXMNd2u';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://fioparser.onrender.com/oauth/callback';
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN || 'insain0';

// Хранилище токенов
let tokens = null;
let lastCheckTime = new Date(Date.now() - 5 * 60 * 1000); // 5 минут назад

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Middleware для логирования
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
});

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

// Страница авторизации
app.get('/auth', (req, res) => {
    const authUrl = `https://www.amocrm.ru/oauth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=fioparser`;
    res.redirect(authUrl);
});

// Callback обработчик
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

        console.log('✅ OAuth authorization successful');
        
        // Запускаем периодическую проверку после авторизации
        startPeriodicCheck();
        
        res.send('✅ Авторизация успешна! Автопарсинг запущен. Вы можете закрыть эту вкладку.');

    } catch (error) {
        console.error('❌ OAuth error:', error.response?.data || error.message);
        res.status(500).send('❌ Ошибка авторизации: ' + (error.response?.data?.message || error.message));
    }
});

// Обновление токена
async function refreshToken() {
    try {
        if (!tokens?.refresh_token) {
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

        console.log('✅ Token refreshed successfully');
        return true;

    } catch (error) {
        console.error('❌ Token refresh error:', error.response?.data || error.message);
        return false;
    }
}

// Проверка и получение валидного токена
async function getValidToken() {
    if (!tokens?.access_token) {
        console.log('❌ No access token available');
        return null;
    }

    // Если токен истек или скоро истечет - обновляем
    if (Date.now() >= tokens.expires_at - 300000) {
        console.log('🔄 Token expired or about to expire, refreshing...');
        const success = await refreshToken();
        if (!success) return null;
    }
    
    return tokens.access_token;
}

// Получение последних контактов
async function getRecentContacts() {
    try {
        const accessToken = await getValidToken();
        if (!accessToken) {
            console.log('❌ No valid token for getting contacts');
            return [];
        }

        console.log('🕐 Last check time:', lastCheckTime.toISOString());
        
        const response = await axios.get(
            `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts?order[created_at]=desc&limit=50`,
            {
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        if (!response.data._embedded || !response.data._embedded.contacts) {
            console.log('❌ No contacts found in response');
            return [];
        }

        const newContacts = response.data._embedded.contacts.filter(contact => {
            if (!contact.created_at) return false;
            
            // amoCRM возвращает timestamp в секундах!
            const contactTime = new Date(contact.created_at * 1000);
            const isNew = contactTime > lastCheckTime;
            
            if (isNew) {
                console.log('🎯 New contact found:', contact.name, 'ID:', contact.id, 'at', contactTime.toISOString());
            }
            
            return isNew;
        });

        console.log(`📊 Found ${newContacts.length} new contacts`);
        return newContacts;

    } catch (error) {
        console.error('❌ Get contacts error:', error.response?.data || error.message);
        return [];
    }
}

// Обработка контакта
async function processContact(contact) {
    try {
        console.log('\n=== PROCESSING CONTACT ===');
        console.log('Contact ID:', contact.id);
        console.log('Original name:', contact.name);
        
        if (!contact.name || contact.name.trim().length < 2) {
            console.log('❌ Skip: No valid name');
            return;
        }

        const parsed = parseFIO(contact.name);
        console.log('Parsed result:', parsed);

        // Проверяем, нужно ли вообще обновлять
        const needsUpdate = parsed.lastName || parsed.firstName;
        if (!needsUpdate) {
            console.log('⚠️ Skip: Nothing to update');
            return;
        }

        // Обновляем контакт
        const success = await updateContactInAmoCRM(contact.id, parsed);
        
        if (success) {
            console.log('✅ Contact updated successfully');
        } else {
            console.log('❌ Failed to update contact');
        }

    } catch (error) {
        console.error('💥 Process contact error:', error.message);
    }
}

// Обновление контакта в amoCRM
async function updateContactInAmoCRM(contactId, parsedData) {
    try {
        const accessToken = await getValidToken();
        if (!accessToken) {
            console.log('❌ No valid token for update');
            return false;
        }

        const updateData = {
            first_name: parsedData.firstName || '',
            last_name: parsedData.lastName || ''
        };

        console.log('Updating contact with:', updateData);

        const response = await axios.patch(
            `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts/${contactId}`,
            updateData,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        console.log('✅ Update response status:', response.status);
        return response.status === 200;

    } catch (error) {
        if (error.response) {
            console.error('❌ API Error:', error.response.status);
            console.error('❌ API Response:', error.response.data);
        } else {
            console.error('❌ Network Error:', error.message);
        }
        return false;
    }
}

// Периодическая проверка новых контактов
function startPeriodicCheck() {
    console.log('🚀 Starting periodic contact check every 30 seconds');
    
    setInterval(async () => {
        try {
            if (!tokens) {
                console.log('⏳ Waiting for authorization...');
                return;
            }

            console.log('\n🔍 === STARTING PERIODIC CHECK ===');
            console.log('🕐 Last check was:', lastCheckTime.toISOString());
            
            const contacts = await getRecentContacts();
            console.log(`📋 Found ${contacts.length} contacts to process`);
            
            for (const contact of contacts) {
                await processContact(contact);
            }

            lastCheckTime = new Date();
            console.log('✅ Check completed. New last check time:', lastCheckTime.toISOString());

        } catch (error) {
            console.error('💥 Periodic check error:', error.message);
        }
    }, 30000);
}

// Статус авторизации
app.get('/status', (req, res) => {
    const isAuthorized = !!tokens?.access_token;
    const expiresIn = tokens?.expires_at ? Math.round((tokens.expires_at - Date.now()) / 60000) : 0;
    
    res.json({
        authorized: isAuthorized,
        expires_in_minutes: expiresIn,
        domain: AMOCRM_DOMAIN,
        last_check: lastCheckTime.toISOString()
    });
});

// Главная страница
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>FIOParser Auto</title>
            <style>
                body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 20px; }
                .status { padding: 10px; border-radius: 5px; margin: 10px 0; }
                .success { background: #d4edda; color: #155724; }
                .error { background: #f8d7da; color: #721c24; }
                .btn { background: #1565c0; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block; margin: 10px 0; }
            </style>
        </head>
        <body>
            <h1>🔍 FIOParser Auto</h1>
            <div id="status"></div>
            <a href="/auth" class="btn">🔑 Авторизовать в amoCRM</a><br>
            <a href="/status" class="btn">📊 Проверить статус</a>
            
            <script>
                fetch('/status')
                    .then(response => response.json())
                    .then(data => {
                        const statusDiv = document.getElementById('status');
                        statusDiv.className = \\`status \\${data.authorized ? 'success' : 'error'}\\`;
                        statusDiv.innerHTML = data.authorized ? 
                            \\`✅ Авторизация активна (истекает через \\${data.expires_in_minutes} мин.)\\` : 
                            \\`❌ Требуется авторизация\\`;
                    })
                    .catch(error => console.error('Status check failed:', error));
            </script>
        </body>
        </html>
    `);
});

// Обработка вебхуков (на будущее)
app.post('/webhook/contact', async (req, res) => {
    try {
        console.log('📩 Webhook received:', JSON.stringify(req.body, null, 2));
        res.json({ success: true, message: 'Webhook received' });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 FIOParser Auto server running on port ${PORT}`);
    console.log(`🔑 Auth URL: https://fioparser.onrender.com/auth`);
    console.log(`📊 Status: https://fioparser.onrender.com/status`);
    
    if (tokens) {
        console.log('✅ Already authorized, starting periodic check...');
        startPeriodicCheck();
    }
});
