// server.js
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

// Конфигурация OAuth (замените на свои данные)
const CLIENT_ID = process.env.AMOCRM_CLIENT_ID || '8f3f615f-aa84-4c5b-b4fa-5c0dad4ad18c';
const CLIENT_SECRET = process.env.AMOCRM_CLIENT_SECRET || '8s7o4V6PE1RAbe4QbRZ6XxdzEx0pl8s3MNGLilVWeEf32pR6XLW89UvUThrz5b1d';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://fioparser.onrender.com/oauth/callback';
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN || 'insainintegratest';


// ---------- База имён (как у тебя) ----------
const NAME_DATABASE = {
  currentFileIndex: 1,
  maxFiles: 15
};

// ---------- In-memory state ----------
const processingState = new Map(); // contactId -> { attempts, parsedData }
const MAX_UPDATE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000; // задержка между попытками обновления

// ---------- OAuth tokens ----------
let tokens = null;
let lastCheckTime = new Date(Date.now() - 5 * 60 * 1000); // старт — 5 минут назад

app.use(cors());
app.use(express.json());

// ----------------------------
// Функции поиска в файлах
// ----------------------------
async function searchInFile(word, category, fileIndex) {
  try {
    const filePath = path.join(__dirname, `data${fileIndex}.txt`);

    if (!fs.existsSync(filePath)) {
      return false;
    }

    const data = fs.readFileSync(filePath, 'utf8');
    const lines = data.split('\n').filter(line => line.trim());
    const lowerWord = word.toLowerCase();

    for (const line of lines) {
      const columns = line.split(',').map(col => col.trim()).filter(col => col.length > 0);

      if (columns.length >= 3) {
        const columnValue = columns[
          category === 'surnames' ? 0 :
          category === 'firstNames' ? 1 : 2
        ].toLowerCase();

        if (columnValue === lowerWord) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error(`❌ Error searching in data${fileIndex}.txt:`, error.message);
    return false;
  }
}

// ----------------------------
// Парсер ФИО (твоя логика)
// ----------------------------
async function parseFIO(fullName) {
  const parts = fullName.trim().split(/\s+/).filter(p => p.length > 0);

  console.log(`\n🔍 Parsing: "${fullName}"`);

  const result = {
    surname: '',
    firstName: '',
    patronymic: '',
    unknown: []
  };

  for (const part of parts) {
    let found = false;
    for (let fileIndex = 1; fileIndex <= NAME_DATABASE.maxFiles; fileIndex++) {
      if (!result.surname && await searchInFile(part, 'surnames', fileIndex)) {
        result.surname = part;
        found = true;
        console.log(`- ✅ "${part}" → surname (found in data${fileIndex}.txt)`);
        break;
      }
      if (!result.firstName && await searchInFile(part, 'firstNames', fileIndex)) {
        result.firstName = part;
        found = true;
        console.log(`- ✅ "${part}" → first name (found in data${fileIndex}.txt)`);
        break;
      }
      if (!result.patronymic && await searchInFile(part, 'patronymics', fileIndex)) {
        result.patronymic = part;
        found = true;
        console.log(`- ✅ "${part}" → patronymic (found in data${fileIndex}.txt)`);
        break;
      }
    }
    if (!found) {
      result.unknown.push(part);
      console.log(`- ❌ "${part}" → unknown (not found in any file)`);
    }
  }

  // Формируем firstName: имя + отчество и неизвестные
  const fullFirstName = [
    result.firstName || '',
    result.patronymic || '',
    ...(result.unknown || [])
  ].filter(p => p && p.trim().length > 0).join(' ').trim();

  // ⚡️ ВАЖНО: фамилия может остаться пустой, если не определена
  const lastNameFinal = result.surname ? result.surname : '';

  console.log('📊 Final result:');
  console.log(`- Surname: "${lastNameFinal}"`);
  console.log(`- First name: "${result.firstName}"`);
  console.log(`- Patronymic: "${result.patronymic}"`);
  console.log(`- Unknown: ${result.unknown}`);
  console.log(`- Combined: "${lastNameFinal}" / "${fullFirstName}"`);

  return {
  lastName: result.surname ? result.surname : '',
  firstName: fullFirstName || '',
  patronymic: result.patronymic || ''
  };
}

// ----------------------------
// OAuth / токены (как у тебя)
// ----------------------------
app.get('/auth', (req, res) => {
  const authUrl = `https://www.amocrm.ru/oauth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=fioparser`;
  res.redirect(authUrl);
});

app.get('/oauth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const tokenResponse = await axios.post(`https://${AMOCRM_DOMAIN}.amocrm.ru/oauth2/access_token`, {
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    });

    tokens = {
      access_token: tokenResponse.data.access_token,
      refresh_token: tokenResponse.data.refresh_token,
      expires_at: Date.now() + (tokenResponse.data.expires_in * 1000)
    };

    // Запускаем цикл проверки (если ещё не запущен)
    if (!isChecking) {
      startPeriodicCheck();
    }

    res.send('Авторизация успешна! Автопарсинг запущен.');
  } catch (error) {
    console.error('OAuth error:', error.response?.data || error.message);
    res.status(500).send('Ошибка авторизации');
  }
});

