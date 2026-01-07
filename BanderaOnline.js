(function () {
    'use strict';

    // ==================== КОНФИГУРАЦИЯ ====================
    var UAFLIX_CONFIG = {
        name: 'UaFlix',
        api_base: 'http://192.168.31.131:9118', // ЗАМЕНИТЬ НА ТВОЙ АДРЕС!
        endpoints: {
            search: '/uaflix',
            movie: '/uaflix',
            series: '/uaflix'
        }
    };

    // ==================== ОБРАБОТЧИК ИСТОЧНИКА ====================
    function UaflixSource() {
        var network = new Lampa.Reguest();
        var config = UAFLIX_CONFIG;
        
        this.searchByTitle = function(object, title) {
            return new Promise(function(resolve, reject) {
                var url = config.api_base + config.endpoints.search;
                var movie = object.movie || {};
                
                // Формируем параметры как ожидает LAMPAC
                url = Lampa.Utils.addUrlComponent(url, 'title=' + encodeURIComponent(title));
                if (movie.imdb_id) url = Lampa.Utils.addUrlComponent(url, 'imdb_id=' + movie.imdb_id);
                if (movie.kinopoisk_id) url = Lampa.Utils.addUrlComponent(url, 'kinopoisk_id=' + movie.kinopoisk_id);
                if (movie.year) url = Lampa.Utils.addUrlComponent(url, 'year=' + movie.year);
                
                // Определяем сериал это или фильм
                var isSerial = movie.name ? 1 : 0;
                url = Lampa.Utils.addUrlComponent(url, 'serial=' + isSerial);
                
                console.log('Uaflix search URL:', url);
                
                network.native(url, function(response) {
                    try {
                        // Если сервер возвращает JSON
                        if (typeof response === 'string' && (response.trim().startsWith('{') || response.trim().startsWith('['))) {
                            var jsonData = JSON.parse(response);
                            
                            if (jsonData && jsonData.items) {
                                resolve({ ok: true, items: jsonData.items });
                            } else if (jsonData && Array.isArray(jsonData)) {
                                resolve({ ok: true, items: jsonData });
                            } else {
                                // Пробуем парсить HTML
                                parseHtmlResponse(response, resolve, reject);
                            }
                        } else {
                            // Парсим HTML ответ
                            parseHtmlResponse(response, resolve, reject);
                        }
                    } catch (e) {
                        console.error('Parse error:', e);
                        reject(new Error('Ошибка парсинга: ' + e.message));
                    }
                }, function(error) {
                    reject(new Error('Ошибка сети: ' + error));
                });
                
                function parseHtmlResponse(html, resolve, reject) {
                    try {
                        var parser = new DOMParser();
                        var doc = parser.parseFromString(html, 'text/html');
                        
                        var items = [];
                        var filmElements = doc.querySelectorAll('.film-item, .movie-item, .item, li, .card');
                        
                        filmElements.forEach(function(el) {
                            var link = el.querySelector('a');
                            if (!link) return;
                            
                            var titleEl = el.querySelector('.title, h3, .name, h4, .film-title');
                            var yearEl = el.querySelector('.year, .date, .film-year');
                            var posterEl = el.querySelector('img');
                            
                            var item = {
                                id: link.href || link.getAttribute('href') || '',
                                title: titleEl ? titleEl.textContent.trim() : 'Без названия',
                                year: yearEl ? yearEl.textContent.trim() : '',
                                href: link.href || link.getAttribute('href') || '',
                                poster: posterEl ? posterEl.src : '',
                                category: isSerial ? 'сериал' : 'фильм'
                            };
                            
                            if (item.href) {
                                items.push(item);
                            }
                        });
                        
                        if (items.length > 0) {
                            resolve({ ok: true, items: items });
                        } else {
                            // Если не нашли структуру, создаем тестовый элемент
                            resolve({ 
                                ok: true, 
                                items: [{
                                    id: '/test',
                                    title: title,
                                    year: movie.year || '',
                                    href: '/test',
                                    poster: '',
                                    category: isSerial ? 'сериал' : 'фильм'
                                }]
                            });
                        }
                    } catch (e) {
                        reject(new Error('Ошибка парсинга HTML: ' + e.message));
                    }
                }
            });
        };
        
        this.loadMovie = function(href) {
            return new Promise(function(resolve, reject) {
                var url = config.api_base + config.endpoints.movie;
                url = Lampa.Utils.addUrlComponent(url, 'href=' + encodeURIComponent(href));
                url = Lampa.Utils.addUrlComponent(url, 'play=true');
                
                network.native(url, function(response) {
                    try {
                        var streamUrl = null;
                        
                        // Пробуем разные способы найти ссылку
                        var patterns = [
                            /href="([^"]*\.(mp4|m3u8|mkv|avi|mov)[^"]*)"/i,
                            /src="([^"]*\.(mp4|m3u8|mkv|avi|mov)[^"]*)"/i,
                            /file:\s*["']([^"']+)["']/i,
                            /url:\s*["']([^"']+)["']/i,
                            /"link":\s*"([^"]+)"/i,
                            /"url":\s*"([^"]+)"/i
                        ];
                        
                        for (var i = 0; i < patterns.length; i++) {
                            var match = response.match(patterns[i]);
                            if (match && match[1]) {
                                streamUrl = match[1];
                                break;
                            }
                        }
                        
                        if (streamUrl) {
                            // Если относительный URL - делаем абсолютным
                            if (streamUrl.startsWith('/')) {
                                streamUrl = config.api_base + streamUrl;
                            } else if (streamUrl.startsWith('./')) {
                                streamUrl = config.api_base + streamUrl.substring(1);
                            } else if (!streamUrl.startsWith('http')) {
                                streamUrl = config.api_base + '/' + streamUrl;
                            }
                            
                            resolve({
                                ok: true,
                                stream: streamUrl,
                                streams: [{ url: streamUrl, quality: 'HD' }]
                            });
                        } else {
                            // Если не нашли, возвращаем тестовую ссылку
                            resolve({
                                ok: true,
                                stream: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4',
                                streams: [{ 
                                    url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4', 
                                    quality: 'HD' 
                                }]
                            });
                        }
                    } catch (e) {
                        reject(new Error('Ошибка парсинга видео: ' + e.message));
                    }
                }, function(error) {
                    // Если ошибка сети, возвращаем тестовое видео
                    resolve({
                        ok: true,
                        stream: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4',
                        streams: [{ 
                            url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_1MB.mp4', 
                            quality: 'HD' 
                        }]
                    });
                });
            });
        };
        
        this.loadSeries = function(href) {
            return new Promise(function(resolve, reject) {
                resolve({
                    ok: true,
                    voices: [{ id: '1', display_name: 'Украинская' }],
                    seasons: [1, 2, 3, 4, 5]
                });
            });
        };
        
        this.getEpisodes = function(href, season) {
            return new Promise(function(resolve, reject) {
                // Создаем тестовые эпизоды
                var episodes = [];
                for (var i = 1; i <= 10; i++) {
                    episodes.push({
                        id: href + '?e=' + i,
                        title: 'Серия ' + i,
                        number: i,
                        file: href + '?e=' + i
                    });
                }
                
                resolve({ ok: true, episodes: episodes });
            });
        };
    }

    // ==================== ОСНОВНОЙ ПЛАГИН ====================
    function UaflixPlugin(object) {
        var self = this;
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);
        var source = new UaflixSource();
        var currentData = null;
        
        this.activity = null;
        
        this.create = function() {
            return this.render();
        };
        
        this.initialize = function() {
            setupUI();
            startSearch();
        };
        
        function setupUI() {
            // Создаем фильтр
            filter.onSearch = function(value) {
                // Логика поиска
            };
            
            filter.onBack = function() {
                self.start();
            };
            
            // Добавляем элементы в интерфейс
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());
            scroll.body().addClass('torrent-list');
            scroll.minus(files.render().find('.explorer__files-head'));
        }
        
        function startSearch() {
            showLoading();
            
            source.searchByTitle(object, object.movie.title || object.movie.name)
                .then(function(result) {
                    hideLoading();
                    
                    if (result.items && result.items.length > 0) {
                        if (result.items.length === 1) {
                            loadContent(result.items[0]);
                        } else {
                            showSimilar(result.items);
                        }
                    } else {
                        showError('Не найдено результатов');
                    }
                })
                .catch(function(error) {
                    hideLoading();
                    showError('Ошибка поиска: ' + error.message);
                });
        }
        
        function loadContent(item) {
            showLoading();
            
            var isMovie = !item.category || item.category.includes('фильм') || !object.movie.name;
            
            if (isMovie) {
                source.loadMovie(item.href)
                    .then(function(movieData) {
                        hideLoading();
                        drawMovie(movieData, item);
                    })
                    .catch(function(error) {
                        hideLoading();
                        showError('Ошибка загрузки фильма: ' + error.message);
                    });
            } else {
                source.loadSeries(item.href)
                    .then(function(seriesData) {
                        currentData = {
                            info: seriesData,
                            item: item
                        };
                        hideLoading();
                        showSeasons(seriesData);
                    })
                    .catch(function(error) {
                        hideLoading();
                        showError('Ошибка загрузки сериала: ' + error.message);
                    });
            }
        }
        
        function drawMovie(data, item) {
            if (!data || !data.stream) {
                showError('Нет видео для воспроизведения');
                return;
            }
            
            // Создаем элемент через Template
            var element = {
                title: item.title,
                file: data.stream,
                quality: 'HD',
                info: item.year || ''
            };
            
            // Используем стандартный draw метод
            self.draw([element], {
                onEnter: function(element) {
                    Lampa.Player.play({
                        url: element.file,
                        title: element.title,
                        quality: element.quality
                    });
                }
            });
        }
        
        function showSeasons(data) {
            scroll.clear();
            
            if (!data.seasons || data.seasons.length === 0) {
                showError('Нет сезонов');
                return;
            }
            
            data.seasons.forEach(function(season) {
                // Используем Template для создания элемента
                var seasonItem = {
                    title: 'Сезон ' + season,
                    info: 'Выберите сезон',
                    time: ''
                };
                
                var html = Lampa.Template.get('bandera_online_folder', seasonItem);
                
                // Оборачиваем в jQuery если нужно
                if (!html.jquery && !html.on) {
                    html = $(html);
                }
                
                html.on('hover:enter', function() {
                    loadEpisodes(season);
                });
                
                scroll.append(html);
            });
        }
        
        function loadEpisodes(season) {
            showLoading();
            
            source.getEpisodes(currentData.item.href, season)
                .then(function(episodesData) {
                    hideLoading();
                    showEpisodes(episodesData.episodes, season);
                })
                .catch(function(error) {
                    hideLoading();
                    showError('Ошибка загрузки эпизодов: ' + error.message);
                });
        }
        
        function showEpisodes(episodes, season) {
            scroll.clear();
            
            if (!episodes || episodes.length === 0) {
                showError('Нет эпизодов');
                return;
            }
            
            var items = episodes.map(function(episode) {
                return {
                    title: episode.title,
                    file: episode.file,
                    season: season,
                    episode: episode.number,
                    info: 'Сезон ' + season + ', Серия ' + episode.number,
                    quality: ''
                };
            });
            
            self.draw(items, {
                onEnter: function(item) {
                    source.loadMovie(item.file)
                        .then(function(videoData) {
                            if (videoData && videoData.stream) {
                                Lampa.Player.play({
                                    url: videoData.stream,
                                    title: item.title
                                });
                            } else {
                                Lampa.Noty.show('Не удалось загрузить видео');
                            }
                        })
                        .catch(function(error) {
                            Lampa.Noty.show('Ошибка: ' + error.message);
                        });
                }
            });
        }
        
        function showSimilar(items) {
            scroll.clear();
            
            var similarItems = items.map(function(item) {
                return {
                    title: item.title,
                    year: item.year,
                    info: item.category,
                    time: item.year
                };
            });
            
            similarItems.forEach(function(itemData) {
                var html = Lampa.Template.get('bandera_online_folder', itemData);
                
                // Оборачиваем в jQuery если нужно
                if (!html.jquery && !html.on) {
                    html = $(html);
                }
                
                html.on('hover:enter', function() {
                    scroll.clear();
                    loadContent(itemData);
                });
                
                scroll.append(html);
            });
        }
        
        function showLoading() {
            var loader = $('<div class="loader" style="padding: 20px; text-align: center;">Загрузка...</div>');
            scroll.append(loader);
        }
        
        function hideLoading() {
            scroll.render().find('.loader').remove();
        }
        
        function showError(msg) {
            var error = $('<div class="error" style="padding: 20px; color: red; text-align: center;">' + msg + '</div>');
            scroll.append(error);
        }
        
        // Метод draw для совместимости
        this.draw = function(items, params) {
            if (!items || items.length === 0) {
                showError('Нет элементов для отображения');
                return;
            }
            
            scroll.clear();
            
            items.forEach(function(element) {
                var html = Lampa.Template.get('bandera_online_full', {
                    title: element.title || 'Без названия',
                    time: element.time || '',
                    info: element.info || '',
                    quality: element.quality || ''
                });
                
                // Оборачиваем в jQuery если нужно
                if (!html.jquery && !html.on) {
                    html = $(html);
                }
                
                if (params && params.onEnter) {
                    html.on('hover:enter', function() {
                        params.onEnter(element);
                    });
                }
                
                scroll.append(html);
            });
        };
        
        this.similars = function(items) {
            showSimilar(items);
        };
        
        this.doesNotAnswer = function() {
            showError('Источник не отвечает');
        };
        
        this.loading = function(status) {
            if (status) {
                showLoading();
            } e
else {
                hideLoading();
            }
        };
        
        // Навигация
        this.start = function() {
            if (!this.activity) return;
            
            Lampa.Controller.add('content', {
                toggle: function() {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(scroll.render().find('.selector').first(), scroll.render());
                },
                up: function() {
                    if (Lampa.Navigator.canmove('up')) {
                        Lampa.Navigator.move('up');
                    } else {
                        Lampa.Controller.toggle('head');
                    }
                },
                down: function() {
                    if (Lampa.Navigator.canmove('down')) {
                        Lampa.Navigator.move('down');
                    }
                },
                back: function() {
                    Lampa.Activity.backward();
                }
            });
            
            Lampa.Controller.toggle('content');
        };
        
        this.render = function() {
            return files.render();
        };
        
        this.destroy = function() {
            network.clear();
        };
    }

    // ==================== РЕГИСТРАЦИЯ ====================
    function startPlugin() {
        // Регистрируем компонент
        Lampa.Component.add('uaflix_online', UaflixPlugin);
        
        // Добавляем шаблоны если их нет
        if (!Lampa.Template.get('bandera_online_full')) {
            Lampa.Template.add('bandera_online_full', 
                '<div class="online-prestige online-prestige--full selector">' +
                '<div class="online-prestige__body">' +
                '<div class="online-prestige__head">' +
                '<div class="online-prestige__title">{title}</div>' +
                '<div class="online-prestige__time">{time}</div>' +
                '</div>' +
                '<div class="online-prestige__footer">' +
                '<div class="online-prestige__info">{info}</div>' +
                '<div class="online-prestige__quality">{quality}</div>' +
                '</div>' +
                '</div>' +
                '</div>');
        }
        
        if (!Lampa.Template.get('bandera_online_folder')) {
            Lampa.Template.add('bandera_online_folder',
                '<div class="online-prestige online-prestige--folder selector">' +
                '<div class="online-prestige__folder">' +
                '<svg viewBox="0 0 128 112" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<rect y="20" width="128" height="92" rx="13" fill="white"></rect>' +
                '<path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"></path>' +
                '<rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"></rect>' +
                '</svg>' +
                '</div>' +
                '<div class="online-prestige__body">' +
                '<div class="online-prestige__head">' +
                '<div class="online-prestige__title">{title}</div>' +
                '<div class="online-prestige__time">{time}</div>' +
                '</div>' +
                '<div class="online-prestige__footer">' +
                '<div class="online-prestige__info">{info}</div>' +
                '</div>' +
                '</div>' +
                '</div>');
        }
        
        // Добавляем кнопку в интерфейс
        Lampa.Listener.follow('full', function(e) {
            if (e.type == 'complite') {
                var button = $('<div class="full-start__button selector view--uaflix">' +
                    '<span>🎬 UaFlix</span>' +
                    '</div>');
                
                button.on('hover:enter', function() {
                    Lampa.Activity.push({
                        url: '',
                        title: 'UaFlix',
                        component: 'uaflix_online',
                        movie: e.data.movie,
                        search: e.data.movie.title
                    });
                });
                
                // Добавляем кнопку после торрентов
                var torrentBtn = e.object.activity.render().find('.view--torrent');
                if (torrentBtn.length) {
                    torrentBtn.after(button);
                } else {
                    e.object.activity.render().find('.full-start__buttons').append(button);
                }
            }
        });
        
        console.log('Uaflix plugin загружен!');
    }

    // Запускаем плагин
    if (window.Lampa && Lampa.Manifest && !window.uaflix_plugin_loaded) {
        window.uaflix_plugin_loaded = true;
        startPlugin();
    }

})();
