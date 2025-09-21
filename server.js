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
const CLIENT_ID = process.env.AMOCRM_CLIENT_ID || '';
const CLIENT_SECRET = process.env.AMOCRM_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://fioparser.onrender.com/oauth/callback';
const AMOCRM_DOMAIN = process.env.AMOCRM_DOMAIN || '';


// ---------- Загрузка баз ----------
function loadDatabase(fileName) {
  const filePath = path.join(__dirname, `${fileName}.txt`);
  if (!fs.existsSync(filePath)) {
    console.error(`⚠️ Database file not found: ${filePath}`);
    return new Set();
  }
  const data = fs.readFileSync(filePath, 'utf8');
  return new Set(
    data
      .split('\n')
      .map(line => line.trim().toLowerCase())
      .filter(line => line.length > 0)
  );
}

const db = {
  names: loadDatabase('names'),
  surnames: loadDatabase('surnames'),
  patronymics: loadDatabase('patronymics')
};

// ---------- In-memory state ----------
const processingState = new Map();
const MAX_UPDATE_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

let tokens = null;
let lastCheckTime = new Date(Date.now() - 5 * 60 * 1000);

app.use(cors());
app.use(express.json());

// ----------------------------
// Парсер ФИО
// ----------------------------
async function parseFIO(input) {
  console.log(`🔍 Parsing: "${input}"`);
  const parts = input.trim().split(/\s+/);

  let surname = '';
  let firstName = '';
  let patronymic = '';
  let unknown = [];
  let foundNames = []; // собираем все найденные имена

  // Шаг 1: проверка по базам
  for (const part of parts) {
    const lower = part.toLowerCase();

    if (!surname && db.surnames.has(lower)) {
      surname = part;
    } else if (db.names.has(lower)) {
      foundNames.push(part);
    } else if (!patronymic && db.patronymics.has(lower)) {
      patronymic = part;
    } else {
      unknown.push(part);
    }
  }

  // Шаг 1.1: обработка ситуации с 2 именами
  if (foundNames.length > 1 && !surname) {
    for (let i = 0; i < foundNames.length; i++) {
      const lower = foundNames[i].toLowerCase();
      if (db.surnames.has(lower)) {
        surname = foundNames[i];
        foundNames.splice(i, 1); // удаляем из имён
        break;
      }
    }
  }

  // Основное имя выбираем из оставшегося массива foundNames
  if (!firstName && foundNames.length > 0) {
    firstName = foundNames[0];
    if (foundNames.length > 1) {
      unknown.push(...foundNames.slice(1));
    }
  }

  // Шаг 2: проверка окончаний только для оставшихся
  function tryByEnding(word) {
    const lower = word.toLowerCase();
    if (!surname && /(?:ов|ев|ёв|ин|ын|ский|цкий|цкая|ова|ева|ёва|ина|ына|ская)$/i.test(lower)) {
      surname = word;
      return true;
    }
    if (!patronymic && /(?:вич|вна)$/i.test(lower)) {
      patronymic = word;
      return true;
    }
    if (!firstName && /(?:ий|ый|ая|на|ся|ша|ля|ня)$/i.test(lower)) {
      firstName = word;
      return true;
    }
    return false;
  }

  const stillUnknown = [];
  for (const word of unknown) {
    if (!tryByEnding(word)) stillUnknown.push(word);
  }

  // Шаг 3: определяем валидность
  let valid = false;
  if (parts.length >= 3) {
    valid = Boolean(firstName && surname && patronymic);
  } else if (parts.length === 2) {
    valid = Boolean(
      (firstName && surname) ||
      (firstName && patronymic) ||
      (surname && patronymic)
    );
  } else if (parts.length === 1) {
    valid = Boolean(firstName || surname || patronymic);
  }

  return {
    lastName: surname || '',
    firstName: [firstName, patronymic].filter(Boolean).join(' ') || '',
    patronymic: patronymic || '',
    valid
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
    if (!accessToken) return [];

    console.log('🕐 Last check time:', lastCheckTime.toISOString());
    const sinceTimestamp = Math.floor(lastCheckTime.getTime() / 1000);

    const response = await axios.get(
      `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts?filter[created_at][from]=${sinceTimestamp}&order=created_at&limit=100`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000
      }
    );

    return response.data._embedded?.contacts || [];
  } catch (error) {
    console.error('❌ Get contacts error:', error.response?.data || error.message);
    return [];
  }
}

