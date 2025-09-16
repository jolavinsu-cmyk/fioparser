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

    // Получение данных текущего контакта
    async function getCurrentContact() {
        return new Promise((resolve) => {
            // Способ 1: Пытаемся получить из amoCRM API
            if (typeof Amo !== 'undefined' && Amo?.currentCard) {
                console.log('Getting contact from Amo API');
                resolve(Amo.currentCard.entity);
                return;
            }

            // Способ 2: Парсим из DOM
            setTimeout(() => {
                console.log('Trying to parse contact from DOM...');
                
                // Ищем поле "Имя" в форме контакта
                const nameInput = document.querySelector('input[name="name"]') || 
                                 document.querySelector('[data-name="name"]') ||
                                 document.querySelector('[data-field-name="name"]');
                
                // Ищем заголовок карточки контакта
                const cardTitle = document.querySelector('.card-header h1') || 
                                 document.querySelector('.contact-name') ||
                                 document.querySelector('[data-qa="contact-name"]');

                if (nameInput && nameInput.value) {
                    console.log('Found name in input field:', nameInput.value);
                    resolve({ name: nameInput.value.trim() });
                } else if (cardTitle && cardTitle.textContent) {
                    console.log('Found name in title:', cardTitle.textContent);
                    resolve({ name: cardTitle.textContent.trim() });
                } else {
                    // Способ 3: Ручной ввод
                    console.log('Contact not found in DOM');
                    resolve(null);
                }
            }, 1000);
        });
    }

    // Обновление контакта в CRM
    async function updateContactInCRM(data) {
        return new Promise((resolve) => {
            console.log('Updating contact with:', data);
            
            // Способ 1: Через amoCRM API (если доступен)
            if (typeof Amo !== 'undefined' && Amo?.api && currentContactData?.id) {
                Amo.api.update('contacts', currentContactData.id, {
                    last_name: data.lastName || '',
                    first_name: data.firstName + (data.middleName ? ' ' + data.middleName : '')
                })
                .then(() => {
                    console.log('Contact updated via API');
                    resolve(true);
                })
                .catch((error) => {
                    console.error('API update error:', error);
                    resolve(false);
                });
                return;
            }

            // Способ 2: Ручное обновление через DOM
            setTimeout(() => {
                // Ищем поле фамилии
                const lastNameField = document.querySelector('input[name="last_name"]') || 
                                     document.querySelector('[data-name="last_name"]');
                
                // Ищем поле имени
                const firstNameField = document.querySelector('input[name="first_name"]') || 
                                      document.querySelector('[data-name="first_name"]');

                if (lastNameField && firstNameField) {
                    // Заполняем поля
                    lastNameField.value = data.lastName || '';
                    firstNameField.value = (data.firstName || '') + (data.middleName ? ' ' + data.middleName : '');
                    
                    // Триггерим изменение для amoCRM
                    lastNameField.dispatchEvent(new Event('change', { bubbles: true }));
                    firstNameField.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    console.log('Fields updated via DOM');
                    resolve(true);
                } else {
                    // Способ 3: Показываем результат для ручного копирования
                    const resultText = `Фамилия: ${data.lastName || ''}\nИмя: ${data.firstName || ''} ${data.middleName || ''}`;
                    alert('Скопируйте данные и вставьте вручную:\n\n' + resultText);
                    resolve(true);
                }
            }, 500);
        });
    }

    // Парсинг текущего контакта
    window.parseCurrentContact = async function() {
        try {
            showStatus('Ищем данные контакта...', 'info');
            
            let contact = await getCurrentContact();
            if (!contact || !contact.name) {
                // Предлагаем ручной ввод
                const manualName = prompt('Введите ФИО для парсинга:');
                if (!manualName) {
                    showStatus('Отменено пользователем', 'info');
                    return;
                }
                contact = { name: manualName.trim() };
            }

            currentContactData = contact;
            document.getElementById('fullNameInput').value = contact.name;
            
            parsedData = await parseFIO(contact.name);
            if (parsedData) {
                updatePreview(parsedData);
                showStatus('Готово! Нажмите "Применить"', 'success');
            }
        } catch (error) {
            console.error('Error:', error);
            showStatus('Ошибка: ' + error.message, 'error');
        }
    };

    // Применение данных к amoCRM
    window.applyToCRM = async function() {
        if (!parsedData) {
            showStatus('Сначала распарсьте ФИО', 'error');
            return;
        }

        try {
            showStatus('Обновляем данные в amoCRM...', 'info');
            
            const success = await updateContactInCRM(parsedData);
            
            if (success) {
                showStatus('Данные успешно обновлены!', 'success');
                // Обновляем страницу через 2 секунды
                setTimeout(() => location.reload(), 2000);
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
        document.getElementById('lastNameResult').textContent = data.lastName || 'не указана';
        document.getElementById('firstNameResult').textContent = data.firstName || 'не указано';
        document.getElementById('middleNameResult').textContent = data.middleName || 'не указано';
    }

    function showStatus(message, type) {
        const statusEl = document.getElementById('statusMessage');
        statusEl.textContent = message;
        statusEl.className = `status-message status-${type}`;
    }

    // Инициализация
    window.addEventListener('amoready', function() {
        console.log('✅ FIOParser Widget initialized in amoCRM');
        showStatus('Виджет загружен. Нажмите "Распарсить"', 'info');
    });

    // Автопарсинг при изменении поля ввода
    const nameInput = document.getElementById('fullNameInput');
    if (nameInput) {
        nameInput.addEventListener('input', async function(e) {
            const fullName = e.target.value;
            if (fullName.length > 2) {
                parsedData = await parseFIO(fullName);
                if (parsedData) {
                    updatePreview(parsedData);
                }
            }
        });
    }

    console.log('✅ FIOParser Widget loaded successfully');

})();
