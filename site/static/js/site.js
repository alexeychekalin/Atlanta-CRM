/* АТЛАНТА — сценарии сайта. Без зависимостей, ~6 КБ. */
(function () {
  'use strict';

  /* JS работает — включаем то, что без него не нужно (стрелки слайдера,
     фолбэк карты прячем) */
  document.documentElement.classList.remove('no-js');

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

  }

  /* ------------------------------------------------------------ галерея исполнения */
  /* В таблице исполнений строка с фотографиями кликабельна: открывается окно
     со всеми снимками этого исполнения — крупно, со стрелками, миниатюрами,
     клавиатурой (←/→, Esc) и свайпом на телефоне. */
  var photobox = null;
  var photoboxState = null;

  function buildPhotobox() {
    var overlay = document.createElement('div');
    overlay.className = 'photobox';
    overlay.innerHTML =
      '<div class="photobox__dialog" role="dialog" aria-modal="true" aria-label="Фотографии исполнения">' +
        '<div class="photobox__bar">' +
          '<div class="photobox__title"></div>' +
          '<div class="photobox__count" aria-live="polite"></div>' +
          '<button type="button" class="photobox__close" aria-label="Закрыть галерею">&times;</button>' +
        '</div>' +
        '<div class="photobox__stage">' +
          '<button type="button" class="photobox__nav photobox__nav--prev" aria-label="Предыдущее фото">' +
            '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>' +
          '</button>' +
          '<img class="photobox__img" alt="">' +
          '<button type="button" class="photobox__nav photobox__nav--next" aria-label="Следующее фото">' +
            '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="photobox__thumbs"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('.photobox__close').addEventListener('click', closePhotobox);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closePhotobox();
    });
    overlay.querySelector('.photobox__nav--prev').addEventListener('click', function () {
      showPhoto(photoboxState.index - 1);
    });
    overlay.querySelector('.photobox__nav--next').addEventListener('click', function () {
      showPhoto(photoboxState.index + 1);
    });
    overlay.querySelector('.photobox__thumbs').addEventListener('click', function (event) {
      var thumb = event.target.closest ? event.target.closest('[data-photobox-thumb]') : null;
      if (thumb) showPhoto(Number(thumb.getAttribute('data-photobox-thumb')) || 0);
    });

    /* свайп по фото на телефоне: влево — следующее, вправо — предыдущее */
    var startX = null;
    var stage = overlay.querySelector('.photobox__stage');
    stage.addEventListener('touchstart', function (event) {
      startX = event.touches[0].clientX;
    }, { passive: true });
    stage.addEventListener('touchend', function (event) {
      if (startX === null) return;
      var delta = event.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(delta) > 45) showPhoto(photoboxState.index + (delta < 0 ? 1 : -1));
    }, { passive: true });

    return overlay;
  }

  function showPhoto(index) {
    if (!photobox || !photoboxState) return;
    var total = photoboxState.photos.length;
    var current = ((index % total) + total) % total;
    var photo = photoboxState.photos[current];
    photoboxState.index = current;

    var image = photobox.querySelector('.photobox__img');
    image.src = photo.src;
    image.alt = photo.alt;
    photobox.querySelector('.photobox__title').textContent = photo.alt;
    photobox.querySelector('.photobox__count').textContent = total > 1 ? (current + 1) + ' / ' + total : '';

    var multi = total > 1;
    photobox.querySelectorAll('.photobox__nav').forEach(function (nav) {
      nav.style.display = multi ? '' : 'none';
    });
    photobox.querySelector('.photobox__thumbs').style.display = multi ? '' : 'none';
    photobox.querySelectorAll('[data-photobox-thumb]').forEach(function (thumb, i) {
      thumb.setAttribute('aria-current', String(i === current));
    });
  }

  function openPhotobox(photos, index, opener) {
    if (!photos || photos.length === 0) return;
    if (!photobox) photobox = buildPhotobox();
    photoboxState = { photos: photos, index: index || 0, opener: opener || null };

    photobox.querySelector('.photobox__thumbs').innerHTML = photos.map(function (photo, i) {
      return '<button type="button" class="photobox__thumb" data-photobox-thumb="' + i + '" ' +
        'aria-label="Фото ' + (i + 1) + '"><img src="' + photo.thumb + '" alt="" loading="lazy"></button>';
    }).join('');

    photobox.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    showPhoto(photoboxState.index);
    photobox.querySelector('.photobox__close').focus();
  }

  function closePhotobox() {
    if (!photobox) return;
    var opener = photoboxState && photoboxState.opener;
    photobox.classList.remove('is-open');
    document.body.style.overflow = '';
    photoboxState = null;
    if (opener && typeof opener.focus === 'function') opener.focus();
  }

  /* фокус не должен уходить из окна галереи по Tab */
  function trapPhotoboxFocus(event) {
    var items = Array.prototype.filter.call(
      photobox.querySelectorAll('button'),
      function (button) { return button.offsetParent !== null; }
    );
    if (items.length === 0) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', function (event) {
    if (!photobox || !photobox.classList.contains('is-open')) return;
    if (event.key === 'Escape') { closePhotobox(); return; }
    if (event.key === 'ArrowLeft') { showPhoto(photoboxState.index - 1); event.preventDefault(); return; }
    if (event.key === 'ArrowRight') { showPhoto(photoboxState.index + 1); event.preventDefault(); return; }
    if (event.key === 'Tab') trapPhotoboxFocus(event);
  });

  /* строка исполнения целиком: клик по миниатюре открывает галерею с неё */
  document.querySelectorAll('[data-mod-gallery]').forEach(function (row) {
    row.addEventListener('click', function (event) {
      var photos = Array.prototype.map.call(
        row.querySelectorAll('[data-photo-src]'),
        function (button) {
          var thumb = button.querySelector('img');
          return {
            src: button.getAttribute('data-photo-src'),
            alt: button.getAttribute('data-photo-alt') || '',
            thumb: thumb ? thumb.getAttribute('src') : button.getAttribute('data-photo-src')
          };
        }
      );
      if (photos.length === 0) return;
      var thumb = event.target.closest ? event.target.closest('[data-photo-index]') : null;
      var index = thumb ? (Number(thumb.getAttribute('data-photo-index')) || 0) : 0;
      // после закрытия фокус возвращается на кнопку: сама строка таблицы не фокусируется
      openPhotobox(photos, index, thumb || row.querySelector('.mods__article'));
    });
  });

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
  /* Заявка на несколько позиций: клиент набирает артикулы по каталогу
     (опт берёт 5–20 позиций за раз), список живёт в localStorage и
     отправляется вместе с формой. Цен на сайте нет — в заявке только
     артикул, название и количество. */
  var BASKET_KEY = 'atlanta_request_items';

  var readBasket = function () {
    try {
      var raw = window.localStorage.getItem(BASKET_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  };

  var writeBasket = function (list) {
    try { window.localStorage.setItem(BASKET_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
  };

  var basket = readBasket();

  var renderBasket = function () {
    var count = basket.reduce(function (sum, item) { return sum + (Number(item.quantity) || 1); }, 0);
    document.querySelectorAll('[data-basket-pill]').forEach(function (pill) {
      pill.hidden = basket.length === 0;
    });
    document.querySelectorAll('[data-basket-count]').forEach(function (el) {
      el.textContent = String(basket.length);
    });
    var slots = document.querySelector('[data-basket-slots]');
    if (slots) {
      if (basket.length === 0) {
        slots.hidden = true;
        slots.innerHTML = '';
      } else {
        slots.hidden = false;
        slots.innerHTML = '<div class="basket__head">Позиции в заявке (' + basket.length + ')</div>' +
          basket.map(function (item, index) {
            return '<div class="basket__row">' +
              '<span class="basket__article">' + escapeHtml(item.article) + '</span>' +
              '<span class="basket__name">' + escapeHtml(item.name || '') + '</span>' +
              '<label class="basket__qty">шт. <input type="number" min="1" max="9999" value="' +
                (Number(item.quantity) || 1) + '" data-basket-qty="' + index + '"></label>' +
              '<button type="button" class="basket__remove" data-basket-remove="' + index + '" ' +
                'title="Убрать из заявки">×</button>' +
            '</div>';
          }).join('');
      }
    }
    var input = document.querySelector('[data-basket-input]');
    if (input) input.value = basket.length ? JSON.stringify(basket.map(function (item) {
      return { article: item.article, name: item.name, quantity: Number(item.quantity) || 1 };
    })) : '';
    if (count === 0 && slots) slots.hidden = true;
  };

  var escapeHtml = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };

  document.querySelectorAll('[data-add-to-request]').forEach(function (button) {
    button.addEventListener('click', function () {
      var article = button.getAttribute('data-article') || '';
      var name = button.getAttribute('data-name') || '';
      var existing = basket.filter(function (item) { return item.article === article; })[0];
      if (existing) {
        existing.quantity = (Number(existing.quantity) || 1) + 1;
      } else {
        basket.push({ article: article, name: name, quantity: 1 });
      }
      writeBasket(basket);
      renderBasket();
      button.textContent = '✓ В заявке';
      setTimeout(function () { button.textContent = '+ В заявку'; }, 1400);
    });
  });

  document.addEventListener('click', function (event) {
    var remove = event.target.closest('[data-basket-remove]');
    if (remove) {
      basket.splice(Number(remove.getAttribute('data-basket-remove')), 1);
      writeBasket(basket);
      renderBasket();
      return;
    }
  });

  document.addEventListener('input', function (event) {
    var qty = event.target.closest('[data-basket-qty]');
    if (qty) {
      var index = Number(qty.getAttribute('data-basket-qty'));
      var value = Math.max(1, Math.min(9999, Number(qty.value) || 1));
      if (basket[index]) basket[index].quantity = value;
      writeBasket(basket);
      var input = document.querySelector('[data-basket-input]');
      if (input) input.value = JSON.stringify(basket);
    }
  });

  /* Файлы: показываем, что выбрано, и не даём приложить больше пяти */
  var filesInput = document.querySelector('#f-files');
  if (filesInput) {
    filesInput.addEventListener('change', function () {
      var list = document.querySelector('[data-files-list]');
      var files = Array.prototype.slice.call(filesInput.files || []);
      if (files.length > 5) {
        files = files.slice(0, 5);
        say('Можно приложить не больше 5 файлов — лишние отброшены.', true);
      }
      if (list) {
        list.innerHTML = files.map(function (file) {
          return '<span class="form__file">' + escapeHtml(file.name) + '</span>';
        }).join('');
      }
    });
  }

  var form = document.querySelector('[data-request-form]');
  var say = function (text, isError) {
    var note = form && form.querySelector('[data-form-note]');
    if (!note) return;
    note.textContent = text;
    note.style.color = isError ? '#ff9d8a' : '#f5a524';
  };

  if (form) {
    var endpoint = form.getAttribute('data-endpoint') || '';

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

      var items = readBasket();

      if (!endpoint) {
        var body = 'Заявка с сайта\n\nИмя: ' + data.name + '\nТелефон: ' + data.phone +
          (data.email ? '\nПочта: ' + data.email : '') +
          (data.article ? '\nАртикул: ' + data.article : '') +
          (data.message ? '\nСообщение: ' + data.message : '');
        if (items.length) {
          body += '\n\nПозиции:\n' + items.map(function (item) {
            return '  • ' + item.article + (item.name ? ' — ' + item.name : '') +
              (Number(item.quantity) > 1 ? ' × ' + item.quantity : '');
          }).join('\n');
        }
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

      // FormData, а не JSON: вместе с заявкой уходят фото детали.
      // Сервер принимает и JSON (старая сборка формы), и multipart.
      var payload = new FormData();
      Object.keys(data).forEach(function (key) { payload.append(key, data[key]); });
      if (items.length) payload.append('items', JSON.stringify(items));
      var files = filesInput ? filesInput.files : null;
      if (files) {
        Array.prototype.slice.call(files, 0, 5).forEach(function (file) {
          payload.append('files', file);
        });
      }

      fetch(endpoint, { method: 'POST', body: payload }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (result) {
          if (!response.ok) throw new Error(result.error || ('HTTP ' + response.status));
          return result;
        });
      }).then(function () {
        form.reset();
        basket = [];
        writeBasket(basket);
        renderBasket();
        var list = document.querySelector('[data-files-list]');
        if (list) list.innerHTML = '';
        say('Заявка отправлена. Свяжемся в рабочее время.');
      }).catch(function (error) {
        say(error.message || 'Не удалось отправить. Позвоните или напишите в Telegram — ссылки ниже.', true);
      }).finally(function () {
        if (button) button.disabled = false;
      });
    });
  }

  /* ---------------------------------------------- слайдер «Популярное» */
  /* Лента — обычная горизонтальная прокрутка: без JS карточки листаются
     пальцем. Скрипт добавляет кнопки и точки, а прокрутку подтягивает
     к границе карточки (scroll-snap делает то же самое для пальца). */
  document.querySelectorAll('[data-slider]').forEach(function (box) {
    var viewport = box.querySelector('.slider__viewport');
    var track = box.querySelector('.slider__track');
    var prev = box.querySelector('[data-slider-prev]');
    var next = box.querySelector('[data-slider-next]');
    var dots = box.querySelector('[data-slider-dots]');
    if (!viewport || !track || !prev || !next) return;

    var cards = Array.prototype.slice.call(track.children);
    if (cards.length < 2) {
      var nav = box.querySelector('.slider__nav');
      if (nav) nav.hidden = true;
      return;
    }

    /* ширина карточки вместе с промежутком */
    var step = function () {
      return cards[1].offsetLeft - cards[0].offsetLeft;
    };
    var perView = function () {
      return Math.max(1, Math.round(viewport.clientWidth / step()));
    };
    var pageCount = function () {
      return Math.max(1, Math.ceil(cards.length / perView()));
    };
    var currentIndex = function () {
      return Math.round(viewport.scrollLeft / step());
    };
    var goTo = function (index) {
      index = Math.max(0, Math.min(cards.length - 1, index));
      viewport.scrollTo({
        left: cards[index].offsetLeft - cards[0].offsetLeft,
        behavior: 'smooth'
      });
    };

    var paint = function () {
      prev.disabled = viewport.scrollLeft <= 2;
      next.disabled = viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 2;

      if (!dots) return;
      var count = pageCount();
      if (dots.childElementCount !== count) {
        dots.innerHTML = '';
        for (var i = 0; i < count; i += 1) {
          var dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'slider__dot';
          dot.setAttribute('data-slider-dot', String(i));
          dot.setAttribute('aria-label', 'Страница ' + (i + 1));
          dots.appendChild(dot);
        }
      }
      var active = Math.min(count - 1, Math.round(currentIndex() / perView()));
      Array.prototype.forEach.call(dots.children, function (dot, i) {
        dot.setAttribute('aria-current', i === active ? 'true' : 'false');
      });
    };

    prev.addEventListener('click', function () {
      goTo(currentIndex() - perView());
    });
    next.addEventListener('click', function () {
      goTo(currentIndex() + perView());
    });

    if (dots) {
      dots.addEventListener('click', function (event) {
        var dot = event.target.closest ? event.target.closest('[data-slider-dot]') : null;
        if (!dot) return;
        goTo(Number(dot.getAttribute('data-slider-dot')) * perView());
      });
    }

    viewport.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      goTo(currentIndex() + (event.key === 'ArrowRight' ? 1 : -1));
    });

    var ticking = false;
    viewport.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        ticking = false;
        paint();
      });
    });
    window.addEventListener('resize', paint);
    paint();
  });

  renderBasket();
})();
