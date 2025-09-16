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
});