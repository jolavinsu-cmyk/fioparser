const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Включение CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Обслуживание статических файлов
app.use(express.static(path.join(__dirname)));

// Основной роут
app.get('/', (req, res) => {
  res.send('FIOParser Server is running!');
});

// Роут для виджета
app.get('/widget.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'widget.js'));
});

// Роут для manifest.json
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

// Роут для widget.html
app.get('/widget.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'widget.html'));
});

// Запуск сервера (ТОЛЬКО ОДИН РАЗ!)
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
