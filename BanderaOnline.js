(function () {
    'use strict';

    // ==================== КОНФІГУРАЦІЯ ====================
    var UAFLIX_CONFIG = {
        name: 'UaFlix',
        api_base: 'http://ВАШ_СЕРВЕР:9118', // ЗАМІНИТИ НА ТВІЙ АДРЕС!
        endpoints: {
            search: '/uaflix',
            movie: '/uaflix',
            series: '/uaflix'
        }
    };

    // ==================== ОБРОБНИК ДЖЕРЕЛА ====================
    function UaflixSource() {
        var network = new Lampa.Reguest();
        var config = UAFLIX_CONFIG;
        
        this.searchByTitle = function(object, title) {
            return new Promise(function(resolve, reject) {
                var url = config.api_base + config.endpoints.search;
                var movie = object.movie || {};
                
                // Формуємо параметри як очікує LAMPAC
                url = Lampa.Utils.addUrlComponent(url, 'title=' + encodeURIComponent(title));
                if (movie.imdb_id) url = Lampa.Utils.addUrlComponent(url, 'imdb_id=' + movie.imdb_id);
                if (movie.kinopoisk_id) url = Lampa.Utils.addUrlComponent(url, 'kinopoisk_id=' + movie.kinopoisk_id);
                if (movie.year) url = Lampa.Utils.addUrlComponent(url, 'year=' + movie.year);
                
                // Визначаємо серіал це чи фільм
                var isSerial = movie.name ? 1 : 0;
                url = Lampa.Utils.addUrlComponent(url, 'serial=' + isSerial);
                
                console.log('Uaflix search URL:', url);
                
                network.native(url, function(response) {
                    try {
                        // LAMPAC повертає HTML, потрібно парсити
                        var parser = new DOMParser();
                        var doc = parser.parseFromString(response, 'text/html');
                        
                        // Шукаємо всі елементи фільмів
                        var items = [];
                        var filmElements = doc.querySelectorAll('.film-item, .movie-item, .item');
                        
                        filmElements.forEach(function(el) {
                            var link = el.querySelector('a');
                            var titleEl = el.querySelector('.title, h3, .name');
                            var yearEl = el.querySelector('.year, .date');
                            var posterEl = el.querySelector('img');
                            
                            if (link && titleEl) {
                                items.push({
                                    id: link.href || link.getAttribute('href'),
                                    title: titleEl.textContent.trim(),
                                    year: yearEl ? yearEl.textContent.trim() : '',
                                    href: link.href || link.getAttribute('href'),
                                    poster: posterEl ? posterEl.src : '',
                                    category: isSerial ? 'серіал' : 'фільм'
                                });
                            }
                        });
                        
                        if (items.length > 0) {
                            resolve({ ok: true, items: items });
                        } else {
                            reject(new Error('Не знайдено результатів'));
                        }
                    } catch (e) {
                        reject(new Error('Помилка парсингу: ' + e.message));
                    }
                }, function(error) {
                    reject(new Error('Помилка мережі: ' + error));
                });
            });
        };
        
        this.loadMovie = function(href) {
            return new Promise(function(resolve, reject) {
                var url = config.api_base + config.endpoints.movie;
                url = Lampa.Utils.addUrlComponent(url, 'href=' + encodeURIComponent(href));
                url = Lampa.Utils.addUrlComponent(url, 'play=true');
                
                network.native(url, function(response) {
                    try {
                        // Парсимо посилання на відео
                        var match = response.match(/href="([^"]*\.(mp4|m3u8|mkv)[^"]*)"/i) ||
                                   response.match(/src="([^"]*\.(mp4|m3u8|mkv)[^"]*)"/i) ||
                                   response.match(/file:\s*"([^"]+)"/i);
                        
                        if (match && match[1]) {
                            var streamUrl = match[1];
                            // Якщо відносний URL - робимо абсолютним
                            if (streamUrl.startsWith('/')) {
                                streamUrl = config.api_base + streamUrl;
                            }
                            
                            resolve({
                                ok: true,
                                stream: streamUrl,
                                streams: [{ url: streamUrl, quality: 'HD' }]
                            });
                        } else {
                            reject(new Error('Не вдалося знайти посилання на відео'));
                        }
                    } catch (e) {
                        reject(new Error('Помилка парсингу відео: ' + e.message));
                    }
                }, reject);
            });
        };
        
        this.loadSeries = function(href) {
            return new Promise(function(resolve, reject) {
                var url = config.api_base + config.endpoints.series;
                url = Lampa.Utils.addUrlComponent(url, 'href=' + encodeURIComponent(href));
                
                network.native(url, function(response) {
                    try {
                        var parser = new DOMParser();
                        var doc = parser.parseFromString(response, 'text/html');
                        
                        // Шукаємо сезони та серії
                        var result = {
                            ok: true,
                            voices: [],
                            seasons: []
                        };
                        
                        // Парсимо озвучки
                        var voiceElements = doc.querySelectorAll('.voice-select option, .dubbing-item');
                        voiceElements.forEach(function(el, index) {
                            var voiceName = el.textContent.trim() || 'Озвучка ' + (index + 1);
                            result.voices.push({
                                id: el.value || index.toString(),
                                display_name: voiceName
                            });
                        });
                        
                        // Парсимо сезони
                        var seasonElements = doc.querySelectorAll('.season-select option, .season-item');
                        seasonElements.forEach(function(el) {
                            var seasonText = el.textContent.trim();
                            var seasonMatch = seasonText.match(/Сезон\s*(\d+)/i) || seasonText.match(/(\d+)/);
                            if (seasonMatch) {
                                result.seasons.push(parseInt(seasonMatch[1]));
                            }
                        });
                        
                        // Сортуємо сезони
                        result.seasons.sort(function(a, b) { return a - b; });
                        
                        if (result.seasons.length > 0) {
                            resolve(result);
                        } else {
                            // Якщо не знайшли структуру, припускаємо 1 сезон
                            result.seasons = [1];
                            resolve(result);
                        }
                    } catch (e) {
                        reject(new Error('Помилка парсингу серіалу: ' + e.message));
                    }
                }, reject);
            });
        };
        
        this.getEpisodes = function(href, season, voice) {
            return new Promise(function(resolve, reject) {
                var url = config.api_base + '/uaflix';
                url = Lampa.Utils.addUrlComponent(url, 'href=' + encodeURIComponent(href));
                url = Lampa.Utils.addUrlComponent(url, 's=' + season);
                if (voice) url = Lampa.Utils.addUrlComponent(url, 'voice=' + voice);
                
                network.native(url, function(response) {
                    try {
                        var parser = new DOMParser();
                        var doc = parser.parseFromString(response, 'text/html');
                        
                        var episodes = [];
                        var episodeElements = doc.querySelectorAll('.episode-item, .series-item, .episode-link');
                        
                        episodeElements.forEach(function(el, index) {
                            var link = el.querySelector('a');
                            var titleEl = el.querySelector('.title, .name, .episode-title');
                            var numEl = el.querySelector('.number, .episode-num');
                            
                            if (link) {
                                var episodeNum = numEl ? parseInt(numEl.textContent) : (index + 1);
                                var episodeTitle = titleEl ? titleEl.textContent.trim() : 'Серія ' + episodeNum;
                                
                                episodes.push({
                                    id: link.href || link.getAttribute('href'),
                                    title: episodeTitle,
                                    number: episodeNum,
                                    file: link.href || link.getAttribute('href')
                                });
                            }
                        });
                        
                        if (episodes.length > 0) {
                            resolve({ ok: true, episodes: episodes });
                        } else {
                            // Якщо не знайшли структуру, створюємо 24 серії
                            for (var i = 1; i <= 24; i++) {
                                episodes.push({
                                    id: href + '?e=' + i,
                                    title: 'Серія ' + i,
                                    number: i,
                                    file: href + '?e=' + i
                                });
                            }
                            resolve({ ok: true, episodes: episodes });
                        }
                    } catch (e) {
                        reject(new Error('Помилка парсингу епізодів: ' + e.message));
                    }
                }, reject);
            });
        };
    }

    // ==================== ОСНОВНИЙ ПЛАГІН ====================
    function UaflixPlugin(object) {
        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);
        var source = new UaflixSource();
        var currentData = null;
        
        this.create = function() {
            setupUI();
            startSearch();
            return files.render();
        };
        
        function setupUI() {
            filter.set('sort', [{
                title: UAFLIX_CONFIG.name,
                source: 'uaflix',
                selected: true
            }]);
            
            filter.onSelect = function(type, a, b) {
                if (type === 'filter' && a.reset) {
                    startSearch();
                }
            };
            
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());
            scroll.body().addClass('torrent-list');
        }
        
        function startSearch() {
            scroll.clear();
            showLoading();
            
            source.searchByTitle(object, object.movie.title || object.movie.name)
                .then(function(result) {
                    hideLoading();
                    
                    if (result.items.length === 1) {
                        loadContent(result.items[0]);
                    } else {
                        showSimilar(result.items);
                    }
                })
                .catch(function(error) {
                    hideLoading();
                    showError('Помилка пошуку: ' + error.message);
                });
        }
        
        function loadContent(item) {
            showLoading();
            
            var isMovie = item.category.includes('фільм');
            
            if (isMovie) {
                source.loadMovie(item.href)
                    .then(function(movieData) {
                        hideLoading();
                        drawMovie(movieData, item);
                    })
                    .catch(showError);
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
                    .catch(showError);
            }
        }
        
        function drawMovie(data, item) {
            var html = Lampa.Template.get('bandera_online_full', {
                title: item.title,
                time: '',
                info: item.year,
                quality: 'HD'
            });
            
            html.on('hover:enter', function() {
                if (data.stream) {
                    Lampa.Player.play({
                        url: data.stream,
                        title: item.title
                    });
                }
            });
            
            scroll.append(html);
        }
        
        function showSeasons(data) {
            scroll.clear();
            
            // Показуємо вибір сезону
            data.seasons.forEach(function(season, index) {
                var html = $('<div class="online-prestige selector">' +
                    '<div class="online-prestige__body">' +
                    '<div class="online-prestige__title">Сезон ' + season + '</div>' +
                    '</div></div>');
                
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
                .catch(showError);
        }
        
        function showEpisodes(episodes, season) {
            scroll.clear();
            
            episodes.forEach(function(episode) {
                var html = Lampa.Template.get('bandera_online_full', {
                    title: episode.title,
                    time: '',
                    info: 'Сезон ' + season + ', Серія ' + episode.number,
                    quality: ''
                });
                
                html.on('hover:enter', function() {
                    source.loadMovie(episode.file)
                        .then(function(videoData) {
                            if (videoData.stream) {
                                Lampa.Player.play({
                                    url: videoData.stream,
                                    title: episode.title
                                });
                            }
                        })
                        .catch(function(error) {
                            Lampa.Noty.show('Не вдалося завантажити відео');
                        });
                });
                
                scroll.append(html);
            });
        }
        
        function showSimilar(items) {
            items.forEach(function(item) {
                var html = Lampa.Template.get('bandera_online_folder', {
                    title: item.title,
                    time: item.year,
                    info: item.category
                });
                
                html.on('hover:enter', function() {
                    scroll.clear();
                    loadContent(item);
                });
                
                scroll.append(html);
            });
        }
        
        function showLoading() {
            scroll.append('<div class="loader">Завантаження...</div>');
        }
        
        function hideLoading() {
            scroll.render().find('.loader').remove();
        }
        
        function showError(msg) {
            hideLoading();
            scroll.append('<div class="error">' + msg + '</div>');
        }
        
        // Решта методів Lampa
        this.start = function() {
            Lampa.Controller.add('content', {
                toggle: function() {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(null, scroll.render());
                },
                up: Navigator.moveUp,
                down: Navigator.moveDown,
                back: function() { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };
        
        this.render = function() { return files.render(); };
        this.destroy = function() { network.clear(); };
    }

    // ==================== РЕЄСТРАЦІЯ ====================
    if (window.Lampa && !window.uaflix_loaded) {
        window.uaflix_loaded = true;
        
        // Реєструємо компонент
        Lampa.Component.add('uaflix_online', UaflixPlugin);
        
        // Додаємо кнопку в інтерфейс
        Lampa.Listener.follow('full', function(e) {
            if (e.type == 'complite') {
                var button = $('<div class="full-start__button selector view--uaflix">' +
                    '<span>🎬 UaFlix (uafix.net)</span>' +
                    '</div>');
                
                button.on('hover:enter', function() {
                    Lampa.Activity.push({
                        url: '',
                        title: 'UaFlix',
                        component: 'uaflix_online',
                        movie: e.data.movie
                    });
                });
                
                e.object.activity.render().find('.view--torrent').after(button);
            }
        });
        
        console.log('Uaflix plugin loaded!');
    }

})();
