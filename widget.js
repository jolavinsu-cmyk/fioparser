(function() {
    console.log('🚀 FIOParser Widget loading...');
    
    let currentContactData = null;
    let parsedData = null;

    // Функция для скрытия виджета
    window.hideWidget = function() {
        const widget = document.querySelector('.fioparser-widget');
        if (widget) {
            widget.style.display = 'none';
        }
    };

    // Парсинг ФИО через сервер
    window.parseFIO = async function(fullName) {
        try {
            const response = await fetch('https://fioparser.onrender.com/api/parse', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ fullName })
            });

            if (!response.ok) {
                throw new Error('Server error');
            }

            const result = await response.json();
            return result.data;
        } catch (error) {
            console.error('Parse error:', error);
            showStatus('Ошибка подключения к серверу', 'error');
            return null;
        }
    };

    // Парсинг текущего контакта
    window.parseCurrentContact = async function() {
        try {
            showStatus('Загрузка данных контакта...', 'info');
            
            // Получаем данные текущего контакта из amoCRM API
            const contact = await getCurrentContact();
            if (!contact || !contact.name) {
                showStatus('Не удалось получить данные контакта', 'error');
                return;
            }

            currentContactData = contact;
            document.getElementById('fullNameInput').value = contact.name;
            
            // Парсим ФИО
            parsedData = await parseFIO(contact.name);
            if (parsedData) {
                updatePreview(parsedData);
                showStatus('ФИО успешно распарсено!', 'success');
            }
        } catch (error) {
            console.error('Error:', error);
            showStatus('Ошибка: ' + error.message, 'error');
        }
    };

    // Применение данных к amoCRM
    window.applyToCRM = async function() {
        if (!parsedData || !currentContactData) {
            showStatus('Сначала распарсьте контакт', 'error');
            return;
        }

        try {
            showStatus('Обновление данных в amoCRM...', 'info');
            
            // Обновляем данные в amoCRM через API
            const success = await updateContactInCRM(parsedData);
            
            if (success) {
                showStatus('Данные успешно обновлены!', 'success');
                // Обновляем интерфейс
                setTimeout(() => location.reload(), 1000);
            } else {
                showStatus('Ошибка обновления данных', 'error');
            }
        } catch (error) {
            console.error('Apply error:', error);
            showStatus('Ошибка: ' + error.message, 'error');
        }
    };

    // Вспомогательные функции
    function updatePreview(data) {
        document.getElementById('lastNameResult').textContent = data.lastName || '-';
        document.getElementById('firstNameResult').textContent = data.firstName || '-';
        document.getElementById('middleNameResult').textContent = data.middleName || '-';
    }

    function showStatus(message, type) {
        const statusEl = document.getElementById('statusMessage');
        statusEl.textContent = message;
        statusEl.className = `status-message status-${type}`;
    }

    // Работа с amoCRM API
    async function getCurrentContact() {
        return new Promise((resolve) => {
            if (typeof Amo !== 'undefined' && Amo?.currentCard) {
                resolve(Amo.currentCard.entity);
            } else {
                // Fallback: пытаемся получить данные из DOM
                setTimeout(() => {
                    const contactName = document.querySelector('[data-name="name"]')?.value || 
                                      document.querySelector('.card-header h1')?.textContent;
                    resolve(contactName ? { name: contactName.trim() } : null);
                }, 1000);
            }
        });
    }

    async function updateContactInCRM(data) {
        return new Promise((resolve) => {
            if (typeof Amo !== 'undefined') {
                // Обновляем через amoCRM API
                const updateData = {
                    last_name: data.lastName,
                    first_name: data.firstName + (data.middleName ? ' ' + data.middleName : '')
                };
                
                Amo.api.update('contacts', currentContactData.id, updateData)
                    .then(() => resolve(true))
                    .catch(() => resolve(false));
            } else {
                // Fallback для демонстрации
                console.log('Would update CRM with:', data);
                setTimeout(() => resolve(true), 1000);
            }
        });
    }

    // Инициализация
    window.addEventListener('amoready', function() {
        console.log('✅ FIOParser Widget initialized in amoCRM');
        showStatus('Виджет загружен. Выберите контакт для парсинга.', 'info');
    });

    // Автопарсинг при изменении поля
    document.getElementById('fullNameInput')?.addEventListener('input', async function(e) {
        const fullName = e.target.value;
        if (fullName.length > 2) {
            parsedData = await parseFIO(fullName);
            if (parsedData) {
                updatePreview(parsedData);
            }
        }
    });

})();
