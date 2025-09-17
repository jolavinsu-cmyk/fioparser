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
let lastCheckTime = new Date(Date.now() - 5 * 60 * 1000); // 5 минут назад

app.use(cors());
app.use(express.json());

// Функция парсинга ФИО (оставляем как было)
function parseFIO(fullName) {
    const parts = fullName.trim().split(/\s+/).filter(part => part.length > 0);
    
    // Русские фамильные окончания
    const surnameEndings = ['ов', 'ев', 'ин', 'ын', 'ский', 'цкий', 'ой', 'ая', 'яя', 'ич', 'ова', 'ева', 'ина', 'ына'];
    
    let lastName = '';
    let firstName = '';
    let middleName = '';

    if (parts.length === 1) {
        // Только одно слово - считаем фамилией
        lastName = parts[0];
    } else if (parts.length === 2) {
        // Два слова: определяем где фамилия по окончанию
        const firstIsSurname = surnameEndings.some(ending => parts[0].toLowerCase().endsWith(ending));
        const secondIsSurname = surnameEndings.some(ending => parts[1].toLowerCase().endsWith(ending));
        
        if (secondIsSurname && !firstIsSurname) {
            // Второе слово похоже на фамилию, первое - на имя
            firstName = parts[0];
            lastName = parts[1];
        } else if (firstIsSurname && !secondIsSurname) {
            // Первое слово похоже на фамилию, второе - на имя
            lastName = parts[0];
            firstName = parts[1];
        } else {
            // Непонятно - используем стандартное правило: первое имя, второе фамилия
            firstName = parts[0];
            lastName = parts[1];
        }
    } else if (parts.length >= 3) {
        // Три и более слов: ищем фамилию по окончаниям
        let surnameIndex = -1;
        
        // Сначала проверяем последнее слово (чаще всего фамилия в конце)
        if (surnameEndings.some(ending => parts[parts.length - 1].toLowerCase().endsWith(ending))) {
            surnameIndex = parts.length - 1;
        }
        // Если последнее не похоже на фамилию, проверяем первое
        else if (surnameEndings.some(ending => parts[0].toLowerCase().endsWith(ending))) {
            surnameIndex = 0;
        }
        // Если и первое не похоже, проверяем все слова
        else {
            for (let i = 0; i < parts.length; i++) {
                if (surnameEndings.some(ending => parts[i].toLowerCase().endsWith(ending))) {
                    surnameIndex = i;
                    break;
                }
            }
        }
        
        // Если нашли фамилию
        if (surnameIndex !== -1) {
            lastName = parts[surnameIndex];
            
            // Оставшиеся части: определяем имя и отчество по длине
            const remainingParts = [...parts.slice(0, surnameIndex), ...parts.slice(surnameIndex + 1)];
            
            if (remainingParts.length === 1) {
                // Одно слово - имя
                firstName = remainingParts[0];
            } else if (remainingParts.length >= 2) {
                // Два и более слов: самое короткое - имя, остальные - отчество
                let shortestIndex = 0;
                let minLength = remainingParts[0].length;
                
                for (let i = 1; i < remainingParts.length; i++) {
                    if (remainingParts[i].length < minLength) {
                        minLength = remainingParts[i].length;
                        shortestIndex = i;
                    }
                }
                
                // Самое короткое слово - имя
                firstName = remainingParts[shortestIndex];
                
                // Остальные слова - отчество
                const patronymicParts = remainingParts.filter((_, index) => index !== shortestIndex);
                middleName = patronymicParts.join(' ');
            }
        } else {
            // Не смогли определить фамилию - используем эвристику длины
            // Самое длинное слово - фамилия
            let longestIndex = 0;
            let maxLength = parts[0].length;
            
            for (let i = 1; i < parts.length; i++) {
                if (parts[i].length > maxLength) {
                    maxLength = parts[i].length;
                    longestIndex = i;
                }
            }
            
            lastName = parts[longestIndex];
            
            // Оставшиеся части: самое короткое - имя, остальные - отчество
            const remainingParts = parts.filter((_, index) => index !== longestIndex);
            
            if (remainingParts.length === 1) {
                firstName = remainingParts[0];
            } else if (remainingParts.length >= 2) {
                let shortestIndex = 0;
                let minLength = remainingParts[0].length;
                
                for (let i = 1; i < remainingParts.length; i++) {
                    if (remainingParts[i].length < minLength) {
                        minLength = remainingParts[i].length;
                        shortestIndex = i;
                    }
                }
                
                firstName = remainingParts[shortestIndex];
                const patronymicParts = remainingParts.filter((_, index) => index !== shortestIndex);
                middleName = patronymicParts.join(' ');
            }
        }
    }

    // Объединяем имя и отчество в одно поле
    const fullFirstName = [firstName, middleName].filter(Boolean).join(' ').trim();

    console.log('🔍 Parser debug:');
    console.log('- Input:', fullName);
    console.log('- Parts:', parts);
    console.log('- Detected last name:', lastName);
    console.log('- Detected first name:', firstName);
    console.log('- Detected middle name:', middleName);
    console.log('- Combined first name:', fullFirstName);
    
    return { 
        lastName: lastName || '',
        firstName: fullFirstName || '',
        middleName: middleName || '' // Для логов
    };
}
app.get('/auth', (req, res) => {
    const authUrl = `https://www.amocrm.ru/oauth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=fioparser`;
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
    console.log('🚀 Starting periodic contact check every 30 seconds');
    
    // Сначала проверяем общее количество контактов
    setTimeout(async () => {
        console.log('\n🔍 === INITIAL CONTACTS CHECK ===');
        await checkContactsCount();
    }, 2000);
    
    setInterval(async () => {
        try {
            if (!tokens) {
                console.log('⏳ Waiting for authorization...');
                return;
            }

            console.log('\n🔍 === STARTING PERIODIC CHECK ===');
            console.log('🕐 Last check was:', lastCheckTime.toISOString());
            
            // Добавляем проверку количества контактов в каждую итерацию
            await checkContactsCount();
            
            const contacts = await getRecentContacts();
            console.log(`📋 Found ${contacts.length} new contacts to process`);
            
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

// Получение последних контактов (ИСПРАВЛЕННАЯ ВЕРСИЯ)
async function getRecentContacts() {
    try {
        const accessToken = await getValidToken();
        if (!accessToken) {
            console.log('❌ No valid token for getting contacts');
            return [];
        }

        console.log('🕐 Last check time:', lastCheckTime.toISOString());
        
        // Конвертируем время в Unix timestamp (секунды) для amoCRM
        const sinceTimestamp = Math.floor(lastCheckTime.getTime() / 1000);
        
        // Важно: используем фильтр по времени создания!
        const response = await axios.get(
            `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts?filter[created_at][from]=${sinceTimestamp}&order=created_at&limit=100`,
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

        console.log(`📊 Total contacts in response: ${response.data._embedded.contacts.length}`);

        // Все контакты из этого запроса - новые (созданы после lastCheckTime)
        const newContacts = response.data._embedded.contacts;

        console.log(`📋 Found ${newContacts.length} new contacts since last check`);
        
        // Логируем новые контакты
        if (newContacts.length > 0) {
            console.log('🎯 New contacts found:');
            newContacts.forEach((contact, index) => {
                const created = contact.created_at ? new Date(contact.created_at * 1000).toISOString() : 'no date';
                console.log(`  ${index + 1}. ${contact.name || 'No name'} (ID: ${contact.id}, created: ${created})`);
            });
        }

        return newContacts;

    } catch (error) {
        console.error('❌ Get contacts error:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Message:', error.message);
        }
        return [];
    }
}
// Обработка контакта (С УЛУЧШЕННЫМ ЛОГИРОВАНИЕМ)
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
        console.log('Parsed result:');
        console.log('- Last name:', parsed.lastName);
        console.log('- First name:', parsed.firstName);
        console.log('- Middle name:', parsed.middleName);

        // Проверяем, нужно ли вообще обновлять
        const needsUpdate = parsed.lastName && parsed.firstName;
        if (!needsUpdate) {
            console.log('⚠️ Skip: Not enough data to update');
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
        const accessToken = await getValidToken();
        if (!accessToken) {
            console.log('❌ No valid token for update');
            return false;
        }

        // Теперь используем только lastName и firstName
        // middleName уже объединен в firstName
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
            console.error('❌ API Response:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('❌ Network Error:', error.message);
        }
        return false;
    }
}
// Функция для проверки количества контактов в amoCRM
async function checkContactsCount() {
    try {
        console.log('\n📊 === CONTACTS COUNT CHECK ===');
        
        const accessToken = await getValidToken();
        if (!accessToken) {
            console.log('❌ No valid token for contacts check');
            return;
        }
        
        console.log('✅ Token is valid, making API request...');

        // Запрос для проверки общего количества
        const response = await axios.get(
            `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts?limit=1`,
            {
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        console.log('✅ API connection successful');
        console.log('📈 Response status:', response.status);
        
        // Проверяем заголовки пагинации
        if (response.headers['x-pagination-total-items']) {
            console.log('📦 Total contacts in amoCRM:', response.headers['x-pagination-total-items']);
        }
        
        if (response.data && response.data._embedded) {
            console.log('👥 Contacts in current response:', response.data._embedded.contacts?.length || 0);
        }

    } catch (error) {
        console.error('❌ Contacts count check error:');
        if (error.response) {
            console.error('📊 Status:', error.response.status);
        } else {
            console.error('💥 Error:', error.message);
        }
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
// Статус
app.get('/status', (req, res) => {
    res.json({
        authorized: !!tokens,
        last_check: lastCheckTime.toISOString(),
        domain: AMOCRM_DOMAIN
    });
});
// Ручная проверка контактов
app.get('/debug/contacts', async (req, res) => {
    try {
        await checkContactsCount();
        res.json({ 
            success: true, 
            message: 'Contacts check completed. Check server logs for details.',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
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





