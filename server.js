import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

// Вебхук для обработки новых контактов
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
        await updateContactInAmoCRM(account, contact.id, parsed);
        
        res.json({ success: true, parsed });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Функция обновления контакта через API
async function updateContactInAmoCRM(account, contactId, parsedData) {
    const apiUrl = `https://${account}.amocrm.ru/api/v4/contacts/${contactId}`;
    
    const updateData = {
        first_name: parsedData.firstName,
        last_name: parsedData.lastName,
        custom_fields_values: [
            {
                field_id: 123456, // ID поля "Отчество"
                values: [{ value: parsedData.middleName }]
            }
        ]
    };

    // Здесь нужен access_token из OAuth
    // Для демонстрации просто логируем
    console.log('Would update contact:', updateData);
    return true;
}

// UI для управления (опционально)
app.get('/admin', (req, res) => {
    res.send(`
        <h1>FIOParser Admin</h1>
        <p>Статус: Активен</p>
        <p>Обработано контактов: 0</p>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 Auto-parser server running on port ${PORT}`);
});
