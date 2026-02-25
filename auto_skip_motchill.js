// ==UserScript==
// @name         Motchill Tools (Skip Intro, Auto Next, Save Speed)
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Hỗ trợ skip intro, auto next, lưu tốc độ xem cho motchilltv.chat (Smart Learning Mode + Speed Control + Fast Learn + Data Sync + Smart AdBlock)
// @author       Antigravity
// @match        *://motchill*.*/xem-phim-*
// @updateURL    https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/auto_skip_motchill.js
// @downloadURL  https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/auto_skip_motchill.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    // @match        *://*.motchill*.*/*
    // @include      /^https?:\/\/(www\.)?motchill.*\..*\/.*$/

    // --- Smart Popup Blocker ---
    // Policies:
    // 1. Block different-domain popups.
    // 2. Allow same-domain popups.
    // 3. Allow popups if user holds modifier keys (Cmd/Ctrl/Alt) or double-clicks.

    let forceAllowPopup = false;
    const originalOpen = window.open;

    function tempAllow() {
        forceAllowPopup = true;
        // Reset after short time
        setTimeout(() => forceAllowPopup = false, 500);
    }

    // Detect user intent
    ['mousedown', 'keydown', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) {
                tempAllow();
            }
        }, true);
    });

    window.addEventListener('dblclick', (e) => {
        tempAllow();
    }, true);

    function hookOpen(url, target, features) {
        // 1. Force Allow (User Intent)
        if (forceAllowPopup) {
            console.log('[MotchillTool] Allowing popup (User Intent):', url);
            return originalOpen.apply(window, arguments);
        }

        // 2. Same Domain Check
        if (url) {
            try {
                // If it's a relative path, it resolves to current origin, so hostname matches.
                // If it's absolute, we check hostname.
                const targetUrl = new URL(url, window.location.href);
                const currentHost = window.location.hostname;

                // Allow if same hostname OR if it's a submodule of motchill (loose check)
                if (targetUrl.hostname === currentHost || targetUrl.hostname.includes('motchill')) {
                    console.log('[MotchillTool] Allowing popup (Same Domain):', url);
                    return originalOpen.apply(window, arguments);
                }
            } catch (e) {
                // If URL parsing fails (e.g. 'about:blank'), usually safe to allow as it might be internal
                console.log('[MotchillTool] Allowing popup (Invalid/Internal URL):', url);
                return originalOpen.apply(window, arguments);
            }
        } else {
            // Window.open() with no URL is often used for writing content
            return originalOpen.apply(window, arguments);
        }

        console.log('[MotchillTool] Blocked external popup:', url);
        return null; // Block
    }

    // Apply Override
    try {
        window.open = hookOpen;
        if (window.unsafeWindow) {
            window.unsafeWindow.open = hookOpen;
        }
    } catch (e) {
        console.error('[MotchillTool] Error hooking window.open', e);
    }


    const STORAGE_PREFIX = 'motchill_v3_';
    const REQUIRED_SAMPLES_DEFAULT = 1;

    // --- Helpers for Storage ---
    function getSettings(key, defaultVal) {
        try {
            const val = localStorage.getItem(STORAGE_PREFIX + key);
            return val ? JSON.parse(val) : defaultVal;
        } catch (e) {
            console.error('[MotchillTool] Error reading settings', e);
            return defaultVal;
        }
    }

    function saveSettings(key, val) {
        try {
            localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(val));
        } catch (e) {
            console.error('[MotchillTool] Error saving settings', e);
        }
    }

    // --- Core Data & Logic ---
    let player = null;
    let movieData = {
        movieId: null,
        samples: [], // { epId, intro, outroOffset }
        avgIntro: null,
        avgOutroOffset: null
    };
    let currentEpisodeId = null;
    let hasSkippedIntro = false;
    let isNextTriggered = false;
    let savedSpeed = 1.0;

    // New States
    let instantMode = true;
    let isAutoEnabled = true;
    let isRewindEnabled = true;
    let effectiveValues = { intro: null, outroOffset: null };
    let isSpeedStabilized = false;

    function getIds() {
        // Try Nuxt data structure
        let mId = null;
        let epId = null;

        if (window.__NUXT__) {
            const data = window.__NUXT__.data || window.__NUXT__.state;
            if (data && data.episode) {
                const epObj = data.episode.episode || data.episode;
                mId = epObj.movie_id || (data.movie ? data.movie.id : null);
                epId = epObj.id;
            }
        }

        // Fallback: URL parsing
        if (!mId || !epId) {
            const path = window.location.pathname;
            const match = path.match(/xem-phim-(.+?)-tap-(\d+)/);
            if (match) {
                mId = match[1];
                epId = match[2];
            } else {
                mId = path;
                epId = path;
            }
        }
        return { movieId: mId, episodeId: epId };
    }

    function loadData() {
        const ids = getIds();
        if (!ids.movieId) return;

        movieData.movieId = ids.movieId;
        currentEpisodeId = ids.episodeId;

        // Load Skip Intro/Next Data
        const saved = getSettings('movie_' + ids.movieId, { samples: [] });
        movieData.samples = saved.samples || [];
        movieData.avgIntro = saved.avgIntro || null;
        movieData.avgOutroOffset = saved.avgOutroOffset || null;

        // Load Settings
        savedSpeed = getSettings('speed_' + ids.movieId, getSettings('speed_global', 1.0));
        instantMode = getSettings('instant_mode_' + ids.movieId, getSettings('instant_mode_global', true));
        isAutoEnabled = getSettings('auto_enabled_global', true);
        isRewindEnabled = getSettings('rewind_enabled_global', true);
        isSpeedStabilized = false; // Reset on load

        recalcEffectiveValues();

        console.log('[MotchillTool] Loaded data for movie', ids.movieId, movieData, 'Speed:', savedSpeed, 'FastLearn:', instantMode, 'Auto:', isAutoEnabled, 'Rewind:', isRewindEnabled);
        updateUI();
        applySpeed();
    }

    function saveData() {
        if (!movieData.movieId) return;

        // Recalculate averages just for storage/stats
        const validIntros = movieData.samples.filter(s => s.intro !== null && s.intro !== undefined);
        const validOutros = movieData.samples.filter(s => s.outroOffset !== null && s.outroOffset !== undefined);

        if (validIntros.length > 0) {
            const sum = validIntros.reduce((acc, s) => acc + s.intro, 0);
            movieData.avgIntro = sum / validIntros.length;
        }

        if (validOutros.length > 0) {
            const sum = validOutros.reduce((acc, s) => acc + s.outroOffset, 0);
            movieData.avgOutroOffset = sum / validOutros.length;
        }

        saveSettings('movie_' + movieData.movieId, {
            samples: movieData.samples,
            avgIntro: movieData.avgIntro,
            avgOutroOffset: movieData.avgOutroOffset
        });

        recalcEffectiveValues();
        updateUI();
    }

    function recalcEffectiveValues() {
        // Reset
        effectiveValues = { intro: null, outroOffset: null };
        const required = REQUIRED_SAMPLES_DEFAULT;

        // 1. Check Specific Episode Sample (Highest Priority)
        const currentSample = movieData.samples.find(s => s.epId === currentEpisodeId);

        // Intro Logic
        if (currentSample && currentSample.intro !== null && currentSample.intro !== undefined) {
            effectiveValues.intro = currentSample.intro;
        } else {
            // Fallback to Average ONLY IF Fast Learn (Instant Mode) is ON
            if (instantMode) {
                const validIntros = movieData.samples.filter(s => s.intro !== null && s.intro !== undefined);
                if (validIntros.length >= required) {
                    const sum = validIntros.reduce((acc, s) => acc + s.intro, 0);
                    effectiveValues.intro = sum / validIntros.length;
                }
            }
        }

        // Outro Logic
        if (currentSample && currentSample.outroOffset !== null && currentSample.outroOffset !== undefined) {
            effectiveValues.outroOffset = currentSample.outroOffset;
        } else {
            // Fallback to Average ONLY IF Fast Learn (Instant Mode) is ON
            if (instantMode) {
                const validOutros = movieData.samples.filter(s => s.outroOffset !== null && s.outroOffset !== undefined);
                if (validOutros.length >= required) {
                    const sum = validOutros.reduce((acc, s) => acc + s.outroOffset, 0);
                    effectiveValues.outroOffset = sum / validOutros.length;
                }
            }
        }
    }

    function addSample(intro, outroOffset) {
        const existingIdx = movieData.samples.findIndex(s => s.epId === currentEpisodeId);

        if (existingIdx !== -1) {
            if (intro !== null) movieData.samples[existingIdx].intro = intro;
            if (outroOffset !== null) movieData.samples[existingIdx].outroOffset = outroOffset;
        } else {
            movieData.samples.push({
                epId: currentEpisodeId,
                intro: intro,
                outroOffset: outroOffset
            });
        }
        saveData();
    }

    function setIntro() {
        if (!player) return;
        const t = player.getPosition();
        addSample(t, null); // 0 is a valid time
        console.log('[MotchillTool] Intro sample set:', t);
    }

    function setOutro() {
        if (!player) return;
        const t = player.getPosition();
        const d = player.getDuration();
        if (d && d > 0) {
            const offset = d - t;
            addSample(null, offset);
            console.log('[MotchillTool] Outro sample set (offset):', offset);

            // Auto Rewind Logic
            if (isRewindEnabled) {
                console.log('[MotchillTool] Rewinding to start (Auto Rewind ON)...');
                player.seek(0);
            }
        }
    }

    function clearData() {
        if (confirm('Xóa toàn bộ dữ liệu học được cho phim này?')) {
            movieData.samples = [];
            movieData.avgIntro = null;
            movieData.avgOutroOffset = null;
            saveData();
        }
    }

    function toggleInstantMode(e) {
        instantMode = e.target.checked;
        if (movieData.movieId) {
            saveSettings('instant_mode_' + movieData.movieId, instantMode);
        }
        saveSettings('instant_mode_global', instantMode);
        recalcEffectiveValues();
        updateUI();
    }

    function toggleAutoEnable(e) {
        isAutoEnabled = e.target.checked;
        saveSettings('auto_enabled_global', isAutoEnabled);
        updateUI();
    }

    function toggleRewind(e) {
        isRewindEnabled = e.target.checked;
        saveSettings('rewind_enabled_global', isRewindEnabled);
        updateUI();
    }

    // --- Data Sync Logic ---
    function exportData() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(STORAGE_PREFIX)) {
                data[key.replace(STORAGE_PREFIX, '')] = JSON.parse(localStorage.getItem(key));
            }
        }
        const json = JSON.stringify(data);

        const input = document.getElementById('motchill-data-input');
        if (input) {
            input.value = json;
            input.select();

            // Try Async Clipboard API
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(json).then(() => {
                    alert('Data copied to clipboard!');
                }).catch(err => {
                    console.error('Clipboard API failed', err);
                    // Fallback
                    document.execCommand('copy');
                    alert('Data copied (fallback)!');
                });
            } else {
                document.execCommand('copy');
                alert('Data copied!');
            }
        }
    }

    function importData() {
        const input = document.getElementById('motchill-data-input');
        if (!input || !input.value.trim()) {
            alert('Please paste data into the text box first.');
            return;
        }

        try {
            const data = JSON.parse(input.value.trim());
            let count = 0;
            for (const k in data) {
                saveSettings(k, data[k]);
                count++;
            }
            if (confirm(`Imported ${count} items. Reload page now?`)) {
                location.reload();
            }
        } catch (e) {
            alert('Invalid Data JSON');
            console.error(e);
        }
    }

    // --- Speed Logic ---
    function setSpeed(speed) {
        savedSpeed = parseFloat(speed);
        if (movieData.movieId) {
            saveSettings('speed_' + movieData.movieId, savedSpeed);
        }
        saveSettings('speed_global', savedSpeed);

        updateUI();
        isSpeedStabilized = true;
        applySpeed();
    }

    function applySpeed() {
        const targetSpeed = parseFloat(savedSpeed);
        // 1. JWPlayer API
        if (player && typeof player.getPlaybackRate === 'function') {
            if (Math.abs(player.getPlaybackRate() - targetSpeed) > 0.05) {
                player.setPlaybackRate(targetSpeed);
            }
        } else if (typeof window.jwplayer === 'function') {
            try {
                const jwp = window.jwplayer();
                if (jwp && jwp.getPlaybackRate && Math.abs(jwp.getPlaybackRate() - targetSpeed) > 0.05) {
                    jwp.setPlaybackRate(targetSpeed);
                }
            } catch (e) { }
        }

        // 2. HTML5 Video Element
        const video = document.querySelector('video.jw-video');
        if (video && Math.abs(video.playbackRate - targetSpeed) > 0.05) {
            video.playbackRate = targetSpeed;
        }
    }

    // --- UI ---
    function createUI() {
        if (document.getElementById('motchill-tool-ui')) return;

        const container = document.createElement('div');
        container.id = 'motchill-tool-ui';
        container.style.cssText = `
            position: fixed; top: 150px; right: 20px;
            background: rgba(26, 26, 26, 0.95); color: #fff;
            padding: 12px; border-radius: 8px; z-index: 999999;
            font-family: sans-serif; font-size: 12px;
            border: 1px solid #A3765D; display: flex; flex-direction: column; gap: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5); width: 250px;
        `;

        // 1. Header (Draggable)
        const title = document.createElement('div');
        title.innerHTML = '<b style="color: #A3765D;">Motchill Tools</b>';
        title.style.textAlign = 'center';
        title.style.cursor = 'move';
        title.style.paddingBottom = '5px';
        title.style.borderBottom = '1px solid #444';
        container.appendChild(title);

        // 2. Status Info
        const statusDiv = document.createElement('div');
        statusDiv.id = 'motchill-status';
        statusDiv.style.color = '#ccc';
        statusDiv.innerHTML = 'Loading...';
        container.appendChild(statusDiv);

        // 3. Intro/Next Buttons
        const actionGrid = document.createElement('div');
        actionGrid.style.display = 'grid';
        actionGrid.style.gridTemplateColumns = '1fr 1fr';
        actionGrid.style.gap = '5px';

        const btnIntro = createBtn('Set Intro', setIntro);
        const btnOutro = createBtn('Set Next', setOutro);

        actionGrid.appendChild(btnIntro);
        actionGrid.appendChild(btnOutro);
        container.appendChild(actionGrid);

        // 4. Options (Rewind, Auto, Fast Learn)
        const optionsRow = document.createElement('div');
        optionsRow.style.display = 'flex';
        optionsRow.style.flexDirection = 'column';
        optionsRow.style.gap = '8px';
        optionsRow.style.marginTop = '4px';

        const btnClear = createBtn('Reset Data', clearData);
        btnClear.style.background = '#422';
        btnClear.style.padding = '4px 8px';
        btnClear.style.fontSize = '10px';
        btnClear.style.alignSelf = 'flex-start';

        // Checkboxes Wrapper
        const checksDiv = document.createElement('div');
        checksDiv.style.display = 'grid';
        checksDiv.style.gridTemplateColumns = '1fr 1fr';
        checksDiv.style.columnGap = '8px';
        checksDiv.style.rowGap = '4px';

        function createCheck(id, checked, changeHandler, labelText) {
            const label = document.createElement('label');
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.gap = '3px';
            label.style.cursor = 'pointer';
            label.style.fontSize = '11px';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.id = id;
            chk.checked = checked;
            chk.onchange = changeHandler;
            label.appendChild(chk);
            label.appendChild(document.createTextNode(labelText));
            return label;
        }

        const autoLabel = createCheck('motchill-auto-check', isAutoEnabled, toggleAutoEnable, 'Auto Skip');
        const instantLabel = createCheck('motchill-instant-check', instantMode, toggleInstantMode, 'Fast Learn');
        const rewindLabel = createCheck('motchill-rewind-check', isRewindEnabled, toggleRewind, 'Rewind');

        checksDiv.appendChild(autoLabel);
        checksDiv.appendChild(instantLabel);
        checksDiv.appendChild(rewindLabel);

        optionsRow.appendChild(checksDiv);
        optionsRow.appendChild(btnClear);
        container.appendChild(optionsRow);

        // 5. Speed Control
        const speedLabel = document.createElement('div');
        speedLabel.innerText = 'Speed Control:';
        speedLabel.style.fontSize = '11px';
        speedLabel.style.color = '#888';
        speedLabel.style.marginTop = '2px';
        container.appendChild(speedLabel);

        const speedGrid = document.createElement('div');
        speedGrid.style.display = 'grid';
        speedGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
        speedGrid.style.gap = '5px';

        [1.0, 1.25, 1.5, 2.0].forEach(s => {
            const btn = document.createElement('button');
            btn.innerText = s + 'x';
            btn.onclick = () => setSpeed(s);
            btn.className = 'motchill-speed-btn';
            btn.style.cssText = `
                background: #333; color: white; border: 1px solid #555;
                padding: 4px; border-radius: 4px; cursor: pointer; font-size: 11px;
            `;
            speedGrid.appendChild(btn);
        });
        container.appendChild(speedGrid);

        // 6. Data Transfer
        const syncLabel = document.createElement('div');
        syncLabel.innerText = 'Data Sync:';
        syncLabel.style.fontSize = '11px';
        syncLabel.style.color = '#888';
        syncLabel.style.marginTop = '5px';
        container.appendChild(syncLabel);

        const syncGrid = document.createElement('div');
        syncGrid.style.display = 'flex';
        syncGrid.style.gap = '5px';

        const dataInput = document.createElement('input');
        dataInput.type = 'text';
        dataInput.id = 'motchill-data-input';
        dataInput.placeholder = 'Paste data...';
        dataInput.style.flex = '1';
        dataInput.style.fontSize = '10px';
        dataInput.style.padding = '3px';
        dataInput.style.background = '#222';
        dataInput.style.border = '1px solid #444';
        dataInput.style.color = '#ccc';

        const btnExp = createBtn('Export', exportData);
        btnExp.style.fontSize = '10px';
        btnExp.style.padding = '3px 6px';

        const btnImp = createBtn('Import', importData);
        btnImp.style.fontSize = '10px';
        btnImp.style.padding = '3px 6px';

        syncGrid.appendChild(dataInput);
        syncGrid.appendChild(btnExp);
        syncGrid.appendChild(btnImp);
        container.appendChild(syncGrid);

        // Append to body
        document.body.appendChild(container);

        // Draggable Logic
        let isDown = false, offset = [0, 0];
        title.onmousedown = (e) => { isDown = true; offset = [container.offsetLeft - e.clientX, container.offsetTop - e.clientY]; };
        document.addEventListener('mouseup', () => isDown = false);
        document.addEventListener('mousemove', (e) => {
            if (isDown) {
                container.style.left = (e.clientX + offset[0]) + 'px';
                container.style.top = (e.clientY + offset[1]) + 'px';
                container.style.right = 'auto'; container.style.bottom = 'auto';
            }
        });
    }

    function createBtn(text, onclick) {
        const btn = document.createElement('button');
        btn.innerText = text;
        btn.style.cssText = `
            cursor: pointer; background: #333; color: white;
            border: 1px solid #555; padding: 6px; border-radius: 4px; font-weight: bold;
        `;
        btn.onclick = onclick;
        return btn;
    }

    function updateUI() {
        const el = document.getElementById('motchill-status');
        if (!el) return;

        // Status Text
        let html = '';
        const required = REQUIRED_SAMPLES_DEFAULT;

        // Show effective status
        if (effectiveValues.intro) {
            html += `<div style="color:#4f4">✔ Intro: ${formatTime(effectiveValues.intro)}</div>`;
        } else {
            const count = movieData.samples.filter(s => s.intro !== null && s.intro !== undefined).length;
            html += `<div>Intro Samples: ${count}/${required}</div>`;
        }

        if (effectiveValues.outroOffset) {
            html += `<div style="color:#4f4">✔ Auto Next: -${formatTime(effectiveValues.outroOffset)}</div>`;
        } else {
            const count = movieData.samples.filter(s => s.outroOffset !== null && s.outroOffset !== undefined).length;
            html += `<div>Outro Samples: ${count}/${required}</div>`;
        }

        html += `<div style="color: #A3765D; margin-top: 4px;">Speed: ${savedSpeed}x</div>`;
        el.innerHTML = html;

        // Checkbox sync
        const instantChk = document.getElementById('motchill-instant-check');
        if (instantChk) instantChk.checked = instantMode;

        const autoChk = document.getElementById('motchill-auto-check');
        if (autoChk) {
            autoChk.checked = isAutoEnabled;
            el.style.opacity = isAutoEnabled ? '1' : '0.5';
        }

        const rewindChk = document.getElementById('motchill-rewind-check');
        if (rewindChk) rewindChk.checked = isRewindEnabled;

        // Highlight Speed Buttons
        const btns = document.querySelectorAll('.motchill-speed-btn');
        btns.forEach(b => {
            if (parseFloat(b.innerText) === savedSpeed) {
                b.style.background = '#A3765D';
                b.style.borderColor = '#C49071';
            } else {
                b.style.background = '#333';
                b.style.borderColor = '#555';
            }
        });
    }

    function formatTime(sec) {
        if (sec === null || sec === undefined) return '--:--';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s < 10 ? '0' + s : s}`;
    }

    // --- Player Logic ---
    function initPlayer() {
        if (typeof window.jwplayer !== 'function') {
            setTimeout(initPlayer, 1000);
            return;
        }

        const jwp = window.jwplayer();
        if (!jwp || !jwp.on) {
            setTimeout(initPlayer, 1000);
            return;
        }

        player = jwp;
        console.log('[MotchillTool] Player attached.');
        // Initial load
        loadData();

        if (player._motchillAttached) return;
        player._motchillAttached = true;

        player.on('playlistItem', () => {
            console.log('[MotchillTool] Playlist item changed (JWPlayer event). Resetting speed stabilization.');
            hasSkippedIntro = false;
            isNextTriggered = false;
            isSpeedStabilized = false;
            if (typeof player.setPlaybackRate === 'function') {
                try { player.setPlaybackRate(1.0); } catch (e) { }
            } else {
                const video = document.querySelector('video.jw-video');
                if (video) video.playbackRate = 1.0;
            }
        });

        player.on('time', (e) => {
            const t = e.position;
            const dur = e.duration;

            // Check Auto Skip Toggle
            if (!isAutoEnabled) return;

            // Use effectiveValues

            // Auto Skip Intro
            if (effectiveValues.intro && !hasSkippedIntro) {
                if (t < effectiveValues.intro - 2) {
                    console.log('[MotchillTool] Auto skipping intro to', effectiveValues.intro);
                    player.seek(effectiveValues.intro);
                    hasSkippedIntro = true;
                }
            }

            // Auto Next
            if (effectiveValues.outroOffset && !isNextTriggered && dur > 0) {
                const triggerTime = dur - effectiveValues.outroOffset;
                if (t >= triggerTime) {
                    console.log('[MotchillTool] Auto next triggered at', t);
                    isNextTriggered = true;
                    goToNextEpisode();
                }
            }

            // Safe Speed Logic
            if (!isSpeedStabilized && isAutoEnabled) {
                // Policy: Only set speed if we don't have an intro to skip OR we have already skipped it
                const needsSkip = (effectiveValues.intro && !hasSkippedIntro);
                if (!needsSkip) {
                    // Wait a bit for player to actually start playing (t > 0.5) to ensure stability
                    if (t > 0.5) {
                        const currentSpeed = (typeof player.getPlaybackRate === 'function') ? player.getPlaybackRate() : 1.0;
                        console.log(`[MotchillTool] Speed transition: ${currentSpeed} -> ${savedSpeed}`);
                        console.log('[MotchillTool] Speed stabilized (Safe Mode). Setting speed:', savedSpeed);
                        applySpeed();
                        isSpeedStabilized = true;
                    }
                }
            }
        });

        player.on('complete', () => {
            if (isAutoEnabled && !isNextTriggered) {
                goToNextEpisode();
            }
        });

        player.on('play', () => {
            if (isSpeedStabilized) applySpeed();
        });
        player.on('seek', () => {
            // If seeking manually, we might want to re-apply speed if stabilized
            if (isSpeedStabilized) applySpeed();
        });
        player.on('levelsChanged', () => {
            if (isSpeedStabilized) applySpeed();
        });

        // Theo dõi tốc độ thực tế của video mỗi 5 giây
        // setInterval(() => {
        //     try {
        //         let isPlaying = false;
        //         let actualSpeed = 1.0;

        //         if (player && typeof player.getState === 'function') {
        //             isPlaying = player.getState() === 'playing';
        //             actualSpeed = (typeof player.getPlaybackRate === 'function') ? player.getPlaybackRate() : 1.0;
        //         } else {
        //             const video = document.querySelector('video.jw-video');
        //             if (video) {
        //                 isPlaying = !video.paused && !video.ended;
        //                 actualSpeed = video.playbackRate;
        //             }
        //         }

        //         if (isPlaying) {
        //             console.log(`[MotchillTool] Hiện tại video đang phát bật ở tốc độ thực tế: ${actualSpeed}x`);
        //         }
        //     } catch (e) { }
        // }, 5000);
    }

    // Periodically enforce speed ONLY if stabilized
    setInterval(() => {
        if (isSpeedStabilized) applySpeed();
    }, 1500);

    function goToNextEpisode() {
        const nextBtn = document.querySelector('.jw-icon-next') || document.querySelector('.item-next');
        if (nextBtn) {
            nextBtn.click();
            return;
        }

        const active = document.querySelector('a[class*="bg-[#A3765D]"]');
        if (active) {
            let next = active.nextElementSibling;
            if (next && next.tagName === 'A') {
                next.click();
                return;
            }
            const all = Array.from(document.querySelectorAll('a[href*="tap-"]'));
            const idx = all.indexOf(active);
            if (idx !== -1 && idx < all.length - 1) {
                all[idx + 1].click();
                return;
            }
        }
        console.log('[MotchillTool] Next episode button not found.');
    }

    // --- Init ---
    const initInterval = setInterval(() => {
        if (document.body) {
            clearInterval(initInterval);
            createUI();
            initPlayer();
        }
    }, 500);

    // Watch for internal navigation
    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            console.log('[MotchillTool] URL changed, resetting...');
            hasSkippedIntro = false;
            isNextTriggered = false;
            isSpeedStabilized = false;

            // Explicitly reset player speed to 1x to ensure accurate transition log for new episode
            if (player && typeof player.setPlaybackRate === 'function') {
                try { player.setPlaybackRate(1.0); } catch (e) { }
            } else {
                const video = document.querySelector('video.jw-video');
                if (video) video.playbackRate = 1.0;
            }

            setTimeout(() => {
                loadData();
                initPlayer();
            }, 1000);
        }
    }, 500);

})();