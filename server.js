import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3000;
let lastCheckTime = new Date(Date.now() - 5 * 60 * 1000); // 5 минут назад

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

            lastCheckTime = new Date(); // ОБНОВЛЯЕМ ВРЕМЯ ПОСЛЕ ПРОВЕРКИ
            console.log('✅ Check completed. New last check time:', lastCheckTime.toISOString());

        } catch (error) {
            console.error('💥 Periodic check error:', error.message);
        }
    }, 30000);
}

// Получение последних контактов (ИСПРАВЛЕННАЯ ВЕРСИЯ)
async function getRecentContacts() {
    try {
        console.log('🕐 Last check time:', lastCheckTime.toISOString());
        
        const response = await axios.get(
            `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts?order[created_at]=desc&limit=50`,
            {
                headers: { 
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.data._embedded || !response.data._embedded.contacts) {
            console.log('❌ No contacts found in response');
            return [];
        }

        const newContacts = response.data._embedded.contacts.filter(contact => {
            if (!contact.created_at) return false;
            
            // amoCRM возвращает timestamp в секундах, а не миллисекундах!
            const contactTime = new Date(contact.created_at * 1000);
            const isNew = contactTime > lastCheckTime;
            
            if (isNew) {
                console.log('🎯 New contact found:', contact.name, 'at', contactTime.toISOString());
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
// Обработка контакта (С УЛУЧШЕННЫМ ЛОГИРОВАНИЕМ)
async function processContact(contact) {
    try {
        console.log('=== PROCESSING CONTACT ===');
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

// Обновление контакта (С УЛУЧШЕННОЙ ОБРАБОТКОЙ ОШИБОК)
async function updateContactInAmoCRM(contactId, parsedData) {
    try {
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
                    'Authorization': `Bearer ${tokens.access_token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 10000
            }
        );

        console.log('Update response status:', response.status);
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