// ----------------------------
// Получение валидного токена
// ----------------------------
async function getValidToken() {
  if (!tokens?.access_token) {
    console.log('❌ No access token available');
    return null;
  }

  // Если токен истек или скоро истечет - обновляем
  if (Date.now() >= tokens.expires_at - 300000) { // 5 минут до истечения
    console.log('🔄 Token expired or about to expire, refreshing...');
    const success = await refreshToken();
    if (!success) return null;
  }

  return tokens.access_token;
}

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

// ----------------------------
// Получение новых контактов
// ----------------------------
async function getRecentContacts() {
  try {
    const accessToken = await getValidToken();
    if (!accessToken) {
      console.log('❌ No valid token for getting contacts');
      return [];
    }

    console.log('🕐 Last check time:', lastCheckTime.toISOString());

    const sinceTimestamp = Math.floor(lastCheckTime.getTime() / 1000);

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

    const newContacts = response.data._embedded.contacts;
    console.log(`📊 Total contacts in response: ${newContacts.length}`);
    if (newContacts.length > 0) {
      console.log('🎯 New contacts found:');
      newContacts.forEach((contact, idx) => {
        const created = contact.created_at ? new Date(contact.created_at * 1000).toISOString() : 'no date';
        console.log(`  ${idx + 1}. ${contact.name || 'No name'} (ID: ${contact.id}, created: ${created})`);
      });
    }

    return newContacts;
  } catch (error) {
    console.error('❌ Get contacts error:', error.response ? JSON.stringify(error.response.data) : error.message);
    return [];
  }
}

// ----------------------------
// Обновление контакта через API
// ----------------------------
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

    console.log('🔄 Update contact request:', updateData);

    const response = await axios.patch(
      `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts/${contactId}`,
      updateData,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log('✅ Update successful, status:', response.status);
    return true;
  } catch (error) {
    if (error.response) {
      console.error('❌ Update contact error - status:', error.response.status, 'data:', JSON.stringify(error.response.data));
      // Для 4xx - не пытаться снова
      if (error.response.status >= 400 && error.response.status < 500) {
        console.log('🚫 Client error on update, not retrying.');
        return false;
      }
    } else {
      console.error('❌ Update contact network error:', error.message);
    }
    return false;
  }
}

