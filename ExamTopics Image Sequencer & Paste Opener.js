// ==UserScript==
// @name         ExamTopics Image Sequencer & Paste Opener
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  try to take over the world!
// @author       You
// @match        *://*.examtopics.com/*
// @match        *://examtopics.com/*
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/ExamTopics%20Image%20Sequencer%20&%20Paste%20Opener.js
// @downloadURL  https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/ExamTopics%20Image%20Sequencer%20&%20Paste%20Opener.js
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration & State ---
    const delayMs = 1500; // Delay of 1.5s (1-2s range)
    let isAutoEnabled = GM_getValue('et_auto_enabled', false);
    let tabMode = GM_getValue('et_tab_mode', 'new_tab'); // 'new_tab' or 'same_tab'
    let autoTarget = GM_getValue('et_auto_target', 'img'); // 'img' or 'q' (for dual format)
    let countdownInterval = null;

    // --- Helper Functions ---
    // Safely parse URL to find sequential numbering at the end of the filename
    function parseUrl(url) {
        const match = url.match(/^(.*\/[^0-9\/]*)(\d+)(\.[a-zA-Z0-9]+)?(#.*|\?.*)?$/);
        if (!match) return null;

        const prefix = match[1];
        const numStr = match[2];
        const ext = match[3] || '';
        const suffix = match[4] || '';
        const isDual = numStr.length === 10; // E.g., 0002600002.png (5 digits Q, 5 digits Img)

        return {
            prefix,
            numStr,
            ext,
            suffix,
            isDual,
            qStr: isDual ? numStr.substring(0, 5) : '',
            imgStr: isDual ? numStr.substring(5, 10) : ''
        };
    }

    function incrementNumberString(numStr) {
        const num = parseInt(numStr, 10);
        const nextNum = num + 1;
        return String(nextNum).padStart(numStr.length, '0');
    }

    function decrementNumberString(numStr) {
        const num = parseInt(numStr, 10);
        const prevNum = Math.max(0, num - 1);
        return String(prevNum).padStart(numStr.length, '0');
    }

    function getAdjacentUrl(url, type = 'next', component = 'all') {
        const parsed = parseUrl(url);
        if (!parsed) return null;

        let newNumStr = '';

        if (parsed.isDual) {
            if (component === 'q') {
                const newQ = type === 'next'
                    ? incrementNumberString(parsed.qStr)
                    : decrementNumberString(parsed.qStr);
                newNumStr = newQ + parsed.imgStr;
            } else {
                const newImg = type === 'next'
                    ? incrementNumberString(parsed.imgStr)
                    : decrementNumberString(parsed.imgStr);
                newNumStr = parsed.qStr + newImg;
            }
        } else {
            newNumStr = type === 'next'
                ? incrementNumberString(parsed.numStr)
                : decrementNumberString(parsed.numStr);
        }

        // Construct clean URL
        let cleanSuffix = parsed.suffix;
        if (cleanSuffix.includes('autochain=')) {
            cleanSuffix = cleanSuffix.replace(/[?#]autochain=(true|false)/g, '');
        }
        return parsed.prefix + newNumStr + parsed.ext + cleanSuffix;
    }

    // Copy clean link without sequential hashtags to clipboard
    function copyCleanLink(url) {
        let cleanUrl = url;
        if (cleanUrl.includes('#')) {
            cleanUrl = cleanUrl.split('#')[0];
        }
        if (cleanUrl.includes('?')) {
            cleanUrl = cleanUrl.replace(/[?&]autochain=(true|false)/g, '');
        }

        navigator.clipboard.writeText(cleanUrl).then(() => {
            showToast('Copied clean link to clipboard!', 1500);
        }).catch(err => {
            console.error('Failed to copy: ', err);
            // Fallback for potential sandbox restrictions
            const textarea = document.createElement('textarea');
            textarea.value = cleanUrl;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showToast('Copied clean link to clipboard!', 1500);
            } catch (e) {
                showToast('Failed to copy link.', 1500);
            }
            document.body.removeChild(textarea);
        });
    }

    // Process and open pasted link
    function processAndOpenPastedLink(text) {
        let pastedText = text.trim();
        if (!pastedText) return false;

        // Format relative path to absolute URL
        if (pastedText.startsWith('/assets/')) {
            pastedText = 'https://examtopics.com' + pastedText;
        } else if (pastedText.startsWith('assets/')) {
            pastedText = 'https://examtopics.com/' + pastedText;
        }

        if (pastedText.includes('examtopics.com')) {
            const parsed = parseUrl(pastedText);
            if (parsed) {
                // Open the original link immediately in a new tab
                GM_openInTab(pastedText, { active: true, insert: true });
                showToast(`Opening link in new tab: ${pastedText.split('/').pop()}`, 1500);
                return true;
            }
        }
        return false;
    }

    // --- Toast Notifications for Pasted Link & Actions ---
    function showToast(message, duration = 3000, options = {}) {
        let toast = document.getElementById('et-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'et-toast';
            Object.assign(toast.style, {
                position: 'fixed',
                bottom: '24px',
                left: '50%',
                transform: 'translateX(-50%) translateY(100px)',
                background: 'rgba(15, 23, 42, 0.95)',
                backdropFilter: 'blur(12px) saturate(180%)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                padding: '16px 20px',
                borderRadius: '12px',
                color: '#f8fafc',
                fontFamily: 'system-ui, -apple-system, sans-serif',
                fontSize: '13px',
                zIndex: '999999999',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
                transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                minWidth: '320px'
            });
            document.documentElement.appendChild(toast);
        }

        toast.innerHTML = `
            <div style="font-weight: 600; color: #38bdf8; margin-bottom: 2px;">ExamTopics Helper</div>
            <div style="color: #cbd5e1; font-size: 12px; margin-bottom: 4px;">${message}</div>
            <div id="et-toast-actions" style="display: flex; gap: 8px; justify-content: flex-end;"></div>
        `;

        const actionsContainer = toast.querySelector('#et-toast-actions');
        let isActionTaken = false;

        const closeToast = () => {
            isActionTaken = true;
            toast.style.transform = 'translateX(-50%) translateY(100px)';
        };

        if (options.actions && options.actions.length > 0) {
            options.actions.forEach(action => {
                const btn = document.createElement('button');
                btn.innerText = action.label;
                Object.assign(btn.style, {
                    background: action.primary ? '#0ea5e9' : 'rgba(255, 255, 255, 0.08)',
                    border: action.primary ? '1px solid #0ea5e9' : '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8fafc',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    fontWeight: '600',
                    transition: 'all 0.2s'
                });
                btn.onmouseenter = () => {
                    btn.style.background = action.primary ? '#0284c7' : 'rgba(255, 255, 255, 0.15)';
                };
                btn.onmouseleave = () => {
                    btn.style.background = action.primary ? '#0ea5e9' : 'rgba(255, 255, 255, 0.08)';
                };
                btn.onclick = () => {
                    closeToast();
                    if (action.callback) action.callback();
                };
                actionsContainer.appendChild(btn);
            });
        }

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = 'Cancel';
        Object.assign(cancelBtn.style, {
            background: '#ef4444',
            border: 'none',
            color: 'white',
            padding: '6px 12px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: '600'
        });
        cancelBtn.onclick = () => {
            closeToast();
        };
        actionsContainer.appendChild(cancelBtn);

        setTimeout(() => { toast.style.transform = 'translateX(-50%) translateY(0)'; }, 50);

        if (options.defaultAction) {
            setTimeout(() => {
                if (!isActionTaken) {
                    closeToast();
                    options.defaultAction();
                }
            }, duration);
        } else {
            setTimeout(() => {
                if (!isActionTaken) {
                    closeToast();
                }
            }, duration);
        }
    }

    // --- Global Paste Listener & Keydown Shortcuts ---

    // Paste Event Handler (standard paste Ctrl+V / Cmd+V in text inputs)
    document.addEventListener('paste', (e) => {
        const activeEl = document.activeElement;
        const isInput = activeEl && (
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.isContentEditable
        );

        // Only run paste dialog when focusing inside an input field
        if (isInput) {
            let pastedText = (e.clipboardData || window.clipboardData).getData('text')?.trim();
            if (!pastedText) return;

            if (pastedText.startsWith('/assets/')) {
                pastedText = 'https://examtopics.com' + pastedText;
            } else if (pastedText.startsWith('assets/')) {
                pastedText = 'https://examtopics.com/' + pastedText;
            }

            if (pastedText.includes('examtopics.com')) {
                const parsed = parseUrl(pastedText);
                if (parsed) {
                    const nextUrlImg = getAdjacentUrl(pastedText, 'next', 'img');
                    const nextUrlQ = getAdjacentUrl(pastedText, 'next', 'q');

                    if (parsed.isDual) {
                        showToast(
                            `Pasted: ${parsed.qStr}${parsed.imgStr}. Open next target?`,
                            delayMs + 1000,
                            {
                                actions: [
                                    {
                                        label: `+1 Image`,
                                        primary: true,
                                        callback: () => GM_openInTab(nextUrlImg, { active: true, insert: true })
                                    },
                                    {
                                        label: `+1 Question`,
                                        primary: false,
                                        callback: () => GM_openInTab(nextUrlQ, { active: true, insert: true })
                                    }
                                ]
                            }
                        );
                    } else {
                        showToast(
                            `Pasted: ${parsed.numStr}. Open next image?`,
                            delayMs + 1000,
                            {
                                actions: [
                                    {
                                        label: `Open Next`,
                                        primary: true,
                                        callback: () => GM_openInTab(nextUrlImg, { active: true, insert: true })
                                    }
                                ]
                            }
                        );
                    }
                }
            }
        }
    });

    // Keyboard Listener for macOS custom shortcut (Command + Control + V) and hotkeys
    document.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        const activeEl = document.activeElement;
        const isInput = activeEl && (
            activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.isContentEditable
        );

        // Intercept macOS Cmd + Control + V anywhere on the page
        const isMacShortcut = e.metaKey && e.ctrlKey && key === 'v';
        if (isMacShortcut) {
            navigator.clipboard.readText().then(text => {
                if (processAndOpenPastedLink(text)) {
                    e.preventDefault();
                }
            }).catch(err => {
                console.warn('Clipboard read permission denied/failed: ', err);
            });
            return;
        }

        // Ignore regular navigation keys if user is typing in an input
        if (isInput) return;

        // Handle copy shortcut
        if (key === 'c') {
            copyCleanLink(currentUrl);
            return;
        }

        if (isImageDomain && parsed) {
            if (parsed.isDual) {
                if (key === 'q') navigate('prev', 'q');
                else if (key === 'e') navigate('next', 'q');
                else if (key === 'a') navigate('prev', 'img');
                else if (key === 'd') navigate('next', 'img');
                else if (key === 's') toggleAuto();
            } else {
                if (key === 'a') navigate('prev');
                else if (key === 'd') navigate('next');
                else if (key === 's') toggleAuto();
            }
        }
    });

    // Stop execution for non-image pages here
    if (!isImageDomain) return;

    // =========================================================================
    // --- Image Page Specific Logic (examtopics.com) ---
    // =========================================================================

    const currentUrl = window.location.href;
    const parsed = parseUrl(currentUrl);
    if (!parsed) return; // Exit if the image name doesn't match sequential numbering

    // Inject Styles for Glassmorphic Overlay
    const style = document.createElement('style');
    style.innerHTML = `
        #et-helper-panel {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 280px;
            padding: 16px;
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(12px) saturate(180%);
            -webkit-backdrop-filter: blur(12px) saturate(180%);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            color: #f8fafc;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 13px;
            z-index: 99999999;
            user-select: none;
            transition: opacity 0.3s, transform 0.3s;
        }
        #et-helper-panel:hover {
            border-color: rgba(255, 255, 255, 0.2);
        }
        #et-helper-panel .et-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            padding-bottom: 8px;
        }
        #et-helper-panel .et-title {
            font-weight: 600;
            color: #38bdf8;
            letter-spacing: 0.5px;
        }
        #et-helper-panel #et-btn-close {
            background: none;
            border: none;
            color: #94a3b8;
            font-size: 18px;
            cursor: pointer;
            line-height: 1;
            padding: 0 4px;
            transition: color 0.2s;
        }
        #et-helper-panel #et-btn-close:hover {
            color: #ef4444;
        }
        #et-helper-panel .et-status-section {
            margin-bottom: 12px;
        }
        #et-helper-panel .et-status-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 4px;
        }
        #et-helper-panel .et-label {
            color: #94a3b8;
        }
        #et-helper-panel .et-value {
            font-family: monospace;
            font-weight: 500;
        }
        #et-helper-panel .et-settings-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            color: #94a3b8;
            font-size: 11px;
        }
        #et-helper-panel .et-progress-container {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 6px;
            height: 18px;
            position: relative;
            overflow: hidden;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #et-helper-panel .et-progress-bar {
            position: absolute;
            left: 0;
            top: 0;
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #0ea5e9, #38bdf8);
            transition: width 0.1s linear;
        }
        #et-helper-panel .et-progress-text {
            position: relative;
            z-index: 1;
            font-size: 11px;
            font-weight: 600;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        }
        #et-helper-panel .et-controls {
            display: flex;
            gap: 8px;
        }
        #et-helper-panel .et-btn {
            flex: 1;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #f8fafc;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s;
            outline: none;
            text-align: center;
        }
        #et-helper-panel .et-btn:hover {
            background: rgba(255, 255, 255, 0.15);
            border-color: rgba(255, 255, 255, 0.2);
        }
        #et-helper-panel .et-btn-primary {
            background: #0ea5e9;
            border-color: #0ea5e9;
        }
        #et-helper-panel .et-btn-primary:hover {
            background: #0284c7;
            border-color: #0284c7;
        }
        #et-helper-panel .et-btn-active {
            background: #22c55e !important;
            border-color: #22c55e !important;
        }
        #et-helper-panel .et-btn-active:hover {
            background: #16a34a !important;
            border-color: #16a34a !important;
        }
        #et-helper-panel .et-footer {
            font-size: 10px;
            color: #64748b;
            text-align: center;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
            padding-top: 6px;
            margin-top: 10px;
        }
    `;
    document.head.appendChild(style);

    // Build standard or dual controls
    let controlSectionHtml = '';
    let statusSectionHtml = '';
    let autoTargetSettingHtml = '';

    if (parsed.isDual) {
        const nextImgName = getAdjacentUrl(currentUrl, 'next', 'img').split('/').pop().split(/[?#]/)[0];
        const nextQName = getAdjacentUrl(currentUrl, 'next', 'q').split('/').pop().split(/[?#]/)[0];

        statusSectionHtml = `
            <div class="et-status-row">
                <span class="et-label">Current:</span>
                <span class="et-value">${currentUrl.split('/').pop().split(/[?#]/)[0]}</span>
            </div>
            <div class="et-status-row">
                <span class="et-label">Next Image:</span>
                <span class="et-value">${nextImgName}</span>
            </div>
            <div class="et-status-row">
                <span class="et-label">Next Q:</span>
                <span class="et-value">${nextQName}</span>
            </div>
        `;

        controlSectionHtml = `
            <div style="color: #94a3b8; font-size: 11px; margin-bottom: 4px;">Question Navigation [Q/E]:</div>
            <div class="et-controls" style="margin-bottom: 10px;">
                <button id="et-btn-q-prev" class="et-btn" title="Previous Question [Q]">&larr; Q-1</button>
                <button id="et-btn-q-next" class="et-btn" title="Next Question [E]">Q+1 &rarr;</button>
            </div>
            <div style="color: #94a3b8; font-size: 11px; margin-bottom: 4px;">Image Navigation [A/D]:</div>
            <div class="et-controls" style="margin-bottom: 12px;">
                <button id="et-btn-img-prev" class="et-btn" title="Previous Image [A]">&larr; Img-1</button>
                <button id="et-btn-img-next" class="et-btn" title="Next Image [D]">Img+1 &rarr;</button>
            </div>
        `;

        autoTargetSettingHtml = `
            <div class="et-settings-row">
                <span>Auto Target:</span>
                <button id="et-btn-auto-target" class="et-btn" style="padding: 2px 6px; font-size: 11px; flex: initial;"></button>
            </div>
        `;
    } else {
        const nextName = getAdjacentUrl(currentUrl, 'next').split('/').pop().split(/[?#]/)[0];
        statusSectionHtml = `
            <div class="et-status-row">
                <span class="et-label">Current:</span>
                <span class="et-value">${currentUrl.split('/').pop().split(/[?#]/)[0]}</span>
            </div>
            <div class="et-status-row">
                <span class="et-label">Next Image:</span>
                <span class="et-value">${nextName}</span>
            </div>
        `;

        controlSectionHtml = `
            <div class="et-controls" style="margin-bottom: 12px;">
                <button id="et-btn-prev" class="et-btn" title="Previous Image [A]">&larr; Prev</button>
                <button id="et-btn-next" class="et-btn" title="Next Image [D]">Next &rarr;</button>
            </div>
        `;
    }

    // Create Panel
    const panel = document.createElement('div');
    panel.id = 'et-helper-panel';
    panel.innerHTML = `
        <div class="et-header">
            <span class="et-title">ExamTopics Helper</span>
            <button id="et-btn-close" title="Close Panel">×</button>
        </div>
        <div class="et-status-section">
            ${statusSectionHtml}
        </div>
        <div class="et-settings-row">
            <span>Navigation Target:</span>
            <button id="et-btn-mode" class="et-btn" style="padding: 2px 6px; font-size: 11px; flex: initial;"></button>
        </div>
        ${autoTargetSettingHtml}
        <div class="et-progress-container" id="et-progress-container" style="display: none;">
            <div class="et-progress-bar" id="et-progress-bar"></div>
            <span class="et-progress-text" id="et-progress-text">Opening next in 1.5s</span>
        </div>

        ${controlSectionHtml}

        <div class="et-controls" style="margin-top: 10px;">
            <button id="et-btn-copy" class="et-btn" title="Copy Current Link [C]">📋 Copy Link</button>
            <button id="et-btn-auto" class="et-btn et-btn-primary" style="flex: 1.5;" title="Toggle Auto-Open [S]">Auto: OFF</button>
        </div>
        <div class="et-footer" id="et-footer-tips">
            Keys: [A] Prev | [D] Next | [S] Auto | [C] Copy
        </div>
    `;
    document.documentElement.appendChild(panel);

    // Update settings buttons
    function updateSettingsUi() {
        const modeBtn = document.getElementById('et-btn-mode');
        if (modeBtn) modeBtn.innerText = tabMode === 'new_tab' ? 'New Tab' : 'Same Tab';

        const targetBtn = document.getElementById('et-btn-auto-target');
        if (targetBtn) targetBtn.innerText = autoTarget === 'img' ? 'Image (+1)' : 'Question (+1)';

        const tips = document.getElementById('et-footer-tips');
        if (tips) {
            tips.innerHTML = parsed.isDual
                ? 'Keys: [A]/[D] Img | [Q]/[E] Q | [S] Auto | [C] Copy'
                : 'Keys: [A] Prev | [D] Next | [S] Auto | [C] Copy';
        }
    }
    updateSettingsUi();

    // Auto-advance implementation
    function startAutoAdvance() {
        const nextUrl = parsed.isDual
            ? getAdjacentUrl(currentUrl, 'next', autoTarget)
            : getAdjacentUrl(currentUrl, 'next');

        if (!nextUrl) return;

        const progressContainer = document.getElementById('et-progress-container');
        const progressBar = document.getElementById('et-progress-bar');
        const progressText = document.getElementById('et-progress-text');

        if (progressContainer) progressContainer.style.display = 'flex';

        const intervalStep = 100;
        let elapsed = 0;

        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            elapsed += intervalStep;
            const percentage = Math.min(100, (elapsed / delayMs) * 100);
            if (progressBar) progressBar.style.width = `${percentage}%`;

            const remaining = Math.max(0, (delayMs - elapsed) / 1000).toFixed(1);
            if (progressText) progressText.innerText = `Opening next in ${remaining}s`;

            if (elapsed >= delayMs) {
                clearInterval(countdownInterval);
                countdownInterval = null;

                if (tabMode === 'new_tab') {
                    const targetUrl = nextUrl.includes('#') ? nextUrl : `${nextUrl}#autochain=true`;
                    GM_openInTab(targetUrl, { active: true, insert: true });
                    stopAutoAdvance();
                } else {
                    window.location.href = nextUrl;
                }
            }
        }, intervalStep);
    }

    function stopAutoAdvance() {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        const progressContainer = document.getElementById('et-progress-container');
        if (progressContainer) progressContainer.style.display = 'none';

        const autoBtn = document.getElementById('et-btn-auto');
        if (autoBtn) {
            autoBtn.innerText = 'Auto: OFF';
            autoBtn.classList.remove('et-btn-active');
        }
    }

    function toggleAuto() {
        isAutoEnabled = !isAutoEnabled;
        GM_setValue('et_auto_enabled', isAutoEnabled);

        const autoBtn = document.getElementById('et-btn-auto');
        if (isAutoEnabled) {
            if (autoBtn) {
                autoBtn.innerText = 'Auto: ON';
                autoBtn.classList.add('et-btn-active');
            }
            startAutoAdvance();
        } else {
            stopAutoAdvance();
        }
    }

    function navigate(direction, component = 'all') {
        const url = getAdjacentUrl(currentUrl, direction, component);
        if (url) {
            stopAutoAdvance();
            if (tabMode === 'new_tab') {
                GM_openInTab(url, { active: true, insert: true });
            } else {
                window.location.href = url;
            }
        }
    }

    // --- Interactive Control Listeners ---
    if (parsed.isDual) {
        document.getElementById('et-btn-q-prev').onclick = () => navigate('prev', 'q');
        document.getElementById('et-btn-q-next').onclick = () => navigate('next', 'q');
        document.getElementById('et-btn-img-prev').onclick = () => navigate('prev', 'img');
        document.getElementById('et-btn-img-next').onclick = () => navigate('next', 'img');

        document.getElementById('et-btn-auto-target').onclick = () => {
            autoTarget = autoTarget === 'img' ? 'q' : 'img';
            GM_setValue('et_auto_target', autoTarget);
            updateSettingsUi();
            if (countdownInterval) startAutoAdvance();
        };
    } else {
        document.getElementById('et-btn-prev').onclick = () => navigate('prev');
        document.getElementById('et-btn-next').onclick = () => navigate('next');
    }

    document.getElementById('et-btn-copy').onclick = () => copyCleanLink(currentUrl);
    document.getElementById('et-btn-auto').onclick = () => toggleAuto();
    document.getElementById('et-btn-close').onclick = () => {
        stopAutoAdvance();
        panel.style.opacity = '0';
        panel.style.transform = 'scale(0.9)';
        setTimeout(() => panel.remove(), 300);
    };

    document.getElementById('et-btn-mode').onclick = () => {
        tabMode = tabMode === 'new_tab' ? 'same_tab' : 'new_tab';
        GM_setValue('et_tab_mode', tabMode);
        updateSettingsUi();
    };

    // --- Auto-start Logic ---
    const hash = window.location.hash;
    const isChain = hash.includes('autochain=true');

    if (isAutoEnabled || isChain) {
        if (isChain && !isAutoEnabled) {
            isAutoEnabled = true;
            GM_setValue('et_auto_enabled', true);
        }
        const autoBtn = document.getElementById('et-btn-auto');
        if (autoBtn) {
            autoBtn.innerText = 'Auto: ON';
            autoBtn.classList.add('et-btn-active');
        }
        startAutoAdvance();
    }
})();