import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Отдаём статические файлы
app.use(express.static(__dirname));

// Тестовая страница
app.get("/support", (req, res) => {
  res.send("<h2>FIO Parser Widget Support</h2><p>Виджет работает!</p>");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);

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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
});
