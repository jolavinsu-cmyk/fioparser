import express from 'express';
import cors from 'cors';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Глобальная база данных (только частые слова)
const NAME_DATABASE = {
    surnames: new Set(),
    firstNames: new Set(),
    patronymics: new Set(),
    currentFileIndex: 1,
    maxFiles: 15,
    isFullyLoaded: false
};

// Функция проверки слова в текущей базе
function isWordInDatabase(word, category) {
    const lowerWord = word.toLowerCase();
    return NAME_DATABASE[category].has(lowerWord);
}

// Ленивая загрузка следующего файла при необходимости
async function lazyLoadNextFileIfNeeded(missingWords) {
    if (NAME_DATABASE.isFullyLoaded || NAME_DATABASE.currentFileIndex > NAME_DATABASE.maxFiles) {
        console.log('🚫 Database fully loaded or max files reached');
        return false;
    }

    console.log(`📂 Loading file data${NAME_DATABASE.currentFileIndex}.txt for missing words: ${missingWords.join(', ')}`);
    
    try {
        const filePath = path.join(__dirname, `data${NAME_DATABASE.currentFileIndex}.txt`);
        
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            const lines = data.split('\n').filter(line => line.trim());
            
            let loadedCount = 0;
            for (const line of lines) {
                const columns = line.split(',').map(col => col.trim()).filter(col => col.length > 0);
                
                if (columns.length >= 3) {
                    const surname = columns[0].toLowerCase();
                    const firstName = columns[1].toLowerCase();
                    const patronymic = columns[2].toLowerCase();
                    
                    NAME_DATABASE.surnames.add(surname);
                    NAME_DATABASE.firstNames.add(firstName);
                    NAME_DATABASE.patronymics.add(patronymic);
                    loadedCount++;
                }
            }
            
            console.log(`✅ Loaded data${NAME_DATABASE.currentFileIndex}.txt: ${loadedCount} words`);
            NAME_DATABASE.currentFileIndex++;
            
            return true;
        } else {
            console.log(`⚠️ File data${NAME_DATABASE.currentFileIndex}.txt not found`);
            NAME_DATABASE.currentFileIndex++;
            return true; // Продолжаем следующий файл
        }
    } catch (error) {
        console.error('❌ Error loading file:', error.message);
        NAME_DATABASE.currentFileIndex++;
        return true; // Продолжаем следующий файл
    }
}


// Умный парсер на основе базы данных
async function parseFIO(fullName) {
    const parts = fullName.trim().split(/\s+/).filter(part => part.length > 0);
    
    console.log(`\n🔍 Parsing: "${fullName}"`);
    console.log(`📊 Current database: file ${NAME_DATABASE.currentFileIndex-1}, words: ${NAME_DATABASE.surnames.size + NAME_DATABASE.firstNames.size + NAME_DATABASE.patronymics.size}`);
    
    const result = {
        surname: '',
        firstName: '',
        patronymic: '',
        unknown: []
    };

    let attempts = 0;
    const maxAttempts = NAME_DATABASE.maxFiles;
    
    while (attempts < maxAttempts) {
        attempts++;
        let missingWords = [];
        let allFound = true;
        
        // Проверяем каждое слово в текущей базе
        for (const part of parts) {
            const lowerPart = part.toLowerCase();
            let found = false;
            
            if (isWordInDatabase(part, 'surnames') && !result.surname) {
                result.surname = part;
                found = true;
                console.log(`- ✅ "${part}" → surname (from DB)`);
            } 
            else if (isWordInDatabase(part, 'firstNames') && !result.firstName) {
                result.firstName = result.firstName ? `${result.firstName} ${part}` : part;
                found = true;
                console.log(`- ✅ "${part}" → first name (from DB)`);
            }
            else if (isWordInDatabase(part, 'patronymics') && !result.patronymic) {
                result.patronymic = result.patronymic ? `${result.patronymic} ${part}` : part;
                found = true;
                console.log(`- ✅ "${part}" → patronymic (from DB)`);
            }
            
            if (!found) {
                missingWords.push(part);
                allFound = false;
            }
        }
        
        // Если ВСЕ слова найдены - выходим
        if (allFound) {
            console.log('🎯 All words found! Stopping search.');
            break;
        }
        
        // Если база полностью загружена - выходим
        if (NAME_DATABASE.isFullyLoaded) {
            console.log('📦 Database fully loaded, stopping search.');
            break;
        }
        
        // Загружаем следующий файл только для недостающих слов
        if (missingWords.length > 0) {
            const loaded = await lazyLoadNextFileIfNeeded(missingWords);
            if (!loaded) {
                NAME_DATABASE.isFullyLoaded = true;
                break;
            }
        } else {
            break;
        }
    }
    
    // Добавляем не найденные слова в unknown
    for (const part of parts) {
        if (part !== result.surname && 
            !result.firstName.includes(part) && 
            !result.patronymic.includes(part) &&
            !result.unknown.includes(part)) {
            result.unknown.push(part);
            console.log(`- ❌ "${part}" → unknown (not found in any DB)`);
        }
    }
    
    // Fallback логика
    if (!result.surname && parts.length > 0) {
        result.surname = parts[0];
        console.log(`- 🔄 "${parts[0]}" → surname (fallback)`);
    }
    
    // Объединяем для amoCRM
    const fullFirstName = [result.firstName, result.patronymic, ...result.unknown]
        .filter(Boolean)
        .join(' ')
        .trim();
    
    console.log('📊 Final result:');
    console.log(`- Surname: "${result.surname}"`);
    console.log(`- First name: "${result.firstName}"`);
    console.log(`- Patronymic: "${result.patronymic}"`);
    console.log(`- Unknown: ${result.unknown}`);
    console.log(`- Combined: "${result.surname}" / "${fullFirstName}"`);
    
    return {
        lastName: result.surname || '',
        firstName: fullFirstName || '',
        patronymic: result.patronymic || ''
    };
}
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

        // Парсим ФИО
        const parsed = await parseFIO(contact.name);
        console.log('Parsed result:');
        console.log('- Last name:', parsed.lastName);
        console.log('- First name:', parsed.firstName);
        console.log('- Middle name:', parsed.middleName);

        // Проверяем, нужно ли обновлять (ИЗМЕНИЛИ ЛОГИКУ!)
        const originalParts = contact.name.trim().split(/\s+/);
        const parsedFullName = `${parsed.firstName} ${parsed.lastName}`.trim();
        const needsUpdate = parsed.lastName && parsed.firstName && 
                          contact.name !== parsedFullName;
        
        if (!needsUpdate) {
            console.log('⚠️ Skip: No changes needed');
            if (contact.name === parsedFullName) {
                console.log('📝 Names are already in correct format');
            } else {
                console.log('❌ Not enough data to update');
            }
            return;
        }

        console.log('🔄 Needs update:', {
            from: contact.name,
            to: parsedFullName
        });

        // Обновляем контакт в amoCRM
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
// Загружаем базу данных при старте сервера
//loadNameDatabase().then(() => {
//    console.log('🚀 Name database loaded successfully');
//});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});

// Обработчик ошибок порта
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} busy, trying to restart...`);
        setTimeout(() => {
            server.close();
            server.listen(PORT, '0.0.0.0');
        }, 1000);
    }
});






























