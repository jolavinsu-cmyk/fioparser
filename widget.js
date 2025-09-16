define(['jquery'], function($) {
  function parseFIO(fio) {
    var parts = fio.trim().split(/\s+/);
    var lastName = "", firstName = "", patronymic = "";

    function isPatronymic(word) { return /(вич|вна)$/i.test(word); }
    function isLastName(word) { return /(ов|ев|ин|ын|ский|цкий|ая|яя|кая)$/i.test(word); }

    parts.forEach(function(word) {
      if (!patronymic && isPatronymic(word)) patronymic = word;
      else if (!lastName && isLastName(word)) lastName = word;
      else if (!firstName) firstName = word;
    });

    return { lastName, firstName, patronymic };
  }

  return {
    init: function() {
      console.log("✅ FIO Parser Widget loaded");
      return true;
    },
    bind_actions: function() { return true; },
    render: function() {
      console.log("🎯 Render вызван", this);

      try {
        let entity = this.system().area; // контакт / сделка / компания
        console.log("📌 Открыта карточка:", entity);

        if (entity === "contacts") {
          let name = this.params().name || "";
          console.log("👤 Имя контакта:", name);

          if (name) {
            let parsed = parseFIO(name);
            console.log("🔎 Parsed FIO:", parsed);
          }
        }
      } catch (e) {
        console.error("❌ Ошибка в render:", e);
      }

      return true;
    }
  };
});