// ----------------------------
// Обновление контакта
// ----------------------------
async function updateContactInAmoCRM(contactId, parsedData) {
  try {
    const accessToken = await getValidToken();
    if (!accessToken) return false;

    const updateData = {
      first_name: parsedData.firstName || '',
      last_name: parsedData.lastName || ''
    };

    const response = await axios.patch(
      `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts/${contactId}`,
      updateData,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000
      }
    );

    console.log('✅ Update successful:', response.status);
    return true;
  } catch (error) {
    console.error('❌ Update error:', error.response?.data || error.message);
    return false;
  }
}

// ----------------------------
// Обработка контакта
// ----------------------------
async function processContact(contact) {
  try {
    console.log('\n=== PROCESSING CONTACT ===');
    console.log('Contact ID:', contact.id, 'Name:', contact.name);

    if (!contact.name || contact.name.trim().length < 2) return;

    // Проверка на цифры и спецсимволы
    const invalidPattern = /[^a-zA-Zа-яА-ЯёЁ()\s]/u;
    if (/\d/.test(contact.name) || invalidPattern.test(contact.name)) {
      console.log(`🚫 Skip: "${contact.name}" содержит цифры/символы`);
      return;
    }

    if (processingState.has(contact.id)) return;

    const parsed = await parseFIO(contact.name);

    // Пропускаем, если парсер не уверен
    if (!parsed.valid) {
      console.log(`⚠️ Skip: could not reliably parse FIO for contact ${contact.id}`);
      return;
    }

    const state = { attempts: 0, parsedData: parsed };
    processingState.set(contact.id, state);

    const norm = s => (s ? String(s).trim() : '');
    const existingFirst = norm(contact.first_name);
    const existingLast = norm(contact.last_name);
    const parsedFirst = norm(parsed.firstName);
    const parsedLast = norm(parsed.lastName);

    if (!parsedFirst && !parsedLast) {
      processingState.delete(contact.id);
      return;
    }

    if (parsedFirst === existingFirst && parsedLast === existingLast) {
      processingState.delete(contact.id);
      return;
    }

    while (state.attempts < MAX_UPDATE_ATTEMPTS) {
      const success = await updateContactInAmoCRM(contact.id, state.parsedData);
      if (success) {
        processingState.delete(contact.id);
        return;
      }
      state.attempts++;
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }

    processingState.delete(contact.id);
  } catch (error) {
    console.error('💥 Process error:', error.message);
    processingState.delete(contact.id);
  }
}

// ----------------------------
// Загрузка и обработка всех контактов
// ----------------------------
async function getAllContacts() {
  try {
    const accessToken = await getValidToken();
    if (!accessToken) return [];

    let allContacts = [];
    let page = 1;

    while (true) {
      const response = await axios.get(
        `https://${AMOCRM_DOMAIN}.amocrm.ru/api/v4/contacts?page=${page}&limit=100&order=created_at`,
        { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 }
      );

      const contacts = response.data._embedded?.contacts || [];
      allContacts = allContacts.concat(contacts);

      if (!response.data._links?.next) break;
      page++;
    }

    return allContacts;
  } catch (error) {
    console.error('❌ Get all contacts error:', error.response?.data || error.message);
    return [];
  }
}

// ----------------------------
// Полный запуск с двойным подтверждением
// ----------------------------
let fullRunPending = false;

app.get('/confirm-full-run', async (req, res) => {
  if (!fullRunPending) {
    fullRunPending = true;
    res.send(`
      <h2>⚠️ ВНИМАНИЕ: Запуск обработки всех контактов!</h2>
      <a href="/confirm-full-run?confirm=1">Да, я подтверждаю</a>
    `);
    return;
  }

  if (req.query.confirm === '1') {
    res.send('<h2>🚀 Обработка всех контактов запущена. Смотрите логи.</h2>');
    (async () => {
      const contacts = await getAllContacts();
      for (const contact of contacts) await processContact(contact);
      console.log('✅ Full run completed!');
      fullRunPending = false;
    })();
    return;
  }

  res.send('<p>❌ Ошибка подтверждения. Попробуйте снова.</p>');
});

// ----------------------------
// Периодическая проверка
// ----------------------------
let isChecking = false;

async function checkAndProcess() {
  if (isChecking) return;
  isChecking = true;
  const checkStartTime = new Date();

  try {
    const contacts = await getRecentContacts();
    for (const contact of contacts) await processContact(contact);
    lastCheckTime = checkStartTime;
  } catch (e) {
    console.error('💥 checkAndProcess error:', e.message);
  } finally {
    isChecking = false;
  }
}

function startPeriodicCheck() {
  console.log('🚀 Starting periodic contact check every 30s');
  checkAndProcess();
  setInterval(checkAndProcess, 15000);
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














