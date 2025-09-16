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
    render: function() { return true; },
    contacts: {
      selected: function() {
        console.log("🔔 Contact opened:", AMOCRM.data.current_card);

        var contact = AMOCRM.data.current_card.attributes || AMOCRM.data.current_card.model?.attributes;

        if (contact?.name) {
          var parsed = parseFIO(contact.name);
          console.log("🔎 Parsed FIO:", parsed);
        } else {
          console.warn("⚠️ Не удалось найти contact.name");
        }
      }
    }
  };
});