// ----------------------------
// Обработка одного контакта (последовательно, с retry внутри)
// ----------------------------
async function processContact(contact) {
  try {
    console.log('\n=== PROCESSING CONTACT ===');
    console.log('Contact ID:', contact.id);
    console.log('Original name:', contact.name);

    if (!contact.name || contact.name.trim().length < 2) {
      console.log('❌ Skip: No valid name');
      return;
    }

    // Не парсим контакты, которые уже обрабатываются сейчас в памяти
    if (processingState.has(contact.id)) {
      console.log(`⚠️ Contact ${contact.id} is already being processed — skipping duplicate invocation.`);
      return;
    }

    // Шаг 1: парсим и сохраняем в памяти
    const parsed = await parseFIO(contact.name);
    const state = {
      attempts: 0,
      parsedData: parsed
    };
    processingState.set(contact.id, state);
    console.log('💾 Saved parsed state:', state);

    // Шаг 2: проверяем есть ли смысл обновлять
    // нормализация строки (trim + toString)
    const norm = s => (s === undefined || s === null) ? '' : String(s).trim();
  
    // существующие значения в карточке (если есть)
    const existingFirst = norm(contact.first_name);
    const existingLast = norm(contact.last_name);
    
    // распарсенные значения
    const parsedFirst = norm(state.parsedData.firstName);
    const parsedLast = norm(state.parsedData.lastName);
    
    // если у нас вообще нет ничего распарсенного — ничего не делаем
    if (!parsedFirst && !parsedLast) {
      console.log('⚠️ Skip: nothing parsed (no first name and no last name) — removing from memory.');
      processingState.delete(contact.id);
      return;
    }
    
    // решаем обновлять, если хотя бы одно поле отличается
    const needsUpdate = (parsedFirst !== existingFirst) || (parsedLast !== existingLast);
    
    console.log(`🔎 Compare fields: existingFirst="${existingFirst}", existingLast="${existingLast}" -> parsedFirst="${parsedFirst}", parsedLast="${parsedLast}"`);
    if (!needsUpdate) {
      console.log('⚠️ Skip: fields already match parsed data — removing from memory.');
      processingState.delete(contact.id);
      return;
    }
    
    // Если дошли до сюда — нужно обновлять (будет идти цикл попыток ниже)
      console.log('ℹ️ Update required: will attempt to update first_name/last_name for contact', contact.id);
    
    // Шаг 3: внутренняя последовательность попыток обновления
    while (state.attempts < MAX_UPDATE_ATTEMPTS) {
      console.log(`🔄 Attempting update for contact ${contact.id} (attempt ${state.attempts + 1}/${MAX_UPDATE_ATTEMPTS})`);
      const success = await updateContactInAmoCRM(contact.id, state.parsedData);

      if (success) {
        console.log(`✅ Contact ${contact.id} updated successfully`);
        processingState.delete(contact.id);
        return;
      }

      // неуспех
      state.attempts++;
      processingState.set(contact.id, state);

      if (state.attempts >= MAX_UPDATE_ATTEMPTS) {
        console.log(`🚫 Contact ${contact.id} failed after ${state.attempts} attempts — removing from memory.`);
        processingState.delete(contact.id);
        return;
      }

      console.log(`❌ Update failed for contact ${contact.id}, will retry after ${RETRY_DELAY_MS}ms`);
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }

  } catch (error) {
    console.error('💥 Process contact error:', error.message);
    // очищаем память при неожиданной ошибке, чтобы не блокировать навсегда
    if (processingState.has(contact.id)) {
      processingState.delete(contact.id);
      console.log(`🗑 Contact ${contact.id} removed from memory due error.`);
    }
  }
}
// ----------------------------
// Загрузка и обработка всех контактов AmoCRM
// ----------------------------
async function getAllContacts() {
  try {
    const accessToken = await getValidToken();
    if (!accessToken) {
      console.log('❌ No valid token for full run');
      return [];
    }

    let allContacts = [];
    let page = 1;

    while (true) {
      console.log(`📥 Fetching contacts page ${page}...`);
      const response = await axios.get(
        `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts?page=${page}&limit=100&order=created_at`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const contacts = response.data._embedded?.contacts || [];
      allContacts = allContacts.concat(contacts);

      if (!response.data._links || !response.data._links.next) {
        break; // больше страниц нет
      }
      page++;
    }

    console.log(`📊 Total contacts fetched: ${allContacts.length}`);
    return allContacts;
  } catch (error) {
    console.error('❌ Get all contacts error:', error.response?.data || error.message);
    return [];
  }
}

// ----------------------------
// Полная обработка всех контактов (с предупреждением)
// ----------------------------
let fullRunPending = false;

app.get('/confirm-full-run', async (req, res) => {
  if (!fullRunPending) {
    // Первая попытка
    fullRunPending = true;
    res.send(`
      <h2>⚠️ ВНИМАНИЕ: Вы собираетесь запустить обработку всех контактов в AmoCRM!</h2>
      <p>Это может занять много времени и нагружает систему.</p>
      <a href="/confirm-full-run?confirm=1">Да, я подтверждаю запуск</a>
    `);
    return;
  }

  // Вторая попытка с параметром confirm=1
  if (req.query.confirm === '1') {
    res.send('<h2>🚀 Полный запуск обработки всех контактов запущен. См. логи сервера.</h2>');

    // Запуск в фоне
    (async () => {
      const contacts = await getAllContacts();
      console.log(`🔄 Starting full processing of ${contacts.length} contacts...`);

      for (const contact of contacts) {
        await processContact(contact); // обрабатываем каждый контакт последовательно
      }

      console.log('✅ Full run completed!');
      fullRunPending = false;
    })();

    return;
  }

  // Если confirm не передан
  res.send('<p>❌ Ошибка подтверждения. Перейдите снова на <a href="/confirm-full-run">/confirm-full-run</a>.</p>');
});

// ----------------------------
// Периодическая проверка
// ----------------------------
let isChecking = false;

async function checkAndProcess() {
  if (isChecking) {
    console.log('⏳ Skipping check because previous one is still running');
    return;
  }
  isChecking = true;

  const checkStartTime = new Date();
  console.log('\n🔍 === STARTING PERIODIC CHECK ===');
  console.log('🕐 Last check time:', lastCheckTime.toISOString());

  try {
    const contacts = await getRecentContacts();

    if (!contacts || contacts.length === 0) {
      console.log('❌ No contacts found in response');
    } else {
      console.log(`📋 Found ${contacts.length} new contacts to process`);
      // Обрабатываем последовательно — один за другим
      for (const contact of contacts) {
        // processContact параллельно возвращает только после полного цикла попыток
        await processContact(contact);
      }
    }

    // Обновляем lastCheckTime на начало этой проверки,
    // чтобы в следующей итерации получить контакты, созданные после стартовой точки
    lastCheckTime = checkStartTime;
    console.log('✅ Check completed. New last check time:', lastCheckTime.toISOString());
  } catch (e) {
    console.error('💥 Error during checkAndProcess:', e.message);
  } finally {
    isChecking = false;
  }
}

function startPeriodicCheck() {
  console.log('🚀 Starting periodic contact check every 30 seconds');
  // Первый запуск сразу
  checkAndProcess();
  // Далее по таймеру
  setInterval(checkAndProcess, 30000);
}

// ----------------------------
// Отладочные маршруты
// ----------------------------
app.get('/status', (req, res) => {
  res.json({
    authorized: !!tokens,
    last_check: lastCheckTime.toISOString(),
    domain: AMOCRM_DOMAIN,
    processing_memory_items: processingState.size
  });
});

app.get('/debug/contacts', async (req, res) => {
  try {
    await checkAndProcess();
    res.json({
      success: true,
      message: 'Contacts check completed. See server logs.',
      memory_size: processingState.size
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/', (req, res) => {
  res.send(`
    <h1>FIOParser Auto</h1>
    <p>Статус: ${tokens ? 'Авторизован' : 'Не авторизован'}</p>
    <a href="/auth">Авторизовать</a> | <a href="/status">Статус</a>
  `);
});

// ----------------------------
// Запуск сервера
// ----------------------------
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Обработка ошибки порта
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} busy, retrying...`);
    setTimeout(() => {
      server.close();
      server.listen(PORT, '0.0.0.0');
    }, 1000);
  } else {
    console.error('Server error:', err);
  }
});





