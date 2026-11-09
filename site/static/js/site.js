/* АТЛАНТА — сценарии сайта. Без зависимостей, ~6 КБ. */
(function () {
  'use strict';

  /* ------------------------------------------------------------ меню */
  var burger = document.querySelector('.burger');
  var nav = document.querySelector('.nav');
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', String(!open));
      burger.setAttribute('aria-expanded', String(!open));
    });
    nav.addEventListener('click', function (event) {
      if (event.target.tagName === 'A') {
        nav.setAttribute('data-open', 'false');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ------------------------------------------------------------ появление блоков */
  var reveal = document.querySelectorAll('[data-reveal]');
  if (reveal.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    reveal.forEach(function (el) { io.observe(el); });
  } else {
    reveal.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ------------------------------------------------------------ галерея товара */
  var gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    var main = gallery.querySelector('[data-gallery-main]');
    var thumbs = gallery.querySelectorAll('[data-gallery-thumb]');

    var show = function (src, alt) {
      if (!src || !main) return;
      main.src = src;
      if (alt) main.alt = alt;
      thumbs.forEach(function (item) {
        item.setAttribute('aria-current', String(item.getAttribute('data-src') === src));
      });
    };

    thumbs.forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        show(thumb.getAttribute('data-src'), thumb.getAttribute('data-alt'));
      });
    });

    /* фото исполнения из таблицы: подставляем в галерею и, если она не на
       экране (телефон), подкручиваем к ней — иначе клик «ничего не делает» */
    if (main) {
      document.querySelectorAll('[data-gallery-jump]').forEach(function (button) {
        button.addEventListener('click', function () {
          show(button.getAttribute('data-src'), button.getAttribute('data-alt'));
          var box = main.getBoundingClientRect();
          if (box.top < 0 || box.bottom > window.innerHeight) {
            main.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      });
    }
  }

  /* ------------------------------------------------------------ поиск по каталогу */
  var search = document.querySelector('[data-catalog-search]');
  if (search) {
    var cards = Array.prototype.slice.call(document.querySelectorAll('[data-search-text]'));
    var counter = document.querySelector('[data-result-count]');
    var empty = document.querySelector('[data-empty]');
    var total = cards.length;

    /* латинские двойники кириллицы: «А.3776.001» набирают и латинской A, «БК-101» → «BK-101» */
    var FOLD = { a: 'а', b: 'б', c: 'с', e: 'е', h: 'н', k: 'к',
                 m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };
    var normalize = function (text) {
      return String(text).toLowerCase().replace(/ё/g, 'е')
        .replace(/[abcehkmoptxy]/g, function (ch) { return FOLD[ch] || ch; });
    };
    /* «бк101» и «БК-101» — одно и то же: разделители в артикулах не важны */
    var bare = function (text) { return text.replace(/[\s.\-_/]+/g, ''); };
    var searchText = cards.map(function (card) {
      return normalize(card.getAttribute('data-search-text') || '');
    });
    var searchBare = searchText.map(bare);

    var apply = function () {
      var query = normalize(search.value.trim());
      var bareQuery = bare(query);
      /* «а37» и «0201» ищем и без разделителей; короткие числовые — нет: «15» есть везде */
      var allowBare = bareQuery.length >= 4 || (bareQuery.length >= 2 && /[^\d]/.test(bareQuery));
      var shown = 0;
      cards.forEach(function (card, i) {
        var text = searchText[i];
        var hit = !query || text.indexOf(query) !== -1 ||
          (allowBare && searchBare[i].indexOf(bareQuery) !== -1);
        card.hidden = !hit;
        if (hit) shown += 1;
      });
      if (counter) {
        counter.textContent = query
          ? 'Найдено: ' + shown + ' из ' + total
          : 'Всего: ' + total;
      }
      if (empty) empty.hidden = shown !== 0;
    };

    var params = new URLSearchParams(window.location.search);
    if (params.get('q')) search.value = params.get('q');
    search.addEventListener('input', apply);
    apply();
  }

  /* ------------------------------------------------------------ заявка */
  var form = document.querySelector('[data-request-form]');
  if (form) {
    var note = form.querySelector('[data-form-note]');
    var endpoint = form.getAttribute('data-endpoint') || '';

    var say = function (text, isError) {
      if (!note) return;
      note.textContent = text;
      note.style.color = isError ? '#ff9d8a' : '#f5a524';
    };

    form.addEventListener('submit', function (event) {
      event.preventDefault();

      if (form.querySelector('[name="company"]').value) return;   // ловушка для ботов

      var data = {
        name: form.elements.name.value.trim(),
        phone: form.elements.phone.value.trim(),
        email: (form.elements.email && form.elements.email.value.trim()) || '',
        message: form.elements.message.value.trim(),
        article: form.getAttribute('data-article') || '',
        page: window.location.pathname,
        source: 'site'
      };

      if (!data.name || !data.phone) {
        say('Заполните имя и телефон — перезвоним и всё уточним.', true);
        return;
      }

      if (!endpoint) {
        var body = 'Заявка с сайта\n\nИмя: ' + data.name + '\nТелефон: ' + data.phone +
          (data.email ? '\nПочта: ' + data.email : '') +
          (data.article ? '\nАртикул: ' + data.article : '') +
          (data.message ? '\nСообщение: ' + data.message : '');
        var mailto = form.getAttribute('data-mailto') || '';
        say('Открываем письмо — отправьте его, и мы ответим в рабочее время.');
        window.location.href = 'mailto:' + mailto +
          '?subject=' + encodeURIComponent('Заявка с сайта') +
          '&body=' + encodeURIComponent(body);
        return;
      }

      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      say('Отправляем…');

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        form.reset();
        say('Заявка отправлена. Свяжемся в рабочее время.');
      }).catch(function () {
        say('Не удалось отправить. Позвоните или напишите в Telegram — ссылки ниже.', true);
      }).finally(function () {
        if (button) button.disabled = false;
      });
    });
  }
})();
