(function () {
    'use strict';

    // ================================
    // UAFLIX SOURCE
    // ================================
    function UAflix(component, _object) {
        const network = new Lampa.Reguest();
        const self = this;
        const api_base = 'https://fearless-accomplished-kestrel.anvil.app/_/api/v1';
        
        let object = _object;
        let selected = null;
        let series = null;
        let episodes_cache = {};
        let filter_items = { season: [], voice: [] };
        let choice = { season: 0, voice: 0, voice_name: '' };

        // Public methods
        this.searchByTitle = function(_object, title) {
            object = _object;
            search(title);
        };

        this.search = function(_object, data) {
            if (!data || !data.length) return component.doesNotAnswer();
            
            object = _object;
            selected = data[0];
            series = null;
            episodes_cache = {};
            
            if (isMovie(selected.href)) loadMovie(selected.href);
            else loadSeries(selected.href);
        };

        this.extendChoice = function(saved) {
            Lampa.Arrays.extend(choice, saved, true);
        };

        this.reset = function() {
            component.reset();
            choice = { season: 0, voice: 0, voice_name: '' };
            filter();
            buildEpisodes();
        };

        this.filter = function(type, a, b) {
            choice[a.stype] = b.index;
            if (a.stype == 'voice' && filter_items.voice[b.index]) {
                choice.voice_name = filter_items.voice[b.index];
            }
            component.reset();
            filter();
            buildEpisodes();
        };

        this.destroy = function() {
            network.clear();
            selected = null;
            series = null;
            episodes_cache = {};
        };

        // Private methods
        function isMovie(href) {
            return /\/films?\//.test(href);
        }

        function addParam(url, key, value) {
            if (!value) return url;
            return Lampa.Utils.addUrlComponent(url, `${key}=${encodeURIComponent(value)}`);
        }

        function getYear(movie) {
            const date = movie.release_date || movie.first_air_date || movie.year || movie.start_date;
            return date ? (date + '').slice(0, 4) : '';
        }

        function search(title) {
            let url = api_base + '/search';
            const movie = object.movie || {};
            
            url = addParam(url, 'source', 'uaflix');
            url = addParam(url, 'title', title);
            url = addParam(url, 'original_title', movie.original_title || movie.original_name);
            url = addParam(url, 'imdb_id', movie.imdb_id);
            url = addParam(url, 'kinopoisk_id', movie.kinopoisk_id);
            url = addParam(url, 'year', getYear(movie));

            network.silent(url, 
                function(json) {
                    const items = (json && json.ok) ? (json.items || []) : [];
                    if (!items.length) {
                        component.doesNotAnswer();
                        return;
                    }

                    const mappedItems = items.map(item => ({
                        id: item.href,
                        title: item.title,
                        year: item.year,
                        href: item.href,
                        poster: item.poster
                    }));

                    if (mappedItems.length == 1 || object.clarification) {
                        self.search(object, mappedItems);
                    } else {
                        component.similars(mappedItems);
                        component.loading(false);
                    }
                },
                function() {
                    component.doesNotAnswer();
                }
            );
        }

        function loadMovie(href) {
            let url = api_base + '/uaflix/movie';
            url = addParam(url, 'href', href);

            network.silent(url,
                function(json) {
                    const streams = (json && json.ok) ? (json.streams || []) : [];
                    if (!streams.length) {
                        component.doesNotAnswer();
                        return;
                    }

                    const stream_info = buildQualityMap(streams);
                    const item = {
                        title: object.movie.title,
                        file: stream_info.file,
                        quality: stream_info.label,
                        qualitys: stream_info.qualitys,
                        info: ''
                    };

                    component.draw([item], {
                        onEnter: function(element) {
                            const first = {
                                url: element.file,
                                timeline: element.timeline,
                                quality: element.qualitys,
                                title: element.title,
                                subtitles: element.subtitles
                            };
                            Lampa.Player.play(first);
                            Lampa.Player.playlist([first]);
                            element.mark();
                        },
                        onContextMenu: function(element, html, data, call) {
                            call({ file: element.file, quality: element.qualitys });
                        }
                    });
                    component.loading(false);
                },
                function() {
                    component.doesNotAnswer();
                }
            );
        }

        function loadSeries(href) {
            let url = api_base + '/uaflix/series';
            url = addParam(url, 'href', href);

            network.silent(url,
                function(json) {
                    if (!json || !json.ok) {
                        component.doesNotAnswer();
                        return;
                    }
                    series = json;
                    filter();
                    buildEpisodes();
                },
                function() {
                    component.doesNotAnswer();
                }
            );
        }

        function filter() {
            filter_items = { season: [], voice: [] };
            
            if (series) {
                if (series.voices && series.voices.length) {
                    filter_items.voice = series.voices.map(voice => 
                        voice.display_name || voice.id
                    );
                }
                if (series.seasons && series.seasons.length) {
                    filter_items.season = series.seasons.map(season => 
                        `${Lampa.Lang.translate('torrent_serial_season')} ${season}`
                    );
                }
            }

            if (choice.season >= filter_items.season.length) choice.season = 0;
            if (choice.voice >= filter_items.voice.length) choice.voice = 0;
            if (filter_items.voice[choice.voice]) {
                choice.voice_name = filter_items.voice[choice.voice];
            }
            
            component.filter(filter_items, choice);
        }

        function buildEpisodes() {
            if (!series || !series.voices?.length || !series.seasons?.length) {
                component.loading(false);
                return component.doesNotAnswer();
            }

            const voice = series.voices[choice.voice] || series.voices[0];
            const season = series.seasons[choice.season] || series.seasons[0];
            const cache_key = `${voice.id}:${season}`;
            choice.voice_name = voice.display_name || voice.id;

            if (episodes_cache[cache_key]) {
                renderEpisodes(episodes_cache[cache_key], season, voice);
                return;
            }

            let url = api_base + '/uaflix/episodes';
            url = addParam(url, 'href', selected.href);
            url = addParam(url, 'voice', voice.id);
            url = addParam(url, 'season', season);

            network.silent(url,
                function(json) {
                    const episodes = (json && json.ok) ? (json.episodes || []) : [];
                    if (!episodes.length) {
                        component.doesNotAnswer();
                        return;
                    }
                    episodes_cache[cache_key] = episodes;
                    renderEpisodes(episodes, season, voice);
                },
                function() {
                    component.doesNotAnswer();
                }
            );
        }

        function renderEpisodes(episodes, season, voice) {
            const items = episodes.map(episode => ({
                title: episode.title,
                file: episode.file,
                id: episode.id,
                season: season,
                episode: episode.number,
                info: voice.display_name || voice.id,
                voice_name: voice.display_name || voice.id,
                voice_id: voice.id
            }));

            component.draw(items, {
                onEnter: function(item) {
                    getStream(item,
                        function(stream) {
                            const first = {
                                url: stream.file,
                                timeline: item.timeline,
                                quality: stream.qualitys,
                                title: item.title,
                                subtitles: item.subtitles
                            };
                            Lampa.Player.play(first);
                            
                            const playlist = items.map(elem => {
                                const cell = {
                                    url: function(call) {
                                        getStream(elem,
                                            function(next) {
                                                cell.url = next.file;
                                                cell.quality = next.qualitys;
                                                elem.mark();
                                                call();
                                            },
                                            function() {
                                                cell.url = '';
                                                call();
                                            }
                                        );
                                    },
                                    timeline: elem.timeline,
                                    title: elem.title,
                                    subtitles: elem.subtitles
                                };
                                if (elem == item) {
                                    cell.url = stream.file;
                                    cell.quality = stream.qualitys;
                                }
                                return cell;
                            });
                            
                            Lampa.Player.playlist(playlist);
                            item.mark();
                        },
                        function() {
                            Lampa.Noty.show(Lampa.Lang.translate('online_nolink'));
                        }
                    );
                },
                onContextMenu: function(item, html, data, call) {
                    getStream(item, function(stream) {
                        call({ file: stream.file, quality: stream.qualitys });
                    });
                }
            });
            component.loading(false);
        }

        function buildQualityMap(streams) {
            const qualitys = {};
            streams.forEach(stream => {
                if (stream.quality && stream.url) qualitys[stream.quality] = stream.url;
            });

            const preferred = Lampa.Storage.get('video_quality_default', '1080') + 'p';
            const keys = Object.keys(qualitys).sort((a, b) => parseInt(b) - parseInt(a));
            let file = qualitys[preferred] || qualitys[keys[0]];
            if (!file && streams[0]) file = streams[0].url;

            return {
                file: file,
                qualitys: qualitys,
                label: keys.length ? keys[0] : ''
            };
        }

        function getStream(item, success, fail) {
            let url = api_base + '/uaflix/stream';
            url = addParam(url, 'url', item.file);

            network.silent(url,
                function(json) {
                    const streams = (json && json.ok) ? (json.streams || []) : [];
                    if (!streams.length) {
                        if (fail) fail();
                        return;
                    }
                    success(buildQualityMap(streams));
                },
                function() {
                    if (fail) fail();
                }
            );
        }
    }

    // ================================
    // UATUT SOURCE
    // ================================
    function UAtut(component, _object) {
        const network = new Lampa.Reguest();
        const self = this;
        const api_base = 'https://fearless-accomplished-kestrel.anvil.app/_/api/v1';
        
        let object = _object;
        let selected = null;
        let series = null;
        let filter_items = { season: [], voice: [] };
        let choice = { season: 0, voice: 0, voice_name: '' };

        // Public methods
        this.searchByTitle = function(_object, title) {
            object = _object;
            search(title);
        };

        this.search = function(_object, data) {
            if (!data || !data.length) return component.doesNotAnswer();
            
            object = _object;
            selected = data[0];
            series = null;
            
            if (isMovie(selected.category)) loadMovie(selected.id);
            else loadSeries(selected.id);
        };

        this.extendChoice = function(saved) {
            Lampa.Arrays.extend(choice, saved, true);
        };

        this.reset = function() {
            component.reset();
            choice = { season: 0, voice: 0, voice_name: '' };
            filter();
            buildEpisodes();
        };

        this.filter = function(type, a, b) {
            choice[a.stype] = b.index;
            if (a.stype == 'voice' && filter_items.voice[b.index]) {
                choice.voice_name = filter_items.voice[b.index];
            }
            component.reset();
            filter();
            buildEpisodes();
        };

        this.destroy = function() {
            network.clear();
            selected = null;
            series = null;
        };

        // Private methods
        function isMovie(category) {
            if (!category) return false;
            return /фільм|фильм/i.test(category);
        }

        function addParam(url, key, value) {
            if (!value) return url;
            return Lampa.Utils.addUrlComponent(url, `${key}=${encodeURIComponent(value)}`);
        }

        function getYear(movie) {
            const date = movie.release_date || movie.first_air_date || movie.year || movie.start_date;
            return date ? (date + '').slice(0, 4) : '';
        }

        function search(title) {
            let url = api_base + '/search';
            const movie = object.movie || {};
            
            url = addParam(url, 'source', 'uatut');
            url = addParam(url, 'title', title);
            url = addParam(url, 'original_title', movie.original_title || movie.original_name);
            url = addParam(url, 'imdb_id', movie.imdb_id);
            url = addParam(url, 'kinopoisk_id', movie.kinopoisk_id);
            url = addParam(url, 'year', getYear(movie));

            network.silent(url,
                function(json) {
                    let items = (json && json.ok) ? (json.items || []) : [];
                    
                    if (movie.imdb_id) {
                        const exact = items.filter(item => item.imdb_id == movie.imdb_id);
                        if (exact.length) items = exact;
                    }

                    if (!items.length) {
                        component.doesNotAnswer();
                        return;
                    }

                    const mappedItems = items.map(item => ({
                        id: item.id,
                        imdb_id: item.imdb_id,
                        title: item.title,
                        year: item.year,
                        category: item.category
                    }));

                    if (mappedItems.length == 1 || object.clarification) {
                        self.search(object, mappedItems);
                    } else {
                        component.similars(mappedItems);
                        component.loading(false);
                    }
                },
                function() {
                    component.doesNotAnswer();
                }
            );
        }

        function loadMovie(id) {
            let url = api_base + '/uatut/movie';
            url = addParam(url, 'id', id);

            network.silent(url,
                function(json) {
                    if (!json || !json.ok || !json.stream) {
                        component.doesNotAnswer();
                        return;
                    }

                    const item = {
                        title: object.movie.title,
                        file: json.stream,
                        quality: '',
                        info: ''
                    };

                    component.draw([item], {
                        onEnter: function(element) {
                            const first = {
                                url: element.file,
                                timeline: element.timeline,
                                title: element.title,
                                subtitles: element.subtitles
                            };
                            Lampa.Player.play(first);
                            Lampa.Player.playlist([first]);
                            element.mark();
                        },
                        onContextMenu: function(element, html, data, call) {
                            call({ file: element.file });
                        }
                    });
                    component.loading(false);
                },
                function() {
                    component.doesNotAnswer();
                }
            );
        }

        function loadSeries(id) {
            let url = api_base + '/uatut/series';
            url = addParam(url, 'id', id);

            network.silent(url,
                function(json) {
                    if (!json || !json.ok || !json.voices?.length) {
                        component.doesNotAnswer();
                        return;
                    }
                    series = json;
                    filter();
                    buildEpisodes();
                },
                function() {
                    component.doesNotAnswer();
                }
            );
        }

        function filter() {
            filter_items = { season: [], voice: [] };
            
            if (series?.voices?.length) {
                filter_items.voice = series.voices.map(voice => 
                    normalizeTitle(voice.name)
                );
                
                const active_voice = series.voices[choice.voice] || series.voices[0];
                const seasons = active_voice.seasons || [];
                
                filter_items.season = seasons.map(season => 
                    normalizeTitle(season.title)
                );
            }

            if (choice.season >= filter_items.season.length) choice.season = 0;
            if (choice.voice >= filter_items.voice.length) choice.voice = 0;
            if (filter_items.voice[choice.voice]) {
                choice.voice_name = filter_items.voice[choice.voice];
            }
            
            component.filter(filter_items, choice);
        }

        function buildEpisodes() {
            if (!series?.voices?.length) {
                component.loading(false);
                return component.doesNotAnswer();
            }

            const voice = series.voices[choice.voice] || series.voices[0];
            const seasons = voice.seasons || [];
            const season = seasons[choice.season];
            
            if (!season?.episodes?.length) {
                component.doesNotAnswer();
                return;
            }

            const season_number = parseNumber(season.title, choice.season + 1);
            const items = season.episodes.map((episode, index) => ({
                title: episode.title,
                file: episode.file,
                id: episode.id,
                season: season_number,
                episode: parseNumber(episode.title, index + 1),
                info: normalizeTitle(voice.name),
                voice_name: normalizeTitle(voice.name)
            }));

            component.draw(items, {
                onEnter: function(item) {
                    const first = {
                        url: item.file,
                        timeline: item.timeline,
                        title: item.title,
                        subtitles: item.subtitles
                    };
                    Lampa.Player.play(first);
                    
                    const playlist = items.map(elem => ({
                        url: elem.file,
                        timeline: elem.timeline,
                        title: elem.title,
                        subtitles: elem.subtitles
                    }));
                    
                    Lampa.Player.playlist(playlist);
                    item.mark();
                },
                onContextMenu: function(item, html, data, call) {
                    call({ file: item.file });
                }
            });
            component.loading(false);
        }

        function normalizeTitle(value) {
            return (value || '').trim();
        }

        function parseNumber(value, fallback) {
            const match = (value || '').match(/(\d+)/);
            return match ? parseInt(match[1]) : fallback;
        }
    }

    // ================================
    // MAIN COMPONENT
    // ================================
    function Component(object) {
        const network = new Lampa.Reguest();
        const scroll = new Lampa.Scroll({ mask: true, over: true });
        const files = new Lampa.Explorer(object);
        const filter = new Lampa.Filter(object);
        
        const sources = {
            uatut: UAtut,
            uaflix: UAflix
        };
        
        const balanser_titles = {
            uaflix: 'UAflix',
            uatut: 'UATuT'
        };
        
        const filter_sources = ['uatut', 'uaflix'];
        const filter_translate = {
            season: Lampa.Lang.translate('torrent_serial_season'),
            voice: Lampa.Lang.translate('torrent_parser_voice'),
            source: Lampa.Lang.translate('settings_rest_source')
        };
        
        let last = null;
        let extended = false;
        let selected_id = null;
        let source = null;
        let balanser = null;
        let initialized = false;
        let balanser_timer = null;
        let images = [];

        // Public methods
        this.initialize = function() {
            source = this.createSource();
            
            filter.onSearch = function(value) {
                Lampa.Activity.replace({ search: value, clarification: true });
            };
            
            filter.onBack = function() {
                self.start();
            };
            
            filter.render().find('.selector').on('hover:enter', function() {
                clearInterval(balanser_timer);
            });
            
            filter.onSelect = function(type, a, b) {
                if (type == 'filter') {
                    if (a.reset) {
                        if (extended) source.reset();
                        else self.start();
                    } else {
                        source.filter(type, a, b);
                    }
                } else if (type == 'sort') {
                    Lampa.Select.close();
                    self.changeBalanser(a.source);
                }
            };
            
            if (filter.addButtonBack) filter.addButtonBack();
            filter.render().find('.filter--sort span').text(Lampa.Lang.translate('online_balanser'));
            
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());
            scroll.body().addClass('torrent-list');
            scroll.minus(files.render().find('.explorer__files-head'));
            
            this.search();
        };

        this.changeBalanser = function(balanser_name) {
            const last_select_balanser = Lampa.Storage.cache('bandera_online_last_balanser', 3000, {});
            last_select_balanser[object.movie.id] = balanser_name;
            Lampa.Storage.set('bandera_online_last_balanser', last_select_balanser);
            Lampa.Storage.set('bandera_online_balanser', balanser_name);
            
            const to = this.getChoice(balanser_name);
            const from = this.getChoice();
            if (from.voice_name) to.voice_name = from.voice_name;
            
            this.saveChoice(to, balanser_name);
            Lampa.Activity.replace();
        };

        this.createSource = function() {
            const last_select_balanser = Lampa.Storage.cache('bandera_online_last_balanser', 3000, {});
            
            if (last_select_balanser[object.movie.id]) {
                balanser = last_select_balanser[object.movie.id];
                Lampa.Storage.set('bandera_online_last_balanser', last_select_balanser);
            } else {
                balanser = Lampa.Storage.get('bandera_online_balanser', 'uatut');
            }
            
            if (!sources[balanser]) {
                balanser = 'uatut';
            }
            
            return new sources[balanser](this, object);
        };

        this.proxy = function(name) {
            let prox = Lampa.Storage.get('bandera_online_proxy_all');
            const need = Lampa.Storage.get('bandera_online_proxy_' + name);
            if (need) prox = need;
            if (prox && prox.slice(-1) !== '/') prox += '/';
            return prox;
        };

        this.create = function() {
            return this.render();
        };

        this.search = function() {
            this.activity.loader(true);
            this.filter({ source: filter_sources }, this.getChoice());
            this.find();
        };

        this.find = function() {
            const self = this;
            const url = this.proxy('videocdn') + 'https://videocdn.tv/api/short';
            const query = object.search;
            const api_url = Lampa.Utils.addUrlComponent(url, 'api_token=3i40G5TSECmLF77oAqnEgbx61ZWaOYaE');
            
            function display(json) {
                if (object.movie.imdb_id) {
                    const imdb = json.data.filter(elem => elem.imdb_id == object.movie.imdb_id);
                    if (imdb.length) json.data = imdb;
                }
                
                if (json.data?.length) {
                    if (json.data.length == 1 || object.clarification) {
                        self.extendChoice();
                        const kinopoisk_id = json.data[0].kp_id || json.data[0].filmId;
                        
                        if (kinopoisk_id && source.searchByKinopoisk) {
                            source.searchByKinopoisk(object, kinopoisk_id);
                        } else if (json.data[0].imdb_id && source.searchByImdbID) {
                            source.searchByImdbID(object, json.data[0].imdb_id);
                        } else if (source.search) {
                            source.search(object, json.data);
                        } else {
                            self.doesNotAnswer();
                        }
                    } else {
                        self.similars(json.data);
                        self.loading(false);
                    }
                } else {
                    self.doesNotAnswer(query);
                }
            }
            
            function pillow() {
                network.timeout(1000 * 15);
                network.native(
                    `https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword?keyword=${encodeURIComponent(query)}`,
                    function(json) {
                        json.data = json.films;
                        display(json);
                    },
                    function() {
                        self.doesNotAnswer();
                    },
                    false,
                    { headers: { 'X-API-KEY': '2d55adfd-019d-4567-bbf7-67d503f61b5a' } }
                );
            }
            
            function letgo(imdb_id) {
                if (imdb_id && source.searchByImdbID) {
                    self.extendChoice();
                    source.searchByImdbID(object, imdb_id);
                } else {
                    const url_end = Lampa.Utils.addUrlComponent(
                        api_url, 
                        imdb_id ? `imdb_id=${encodeURIComponent(imdb_id)}` : `title=${encodeURIComponent(query)}`
                    );
                    
                    network.timeout(1000 * 15);
                    network.native(url_end,
                        function(json) {
                            if (json.data?.length) display(json);
                            else {
                                network.native(
                                    Lampa.Utils.addUrlComponent(api_url, `title=${encodeURIComponent(query)}`),
                                    display.bind(self),
                                    pillow.bind(self)
                                );
                            }
                        },
                        pillow.bind(self)
                    );
                }
            }
            
            if (source.searchByTitle) {
                this.extendChoice();
                source.searchByTitle(object, object.movie.title || object.movie.name);
            } else if (object.movie.kinopoisk_id && source.searchByKinopoisk) {
                this.extendChoice();
                source.searchByKinopoisk(object, object.movie.kinopoisk_id);
            } else if (object.movie.imdb_id) {
                letgo(object.movie.imdb_id);
            } else if (object.movie.source == 'tmdb' || object.movie.source == 'cub') {
                const media_type = object.movie.name ? 'tv' : 'movie';
                const tmdburl = `${media_type}/${object.movie.id}/external_ids?api_key=4ef0d7355d9ffb5151e987764708ce96&language=ru`;
                const baseurl = Lampa.TMDB.api(tmdburl);
                
                network.timeout(1000 * 10);
                network.native(baseurl,
                    function(ttid) {
                        letgo(ttid.imdb_id);
                    },
                    function() {
                        letgo();
                    }
                );
            } else {
                letgo();
            }
        };

        this.getChoice = function(for_balanser) {
            const data = Lampa.Storage.cache(`bandera_online_choice_${for_balanser || balanser}`, 3000, {});
            const save = data[selected_id || object.movie.id] || {};
            
            Lampa.Arrays.extend(save, {
                season: 0,
                voice: 0,
                voice_name: '',
                voice_id: 0,
                episodes_view: {},
                movie_view: ''
            });
            
            return save;
        };

        this.extendChoice = function() {
            extended = true;
            source.extendChoice(this.getChoice());
        };

        this.saveChoice = function(choice, for_balanser) {
            const data = Lampa.Storage.cache(`bandera_online_choice_${for_balanser || balanser}`, 3000, {});
            data[selected_id || object.movie.id] = choice;
            Lampa.Storage.set(`bandera_online_choice_${for_balanser || balanser}`, data);
        };

        this.similars = function(json) {
            const self = this;
            json.forEach(function(elem) {
                const info = [];
                const year = ((elem.start_date || elem.year || '') + '').slice(0, 4);
                
                if (elem.rating && elem.rating !== 'null' && elem.filmId) {
                    info.push(Lampa.Template.get('bandera_online_rate', { rate: elem.rating }, true));
                }
                if (year) info.push(year);
                if (elem.countries?.length) {
                    const countries = elem.filmId 
                        ? elem.countries.map(c => c.country) 
                        : elem.countries;
                    info.push(countries.join(', '));
                }
                if (elem.categories?.length) {
                    info.push(elem.categories.slice(0, 4).join(', '));
                }
                
                const name = elem.title || elem.ru_title || elem.en_title || elem.nameRu || elem.nameEn;
                const orig = elem.orig_title || elem.nameEn || '';
                elem.title = name + (orig && orig !== name ? ' / ' + orig : '');
                elem.time = elem.filmLength || '';
                elem.info = info.join('<span class="online-prestige-split">●</span>');
                
                const item = Lampa.Template.get('bandera_online_folder', elem);
                item.on('hover:enter', function() {
                    self.activity.loader(true);
                    self.reset();
                    object.search_date = year;
                    selected_id = elem.id;
                    self.extendChoice();
                    
                    const kinopoisk_id = elem.kp_id || elem.filmId;
                    if (kinopoisk_id && source.searchByKinopoisk) {
                        source.searchByKinopoisk(object, kinopoisk_id);
                    } else if (source.search) {
                        source.search(object, [elem]);
                    } else {
                        self.doesNotAnswer();
                    }
                }).on('hover:focus', function(e) {
                    last = e.target;
                    scroll.update($(e.target), true);
                });
                
                scroll.append(item);
            });
        };

        this.clearImages = function() {
            images.forEach(img => {
                img.onerror = null;
                img.onload = null;
                img.src = '';
            });
            images = [];
        };

        this.reset = function() {
            last = false;
            clearInterval(balanser_timer);
            network.clear();
            this.clearImages();
            scroll.render().find('.empty').remove();
            scroll.clear();
        };

        this.loading = function(status) {
            if (status) {
                this.activity.loader(true);
            } else {
                this.activity.loader(false);
                this.activity.toggle();
            }
        };

        this.filter = function(filter_items, choice) {
            const self = this;
            const select = [];
            
            function add(type, title) {
                const need = self.getChoice();
                const items = filter_items[type];
                const subitems = items.map((name, i) => ({
                    title: name,
                    selected: need[type] == i,
                    index: i
                }));
                
                select.push({
                    title: title,
                    subtitle: items[need[type]],
                    items: subitems,
                    stype: type
                });
            }
            
            filter_items.source = filter_sources;
            select.push({ title: Lampa.Lang.translate('torrent_parser_reset'), reset: true });
            
            this.saveChoice(choice);
            if (filter_items.voice?.length) add('voice', Lampa.Lang.translate('torrent_parser_voice'));
            if (filter_items.season?.length) add('season', Lampa.Lang.translate('torrent_serial_season'));
            
            filter.set('filter', select);
            filter.set('sort', filter_sources.map(e => ({
                title: balanser_titles[e] || e,
                source: e,
                selected: e == balanser
            })));
            
            this.selected(filter_items);
        };

        this.closeFilter = function() {
            if ($('body').hasClass('selectbox--open')) Lampa.Select.close();
        };

        this.selected = function(filter_items) {
            const need = this.getChoice();
            const select = [];
            
            for (const i in need) {
                if (filter_items[i]?.length) {
                    if (i == 'voice') {
                        select.push(`${filter_translate[i]}: ${filter_items[i][need[i]]}`);
                    } else if (i !== 'source') {
                        if (filter_items.season.length >= 1) {
                            select.push(`${filter_translate.season}: ${filter_items[i][need[i]]}`);
                        }
                    }
                }
            }
            
            filter.chosen('filter', select);
            filter.chosen('sort', [balanser_titles[balanser] || balanser]);
        };

        this.getEpisodes = function(season, call) {
            let episodes = [];
            if (typeof object.movie.id == 'number' && object.movie.name) {
                Lampa.Api.sources.tmdb.get(
                    `tv/${object.movie.id}/season/${season}`,
                    {},
                    function(data) {
                        episodes = data.episodes || [];
                        call(episodes);
                    },
                    function() {
                        call(episodes);
                    }
                );
            } else {
                call(episodes);
            }
        };

        this.append = function(item) {
            item.on('hover:focus', function(e) {
                last = e.target;
                scroll.update($(e.target), true);
            });
            scroll.append(item);
        };

        this.watched = function(set) {
            const file_id = Lampa.Utils.hash(
                object.movie.number_of_seasons 
                    ? object.movie.original_name 
                    : object.movie.original_title
            );
            const watched = Lampa.Storage.cache('bandera_online_watched_last', 5000, {});
            
            if (set) {
                if (!watched[file_id]) watched[file_id] = {};
                Lampa.Arrays.extend(watched[file_id], set, true);
                Lampa.Storage.set('bandera_online_watched_last', watched);
                this.updateWatched();
            } else {
                return watched[file_id];
            }
        };

        this.updateWatched = function() {
            const watched = this.watched();
            const body = scroll.body().find('.online-prestige-watched .online-prestige-watched__body').empty();
            
            if (watched) {
                const line = [];
                if (watched.balanser_name) line.push(watched.balanser_name);
                if (watched.voice_name) line.push(watched.voice_name);
                if (watched.season) line.push(`${Lampa.Lang.translate('torrent_serial_season')} ${watched.season}`);
                if (watched.episode) line.push(`${Lampa.Lang.translate('torrent_serial_episode')} ${watched.episode}`);
                
                line.forEach(n => {
                    body.append(`<span>${n}</span>`);
                });
            } else {
                body.append(`<span>${Lampa.Lang.translate('online_no_watch_history')}</span>`);
            }
        };

        this.draw = function(items, params = {}) {
            if (!items.length) return this.empty();
            
            const self = this;
            scroll.append(Lampa.Template.get('bandera_online_watched', {}));
            this.updateWatched();
            
            this.getEpisodes(items[0].season, function(episodes) {
                const viewed = Lampa.Storage.cache('bandera_online_view', 5000, []);
                const serial = object.movie.name ? true : false;
                const choice = self.getChoice();
                const fully = window.innerWidth > 480;
                let scroll_to_element = false;
                let scroll_to_mark = false;
                
                items.forEach(function(element, index) {
                    const episode = serial && episodes.length && !params.similars 
                        ? episodes.find(e => e.episode_number == element.episode) 
                        : false;
                    const episode_num = element.episode || index + 1;
                    const episode_last = choice.episodes_view[element.season];
                    
                    Lampa.Arrays.extend(element, {
                        info: '',
                        quality: '',
                        time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true)
                    });
                    
                    const hash_timeline = Lampa.Utils.hash(
                        element.season 
                            ? [element.season, element.episode, object.movie.original_title].join('')
                            : object.movie.original_title
                    );
                    
                    const hash_behold = Lampa.Utils.hash(
                        element.season 
                            ? [element.season, element.episode, object.movie.original_title, element.voice_name].join('')
                            : object.movie.original_title + element.voice_name
                    );
                    
                    const data = { hash_timeline, hash_behold };
                    const info = [];
                    
                    if (element.season) {
                        element.translate_episode_end = self.getLastEpisode(items);
                        element.translate_voice = element.voice_name;
                    }
                    
                    element.timeline = Lampa.Timeline.view(hash_timeline);
                    
                    if (episode) {
                        element.title = episode.name;
                        if (element.info.length < 30 && episode.vote_average) {
                            info.push(Lampa.Template.get('bandera_online_rate', {
                                rate: parseFloat(episode.vote_average + '').toFixed(1)
                            }, true));
                        }
                        if (episode.air_date && fully) {
                            info.push(Lampa.Utils.parseTime(episode.air_date).full);
                        }
                    } else if (object.movie.release_date && fully) {
                        info.push(Lampa.Utils.parseTime(object.movie.release_date).full);
                    }
                    
                    if (!serial && object.movie.tagline && element.info.length < 30) {
                        info.push(object.movie.tagline);
                    }
                    
                    if (element.info) info.push(element.info);
                    
                    if (info.length) {
                        element.info = info.map(i => `<span>${i}</span>`)
                            .join('<span class="online-prestige-split">●</span>');
                    }
                    
                    const html = Lampa.Template.get('bandera_online_full', element);
                    const loader = html.find('.online-prestige__loader');
                    const image = html.find('.online-prestige__img');
                    
                    if (!serial) {
                        if (choice.movie_view == hash_behold) scroll_to_element = html;
                    } else if (typeof episode_last !== 'undefined' && episode_last == episode_num) {
                        scroll_to_element = html;
                    }
                    
                    if (serial && !episode) {
                        image.append(`<div class="online-prestige__episode-number">${('0' + (element.episode || index + 1)).slice(-2)}</div>`);
                        loader.remove();
                    } else {
                        const img = html.find('img')[0];
                        img.onerror = function() {
                            img.src = './img/img_broken.svg';
                        };
                        img.onload = function() {
                            image.addClass('online-prestige__img--loaded');
                            loader.remove();
                            if (serial) {
                                image.append(`<div class="online-prestige__episode-number">${('0' + (element.episode || index + 1)).slice(-2)}</div>`);
                            }
                        };
                        img.src = Lampa.TMDB.image('t/p/w300' + (episode ? episode.still_path : object.movie.backdrop_path));
                        images.push(img);
                    }
                    
                    html.find('.online-prestige__timeline').append(Lampa.Timeline.render(element.timeline));
                    
                    if (viewed.indexOf(hash_behold) !== -1) {
                        scroll_to_mark = html;
                        html.find('.online-prestige__img').append(
                            `<div class="online-prestige__viewed">${Lampa.Template.get('icon_viewed', {}, true)}</div>`
                        );
                    }
                    
                    element.mark = function() {
                        viewed = Lampa.Storage.cache('bandera_online_view', 5000, []);
                        if (viewed.indexOf(hash_behold) == -1) {
                            viewed.push(hash_behold);
                            Lampa.Storage.set('bandera_online_view', viewed);
                            if (html.find('.online-prestige__viewed').length == 0) {
                                html.find('.online-prestige__img').append(
                                    `<div class="online-prestige__viewed">${Lampa.Template.get('icon_viewed', {}, true)}</div>`
                                );
                            }
                        }
                        
                        const choice = self.getChoice();
                        if (!serial) {
                            choice.movie_view = hash_behold;
                        } else {
                            choice.episodes_view[element.season] = episode_num;
                        }
                        self.saveChoice(choice);
                        
                        self.watched({
                            balanser: balanser,
                            balanser_name: balanser_titles[balanser] || Lampa.Utils.capitalizeFirstLetter(balanser),
                            voice_id: choice.voice_id,
                            voice_name: choice.voice_name || element.voice_name,
                            episode: element.episode,
                            season: element.season
                        });
                    };
                    
                    element.unmark = function() {
                        viewed = Lampa.Storage.cache('bandera_online_view', 5000, []);
                        if (viewed.indexOf(hash_behold) !== -1) {
                            Lampa.Arrays.remove(viewed, hash_behold);
                            Lampa.Storage.set('bandera_online_view', viewed);
                            if (Lampa.Manifest.app_digital >= 177) {
                                Lampa.Storage.remove('bandera_online_view', hash_behold);
                            }
                            html.find('.online-prestige__viewed').remove();
                        }
                    };
                    
                    element.timeclear = function() {
                        element.timeline.percent = 0;
                        element.timeline.time = 0;
                        element.timeline.duration = 0;
                        Lampa.Timeline.update(element.timeline);
                    };
                    
                    html.on('hover:enter', function() {
                        if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
                        if (params.onEnter) params.onEnter(element, html, data);
                    }).on('hover:focus', function(e) {
                        last = e.target;
                        if (params.onFocus) params.onFocus(element, html, data);
                        scroll.update($(e.target), true);
                    });
                    
                    if (params.onRender) params.onRender(element, html, data);
                    
                    self.contextMenu({
                        html: html,
                        element: element,
                        onFile: function(call) {
                            if (params.onContextMenu) params.onContextMenu(element, html, data, call);
                        },
                        onClearAllMark: function() {
                            items.forEach(elem => elem.unmark());
                        },
                        onClearAllTime: function() {
                            items.forEach(elem => elem.timeclear());
                        }
                    });
                    
                    scroll.append(html);
                });
                
                // Add upcoming episodes
                if (serial && episodes.length > items.length && !params.similars) {
                    const left = episodes.slice(items.length);
                    left.forEach(function(episode) {
                        const info = [];
                        if (episode.vote_average) {
                            info.push(Lampa.Template.get('bandera_online_rate', {
                                rate: parseFloat(episode.vote_average + '').toFixed(1)
                            }, true));
                        }
                        if (episode.air_date) {
                            info.push(Lampa.Utils.parseTime(episode.air_date).full);
                        }
                        
                        const air = new Date((episode.air_date + '').replace(/-/g, '/'));
                        const now = Date.now();
                        const day = Math.round((air.getTime() - now) / (24 * 60 * 60 * 1000));
                        const txt = `${Lampa.Lang.translate('full_episode_days_left')}: ${day}`;
                        
                        const html = Lampa.Template.get('bandera_online_full', {
                            time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true),
                            info: info.length ? info.map(i => `<span>${i}</span>`).join('<span class="online-prestige-split">●</span>') : '',
                            title: episode.name,
                            quality: day > 0 ? txt : ''
                        });
                        
                        const loader = html.find('.online-prestige__loader');
                        const image = html.find('.online-prestige__img');
                        const season = items[0] ? items[0].season : 1;
                        
                        html.find('.online-prestige__timeline').append(
                            Lampa.Timeline.render(Lampa.Timeline.view(
                                Lampa.Utils.hash([season, episode.episode_number, object.movie.original_title].join(''))
                            ))
                        );
                        
                        const img = html.find('img')[0];
                        if (episode.still_path) {
                            img.onerror = function() {
                                img.src = './img/img_broken.svg';
                            };
                            img.onload = function() {
                                image.addClass('online-prestige__img--loaded');
                                loader.remove();
                                image.append(`<div class="online-prestige__episode-number">${('0' + episode.episode_number).slice(-2)}</div>`);
                            };
                            img.src = Lampa.TMDB.image('t/p/w300' + episode.still_path);
                            images.push(img);
                        } else {
                            loader.remove();
                            image.append(`<div class="online-prestige__episode-number">${('0' + episode.episode_number).slice(-2)}</div>`);
                        }
                        
                        html.on('hover:focus', function(e) {
                            last = e.target;
                            scroll.update($(e.target), true);
                        });
                        
                        scroll.append(html);
                    });
                }
                
                if (scroll_to_element) {
                    last = scroll_to_element[0];
                } else if (scroll_to_mark) {
                    last = scroll_to_mark[0];
                }
                
                Lampa.Controller.enable('content');
            });
        };

        this.contextMenu = function(params) {
            params.html.on('hover:long', function() {
                function show(extra) {
                    const enabled = Lampa.Controller.enabled().name;
                    const menu = [];
                    
                    if (Lampa.Platform.is('webos')) {
                        menu.push({ title: `${Lampa.Lang.translate('player_lauch')} - Webos`, player: 'webos' });
                    }
                    if (Lampa.Platform.is('android')) {
                        menu.push({ title: `${Lampa.Lang.translate('player_lauch')} - Android`, player: 'android' });
                    }
                    menu.push({ title: `${Lampa.Lang.translate('player_lauch')} - Lampa`, player: 'lampa' });
                    menu.push({ title: Lampa.Lang.translate('online_video'), separator: true });
                    menu.push({ title: Lampa.Lang.translate('torrent_parser_label_title'), mark: true });
                    menu.push({ title: Lampa.Lang.translate('torrent_parser_label_cancel_title'), unmark: true });
                    menu.push({ title: Lampa.Lang.translate('time_reset'), timeclear: true });
                    
                    if (extra) {
                        menu.push({ title: Lampa.Lang.translate('copy_link'), copylink: true });
                    }
                    
                    menu.push({ title: Lampa.Lang.translate('more'), separator: true });
                    
                    if (Lampa.Account.logged() && params.element && 
                        typeof params.element.season !== 'undefined' && params.element.translate_voice) {
                        menu.push({ title: Lampa.Lang.translate('online_voice_subscribe'), subscribe: true });
                    }
                    
                    menu.push({ title: Lampa.Lang.translate('online_clear_all_marks'), clearallmark: true });
                    menu.push({ title: Lampa.Lang.translate('online_clear_all_timecodes'), timeclearall: true });
                    
                    Lampa.Select.show({
                        title: Lampa.Lang.translate('title_action'),
                        items: menu,
                        onBack: function() {
                            Lampa.Controller.toggle(enabled);
                        },
                        onSelect: function(a) {
                            if (a.mark) params.element.mark();
                            if (a.unmark) params.element.unmark();
                            if (a.timeclear) params.element.timeclear();
                            if (a.clearallmark) params.onClearAllMark();
                            if (a.timeclearall) params.onClearAllTime();
                            
                            Lampa.Controller.toggle(enabled);
                            
                            if (a.player) {
                                Lampa.Player.runas(a.player);
                                params.html.trigger('hover:enter');
                            }
                            
                            if (a.copylink) {
                                if (extra.quality) {
                                    const qual = [];
                                    for (const i in extra.quality) {
                                        qual.push({ title: i, file: extra.quality[i] });
                                    }
                                    
                                    Lampa.Select.show({
                                        title: Lampa.Lang.translate('settings_server_links'),
                                        items: qual,
                                        onBack: function() {
                                            Lampa.Controller.toggle(enabled);
                                        },
                                        onSelect: function(b) {
                                            Lampa.Utils.copyTextToClipboard(b.file,
                                                function() {
                                                    Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
                                                },
                                                function() {
                                                    Lampa.Noty.show(Lampa.Lang.translate('copy_error'));
                                                }
                                            );
                                        }
                                    });
                                } else {
                                    Lampa.Utils.copyTextToClipboard(extra.file,
                                        function() {
                                            Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
                                        },
                                        function() {
                                            Lampa.Noty.show(Lampa.Lang.translate('copy_error'));
                                        }
                                    );
                                }
                            }
                            
                            if (a.subscribe) {
                                Lampa.Account.subscribeToTranslation({
                                    card: object.movie,
                                    season: params.element.season,
                                    episode: params.element.translate_episode_end,
                                    voice: params.element.translate_voice
                                },
                                function() {
                                    Lampa.Noty.show(Lampa.Lang.translate('online_voice_success'));
                                },
                                function() {
                                    Lampa.Noty.show(Lampa.Lang.translate('online_voice_error'));
                                });
                            }
                        }
                    });
                }
                params.onFile(show);
            }).on('hover:focus', function() {
                if (Lampa.Helper) {
                    Lampa.Helper.show('online_file', Lampa.Lang.translate('helper_online_file'), params.html);
                }
            });
        };

        this.empty = function(msg) {
            const html = Lampa.Template.get('bandera_online_does_not_answer', {});
            html.find('.online-empty__buttons').remove();
            html.find('.online-empty__title').text(Lampa.Lang.translate('empty_title_two'));
            html.find('.online-empty__time').text(Lampa.Lang.translate('empty_text'));
            scroll.append(html);
            this.loading(false);
        };

        this.doesNotAnswer = function() {
            const self = this;
            this.reset();
            
            const html = Lampa.Template.get('bandera_online_does_not_answer', {
                balanser: balanser_titles[balanser] || balanser
            });
            
            let tic = 10;
            html.find('.cancel').on('hover:enter', function() {
                clearInterval(balanser_timer);
            });
            
            html.find('.change').on('hover:enter', function() {
                clearInterval(balanser_timer);
                filter.render().find('.filter--sort').trigger('hover:enter');
            });
            
            scroll.append(html);
            this.loading(false);
            
            balanser_timer = setInterval(function() {
                tic--;
                html.find('.timeout').text(tic);
                if (tic == 0) {
                    clearInterval(balanser_timer);
                    const keys = Lampa.Arrays.getKeys(sources);
                    const indx = keys.indexOf(balanser);
                    let next = keys[indx + 1];
                    if (!next) next = keys[0];
                    balanser = next;
                    
                    if (Lampa.Activity.active().activity == self.activity) {
                        self.changeBalanser(balanser);
                    }
                }
            }, 1000);
        };

        this.getLastEpisode = function(items) {
            let last_episode = 0;
            items.forEach(function(e) {
                if (typeof e.episode !== 'undefined') {
                    last_episode = Math.max(last_episode, parseInt(e.episode));
                }
            });
            return last_episode;
        };

        this.start = function() {
            if (Lampa.Activity.active().activity !== this.activity) return;
            
            if (!initialized) {
                initialized = true;
                this.initialize();
            }
            
            Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
            
            Lampa.Controller.add('content', {
                toggle: function() {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function() {
                    if (Navigator.canmove('up')) {
                        Navigator.move('up');
                    } else {
                        Lampa.Controller.toggle('head');
                    }
                },
                down: function() {
                    Navigator.move('down');
                },
                right: function() {
                    if (Navigator.canmove('right')) {
                        Navigator.move('right');
                    } else {
                        filter.show(Lampa.Lang.translate('title_filter'), 'filter');
                    }
                },
                left: function() {
                    if (Navigator.canmove('left')) {
                        Navigator.move('left');
                    } else {
                        Lampa.Controller.toggle('menu');
                    }
                },
                gone: function() {
                    clearInterval(balanser_timer);
                },
                back: this.back
            });
            
            Lampa.Controller.toggle('content');
        };

        this.render = function() {
            return files.render();
        };

        this.back = function() {
            Lampa.Activity.backward();
        };

        this.pause = function() {};
        this.stop = function() {};

        this.destroy = function() {
            network.clear();
            this.clearImages();
            files.destroy();
            scroll.destroy();
            clearInterval(balanser_timer);
            if (source) source.destroy();
        };
    }

    // ================================
    // PLUGIN INITIALIZATION
    // ================================
    function startPlugin() {
        window.bandera_online = true;
        
        function resetTemplates() {
            Lampa.Template.add('bandera_online_full', `<div class="online-prestige online-prestige--full selector">
                <div class="online-prestige__img">
                    <img alt="">
                    <div class="online-prestige__loader"></div>
                </div>
                <div class="online-prestige__body">
                    <div class="online-prestige__head">
                        <div class="online-prestige__title">{title}</div>
                        <div class="online-prestige__time">{time}</div>
                    </div>
                    <div class="online-prestige__timeline"></div>
                    <div class="online-prestige__footer">
                        <div class="online-prestige__info">{info}</div>
                        <div class="online-prestige__quality">{quality}</div>
                    </div>
                </div>
            </div>`);
            
            Lampa.Template.add('bandera_online_does_not_answer', `<div class="online-empty">
                <div class="online-empty__title">#{online_balanser_dont_work}</div>
                <div class="online-empty__time">#{online_balanser_timeout}</div>
                <div class="online-empty__buttons">
                    <div class="online-empty__button selector cancel">#{cancel}</div>
                    <div class="online-empty__button selector change">#{online_change_balanser}</div>
                </div>
                <div class="online-empty__templates">
                    <div class="online-empty-template">
                        <div class="online-empty-template__ico"></div>
                        <div class="online-empty-template__body"></div>
                    </div>
                    <div class="online-empty-template">
                        <div class="online-empty-template__ico"></div>
                        <div class="online-empty-template__body"></div>
                    </div>
                    <div class="online-empty-template">
                        <div class="online-empty-template__ico"></div>
                        <div class="online-empty-template__body"></div>
                    </div>
                </div>
            </div>`);
            
            Lampa.Template.add('bandera_online_rate', `<div class="online-prestige-rate">
                <svg width="17" height="16" viewBox="0 0 17 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8.39409 0.192139L10.99 5.30994L16.7882 6.20387L12.5475 10.4277L13.5819 15.9311L8.39409 13.2425L3.20626 15.9311L4.24065 10.4277L0 6.20387L5.79819 5.30994L8.39409 0.192139Z" fill="#fff"></path>
                </svg>
                <span>{rate}</span>
            </div>`);
            
            Lampa.Template.add('bandera_online_folder', `<div class="online-prestige online-prestige--folder selector">
                <div class="online-prestige__folder">
                    <svg viewBox="0 0 128 112" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect y="20" width="128" height="92" rx="13" fill="white"></rect>
                        <path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"></path>
                        <rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"></rect>
                    </svg>
                </div>
                <div class="online-prestige__body">
                    <div class="online-prestige__head">
                        <div class="online-prestige__title">{title}</div>
                        <div class="online-prestige__time">{time}</div>
                    </div>
                    <div class="online-prestige__footer">
                        <div class="online-prestige__info">{info}</div>
                    </div>
                </div>
            </div>`);
            
            Lampa.Template.add('bandera_online_watched', `<div class="online-prestige online-prestige-watched selector">
                <div class="online-prestige-watched__icon">
                    <svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="10.5" cy="10.5" r="9" stroke="currentColor" stroke-width="3"/>
                        <path d="M14.8477 10.5628L8.20312 14.399L8.20313 6.72656L14.8477 10.5628Z" fill="currentColor"/>
                    </svg>
                </div>
                <div class="online-prestige-watched__body"></div>
            </div>`);
        }
        
        const manifest = {
            type: 'video',
            version: '2.0.0',
            name: '[Free] Bandera Online',
            component: 'bandera_online',
            onContextMenu: function(object) {
                return {
                    name: Lampa.Lang.translate('online_watch'),
                    description: ''
                };
            },
            onContextLauch: function(object) {
                resetTemplates();
                Lampa.Component.add('bandera_online', Component);
                Lampa.Activity.push({
                    url: '',
                    title: Lampa.Lang.translate('title_online'),
                    component: 'bandera_online',
                    search: object.title,
                    search_one: object.title,
                    search_two: object.original_title,
                    movie: object,
                    page: 1
                });
            }
        };
        
        Lampa.Manifest.plugins = manifest;
        
        // Language translations
        Lampa.Lang.add({
            online_watch: {
                ru: 'Смотреть онлайн',
                en: 'Watch online',
                ua: 'Дивитися онлайн',
                zh: '在线观看'
            },
            online_no_watch_history: {
                ru: 'Нет истории просмотра',
                en: 'No browsing history',
                ua: 'Немає історії перегляду',
                zh: '没有浏览历史'
            },
            online_video: {
                ru: 'Видео',
                en: 'Video',
                ua: 'Відео',
                zh: '视频'
            },
            online_nolink: {
                ru: 'Не удалось извлечь ссылку',
                uk: 'Неможливо отримати посилання',
                en: 'Failed to fetch link',
                zh: '获取链接失败'
            },
            online_waitlink: {
                ru: 'Работаем над извлечением ссылки, подождите...',
                uk: 'Працюємо над отриманням посилання, зачекайте...',
                en: 'Working on extracting the link, please wait...',
                zh: '正在提取链接，请稍候...'
            },
            online_balanser: {
                ru: 'Источник',
                uk: 'Джерело',
                en: 'Source',
                zh: '来源'
            },
            helper_online_file: {
                ru: 'Удерживайте клавишу "ОК" для вызова контекстного меню',
                uk: 'Утримуйте клавішу "ОК" для виклику контекстного меню',
                en: 'Hold the "OK" key to bring up the context menu',
                zh: '按住“确定”键调出上下文菜单'
            },
            online_query_start: {
                ru: 'По запросу',
                uk: 'На запит',
                en: 'On request',
                zh: '根据要求'
            },
            online_query_end: {
                ru: 'нет результатов',
                uk: 'немає результатів',
                en: 'no results',
                zh: '没有结果'
            },
            title_proxy: {
                ru: 'Прокси',
                uk: 'Проксі',
                en: 'Proxy',
                zh: '代理人'
            },
            online_proxy_title: {
                ru: 'Основной прокси',
                uk: 'Основний проксі',
                en: 'Main proxy',
                zh: '主要代理'
            },
            online_proxy_descr: {
                ru: 'Будет использоваться для всех балансеров',
                uk: 'Використовуватиметься для всіх балансерів',
                en: 'Will be used for all balancers',
                zh: '将用于所有平衡器'
            },
            online_proxy_placeholder: {
                ru: 'Например: http://proxy.com',
                uk: 'Наприклад: http://proxy.com',
                en: 'For example: http://proxy.com',
                zh: '例如：http://proxy.com'
            },
            online_voice_subscribe: {
                ru: 'Подписаться на перевод',
                uk: 'Підписатися на переклад',
                en: 'Subscribe to translation',
                zh: '订阅翻译'
            },
            online_voice_success: {
                ru: 'Вы успешно подписались',
                uk: 'Ви успішно підписалися',
                en: 'You have successfully subscribed',
                zh: '您已成功订阅'
            },
            online_voice_error: {
                ru: 'Возникла ошибка',
                uk: 'Виникла помилка',
                en: 'An error has occurred',
                zh: '发生了错误'
            },
            online_clear_all_marks: {
                ru: 'Очистить все метки',
                uk: 'Очистити всі мітки',
                en: 'Clear all labels',
                zh: '清除所有标签'
            },
            online_clear_all_timecodes: {
                ru: 'Очистить все тайм-коды',
                uk: 'Очистити всі тайм-коди',
                en: 'Clear all timecodes',
                zh: '清除所有时间代码'
            },
            online_change_balanser: {
                ru: 'Изменить балансер',
                uk: 'Змінити балансер',
                en: 'Change balancer',
                zh: '更改平衡器'
            },
            online_balanser_dont_work: {
                ru: 'Балансер ({balanser}) не отвечает на запрос.',
                uk: 'Балансер ({balanser}) не відповідає на запит.',
                en: 'Balancer ({balanser}) does not respond to the request.',
                zh: '平衡器（{balanser}）未响应请求。'
            },
            online_balanser_timeout: {
                ru: 'Балансер будет переключен автоматически через <span class="timeout">10</span> секунд.',
                uk: 'Балансер буде переключено автоматично через <span class="timeout">10</span> секунд.',
                en: 'Balancer will be switched automatically in <span class="timeout">10</span> seconds.',
                zh: '平衡器将在<span class="timeout">10</span>秒内自动切换。'
            }
        });
        
        // Add CSS styles
        Lampa.Template.add('bandera_online_css', `
        <style>
        @charset 'UTF-8';
        .online-prestige{position:relative;-webkit-border-radius:.3em;-moz-border-radius:.3em;border-radius:.3em;background-color:rgba(0,0,0,0.3);display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;will-change:transform}
        .online-prestige__body{padding:1.2em;line-height:1.3;-webkit-box-flex:1;-webkit-flex-grow:1;-moz-box-flex:1;-ms-flex-positive:1;flex-grow:1;position:relative}
        @media screen and (max-width:480px){.online-prestige__body{padding:.8em 1.2em}}
        .online-prestige__img{position:relative;width:13em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;min-height:8.2em}
        .online-prestige__img>img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;-webkit-border-radius:.3em;-moz-border-radius:.3em;border-radius:.3em;opacity:0;-webkit-transition:opacity .3s;-o-transition:opacity .3s;-moz-transition:opacity .3s;transition:opacity .3s}
        .online-prestige__img--loaded>img{opacity:1}
        @media screen and (max-width:480px){.online-prestige__img{width:7em;min-height:6em}}
        .online-prestige__folder{padding:1em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}
        .online-prestige__folder>svg{width:4.4em !important;height:4.4em !important}
        .online-prestige__viewed{position:absolute;top:1em;left:1em;background:rgba(0,0,0,0.45);-webkit-border-radius:100%;-moz-border-radius:100%;border-radius:100%;padding:.25em;font-size:.76em}
        .online-prestige__viewed>svg{width:1.5em !important;height:1.5em !important}
        .online-prestige__episode-number{position:absolute;top:0;left:0;right:0;bottom:0;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-box-pack:center;-webkit-justify-content:center;-moz-box-pack:center;-ms-flex-pack:center;justify-content:center;font-size:2em}
        .online-prestige__loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin-left:-1em;margin-top:-1em;background:url(./img/loader.svg) no-repeat center center;-webkit-background-size:contain;-moz-background-size:contain;-o-background-size:contain;background-size:contain}
        .online-prestige__head,.online-prestige__footer{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-pack:justify;-webkit-justify-content:space-between;-moz-box-pack:justify;-ms-flex-pack:justify;justify-content:space-between;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}
        .online-prestige__timeline{margin:.8em 0}
        .online-prestige__timeline>.time-line{display:block !important}
        .online-prestige__title{font-size:1.7em;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}
        @media screen and (max-width:480px){.online-prestige__title{font-size:1.4em}}
        .online-prestige__time{padding-left:2em}
        .online-prestige__info{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}
        .online-prestige__info>*{overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}
        .online-prestige__quality{padding-left:1em;white-space:nowrap}
        .online-prestige__scan-file{position:absolute;bottom:0;left:0;right:0}
        .online-prestige__scan-file .broadcast__scan{margin:0}
        .online-prestige .online-prestige-split{font-size:.8em;margin:0 1em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}
        .online-prestige.focus::after{content:'';position:absolute;top:-0.6em;left:-0.6em;right:-0.6em;bottom:-0.6em;-webkit-border-radius:.7em;-moz-border-radius:.7em;border-radius:.7em;border:solid .3em #fff;z-index:-1;pointer-events:none}
        .online-prestige+.online-prestige{margin-top:1.5em}
        .online-prestige--folder .online-prestige__footer{margin-top:.8em}
        .online-prestige-watched{padding:1em}
        .online-prestige-watched__icon>svg{width:1.5em;height:1.5em}
        .online-prestige-watched__body{padding-left:1em;padding-top:.1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-flex-wrap:wrap;-ms-flex-wrap:wrap;flex-wrap:wrap}
        .online-prestige-watched__body>span+span::before{content:' ● ';vertical-align:top;display:inline-block;margin:0 .5em}
        .online-prestige-rate{display:-webkit-inline-box;display:-webkit-inline-flex;display:-moz-inline-box;display:-ms-inline-flexbox;display:inline-flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}
        .online-prestige-rate>svg{width:1.3em !important;height:1.3em !important}
        .online-prestige-rate>span{font-weight:600;font-size:1.1em;padding-left:.7em}
        .online-empty{line-height:1.4}
        .online-empty__title{font-size:1.8em;margin-bottom:.3em}
        .online-empty__time{font-size:1.2em;font-weight:300;margin-bottom:1.6em}
        .online-empty__buttons{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}
        .online-empty__buttons>*+*{margin-left:1em}
        .online-empty__button{background:rgba(0,0,0,0.3);font-size:1.2em;padding:.5em 1.2em;-webkit-border-radius:.2em;-moz-border-radius:.2em;border-radius:.2em;margin-bottom:2.4em}
        .online-empty__button.focus{background:#fff;color:black}
        .online-empty__templates .online-empty-template:nth-child(2){opacity:.5}
        .online-empty__templates .online-empty-template:nth-child(3){opacity:.2}
        .online-empty-template{background-color:rgba(255,255,255,0.3);padding:1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-border-radius:.3em;-moz-border-radius:.3em;border-radius:.3em}
        .online-empty-template>*{background:rgba(0,0,0,0.3);-webkit-border-radius:.3em;-moz-border-radius:.3em;border-radius:.3em}
        .online-empty-template__ico{width:4em;height:4em;margin-right:2.4em}
        .online-empty-template__body{height:1.7em;width:70%}
        .online-empty-template+.online-empty-template{margin-top:1em}
        </style>
        `);
        
        $('body').append(Lampa.Template.get('bandera_online_css', {}, true));
        
        // Add button to movie page
        const button = `<div class="full-start__button selector view--online" data-subtitle="[Free] Bandera Online v${manifest.version}">
            <svg viewBox="0 -4 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g id="SVGRepo_bgCarrier" stroke-width="0"></g>
                <g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g>
                <g id="SVGRepo_iconCarrier">
                    <g clip-path="url(#clip0_503_2809)">
                        <rect width="28" height="20" rx="2" fill="white"></rect>
                        <mask id="mask0_503_2809" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="28" height="20">
                            <rect width="28" height="20" rx="2" fill="white"></rect>
                        </mask>
                        <g mask="url(#mask0_503_2809)">
                            <path fill-rule="evenodd" clip-rule="evenodd" d="M0 10.6667H28V0H0V10.6667Z" fill="#156DD1"></path>
                            <path fill-rule="evenodd" clip-rule="evenodd" d="M0 20H28V10.6667H0V20Z" fill="#FFD948"></path>
                        </g>
                    </g>
                    <defs>
                        <clipPath id="clip0_503_2809">
                            <rect width="28" height="20" rx="2" fill="white"></rect>
                        </clipPath>
                    </defs>
                </g>
            </svg>
            <span>Спільнота t.me/mmssixxx</span>
        </div>`;
        
        Lampa.Component.add('bandera_online', Component);
        resetTemplates();
        
        Lampa.Listener.follow('full', function(e) {
            if (e.type == 'complite') {
                const btn = $(Lampa.Lang.translate(button));
                btn.on('hover:enter', function() {
                    resetTemplates();
                    Lampa.Component.add('bandera_online', Component);
                    Lampa.Activity.push({
                        url: '',
                        title: "Спільнота t.me/mmssixxx",
                        component: 'bandera_online',
                        search: e.data.movie.title,
                        search_one: e.data.movie.title,
                        search_two: e.data.movie.original_title,
                        movie: e.data.movie,
                        page: 1
                    });
                });
                e.object.activity.render().find('.view--torrent').after(btn);
            }
        });
    }

    // Start plugin
    if (!window.bandera_online && Lampa.Manifest.app_digital >= 155) {
        startPlugin();
    }
})();
