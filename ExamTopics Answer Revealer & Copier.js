// ==UserScript==
// @name         ExamTopics Answer Revealer & Copier & Sequencer
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  Tự động hiển thị đáp án ẩn trên ExamTopics, copy câu hỏi + đáp án + ảnh, tự động mở hình ảnh tiếp theo
// @author       You
// @match        *://*.examtopics.com/*
// @match        *://examtopics.com/*
// @match        *://*/*
// @updateURL    https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/ExamTopics%20Answer%20Revealer%20&%20Copier.js
// @downloadURL  https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/ExamTopics%20Answer%20Revealer%20&%20Copier.js
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // =============================================
    // 1. CONFIGURATION & STATE
    // =============================================
    const currentUrl = window.location.href;
    const isImageDomain = window.location.hostname === 'img.examtopics.com';
    const isMainDomain = window.location.hostname === 'www.examtopics.com';

    // Sequencer Configuration
    const delayMs = 1500; // Delay of 1.5s (1-2s range)
    let isAutoEnabled = GM_getValue('et_auto_enabled', false);
    let tabMode = GM_getValue('et_tab_mode', 'new_tab'); // 'new_tab' or 'same_tab'
    let autoTarget = GM_getValue('et_auto_target', 'img'); // 'img' or 'q' (for dual format)
    let countdownInterval = null;

    // =============================================
    // 2. NUCLEAR POPUP BLOCKER (Only runs on main domain)
    // =============================================
    if (isMainDomain) {
        // --- LAYER 1: CSS kill (instant, before any paint) ---
        const cssKill = document.createElement('style');
        cssKill.textContent = `
            .popup-overlay,
            #notRemoverPopup,
            .popup-overlay.show {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
                width: 0 !important;
                height: 0 !important;
                overflow: hidden !important;
                position: fixed !important;
                top: -9999px !important;
                left: -9999px !important;
                z-index: -1 !important;
            }
        `;
        (document.head || document.documentElement).appendChild(cssKill);

        // --- LAYER 2: Hijack setInterval to kill the popup recreation loop ---
        const _origSetInterval = window.setInterval;
        window.setInterval = function (fn, delay, ...args) {
            const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
            if (fnStr.includes('createPopup') || fnStr.includes('notRemoverPopup') || fnStr.includes('popup-overlay')) {
                return _origSetInterval(() => {}, 999999999);
            }
            return _origSetInterval.call(this, fn, delay, ...args);
        };

        const _origSetTimeout = window.setTimeout;
        window.setTimeout = function (fn, delay, ...args) {
            const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
            if (fnStr.includes('createPopup') || fnStr.includes('notRemoverPopup')) {
                return _origSetTimeout(() => {}, 999999999);
            }
            return _origSetTimeout.call(this, fn, delay, ...args);
        };

        // --- LAYER 3: Nullify the createPopup function when it gets defined ---
        Object.defineProperty(window, 'createPopup', {
            get() { return function() {}; },
            set() { /* swallow any assignment */ },
            configurable: false
        });

        // Also kill the cloned backup
        Object.defineProperty(window, 'originalPopupContent', {
            get() { return null; },
            set() { /* swallow */ },
            configurable: false
        });

        // --- LAYER 4: MutationObserver ---
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (
                        node.id === 'notRemoverPopup' ||
                        node.classList?.contains('popup-overlay') ||
                        node.classList?.contains('show')
                    ) {
                        node.remove();
                    }
                }
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    const target = mutation.target;
                    if (target.classList?.contains('popup-overlay') || target.id === 'notRemoverPopup') {
                        target.remove();
                    }
                }
            }
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        // Clean up existing popups once DOM is ready
        const cleanExistingPopups = () => {
            document.querySelectorAll('.popup-overlay, #notRemoverPopup').forEach(el => el.remove());
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', cleanExistingPopups);
        } else {
            cleanExistingPopups();
        }

        // Re-enable right-click and keyboard shortcuts with selective bypass
        document.addEventListener('contextmenu', e => e.stopPropagation(), true);
        document.addEventListener('keydown', e => {
            const key = e.key.toLowerCase();
            const activeEl = document.activeElement;
            const isInput = activeEl && (
                activeEl.tagName === 'INPUT' ||
                activeEl.tagName === 'TEXTAREA' ||
                activeEl.isContentEditable
            );

            const isMacShortcut = e.metaKey && e.ctrlKey && key === 'v';
            const isAltV = e.altKey && key === 'v';

            // Allow copy, paste, select all, DevTools, and custom shortcuts to pass unhindered by page block scripts
            if (
                ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'v' || key === 'a' || key === 'x')) ||
                key === 'f12' ||
                isMacShortcut ||
                isAltV
            ) {
                e.stopPropagation();
            }
        }, true);
    }

    // =============================================
    // 3. SHARED UTILITY & NAVIGATION FUNCTIONS
    // =============================================

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

    // Find previous/next question link on the page
    function getPageNavigationLink(direction) {
        if (direction === 'next') {
            const nextEl = document.querySelector('.next-question, .next-btn, a[class*="next"]');
            if (nextEl) return nextEl;

            const links = document.querySelectorAll('a');
            for (const link of links) {
                if (link.textContent.toLowerCase().includes('next question')) {
                    return link;
                }
            }
        } else {
            const prevEl = document.querySelector('.prev-question, .prev-btn, a[class*="prev"]');
            if (prevEl) return prevEl;

            const links = document.querySelectorAll('a');
            for (const link of links) {
                if (link.textContent.toLowerCase().includes('previous question') || link.textContent.toLowerCase().includes('prev question')) {
                    return link;
                }
            }
        }
        return null;
    }

    // Copy clean link without sequential hashtags/query-parameters to clipboard
    function copyCleanLink(url) {
        let cleanUrl = url;
        if (cleanUrl.includes('#')) {
            cleanUrl = cleanUrl.split('#')[0];
        }
        if (cleanUrl.includes('?')) {
            cleanUrl = cleanUrl.replace(/[?&]autochain=(true|false)/g, '');
        }

        copyToClipboard(cleanUrl);
        showToast('Copied clean link to clipboard!');
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
                showToast(`Opening link in new tab: ${pastedText.split('/').pop()}`);
                return true;
            }
        }
        return false;
    }

    function copyToClipboard(text) {
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text, 'text');
            return true;
        }
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    }

    // Modern styled toast notification with action support
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

    // =============================================
    // 4. REVEAL HIDDEN ANSWERS (Main Domain Only)
    // =============================================
    function revealAnswers() {
        if (!isMainDomain) return [];

        const correctItems = document.querySelectorAll('.multi-choice-item.correct-hidden');
        correctItems.forEach(item => {
            item.classList.remove('correct-hidden');
            item.style.backgroundColor = '#d4edda';
            item.style.borderLeft = '4px solid #28a745';
            item.style.paddingLeft = '10px';
            item.style.fontWeight = 'bold';
        });

        const answerBtn = document.querySelector('a.btn.btn-primary[href*="/view/"]');
        if (answerBtn) {
            answerBtn.style.display = 'none'; // Hide the paywall button
        }

        return correctItems;
    }

    // =============================================
    // 5. EXTRACT QUESTION & ANSWER DATA (Main Domain Only)
    // =============================================
    function extractQuestionData() {
        const data = {
            exam: '',
            questionNum: '',
            topic: '',
            questionText: '',
            choices: [],
            correctAnswers: [],
            communityAnswers: [],
            hasImage: false,
            imageUrls: []
        };

        if (!isMainDomain) return data;

        // Extract exam info
        const header = document.querySelector('.question-discussion-header');
        if (header) {
            const link = header.querySelector('.discussion-link');
            if (link) data.exam = link.textContent.trim();

            const headerText = header.textContent;
            const qMatch = headerText.match(/Question\s*#:\s*(\d+)/);
            const tMatch = headerText.match(/Topic\s*#:\s*(\d+)/);
            if (qMatch) data.questionNum = qMatch[1];
            if (tMatch) data.topic = tMatch[1];
        }

        // Extract question text and image URLs
        const questionBody = document.querySelector('.question-body .card-text') || document.querySelector('.question-body');
        if (questionBody) {
            const cardTextEl = questionBody.classList.contains('card-text') ? questionBody : questionBody.querySelector('.card-text');
            data.questionText = cardTextEl ? cardTextEl.textContent.trim() : questionBody.textContent.trim();

            // Find all images within the entire question-body
            const rootBody = document.querySelector('.question-body') || questionBody;
            const imgs = rootBody.querySelectorAll('img');
            imgs.forEach(img => {
                const src = img.getAttribute('src') || img.getAttribute('data-src');
                if (src) {
                    try {
                        const absoluteUrl = new URL(src, window.location.origin).href;
                        if (!data.imageUrls.includes(absoluteUrl)) {
                            data.imageUrls.push(absoluteUrl);
                            data.hasImage = true;
                        }
                    } catch (e) {
                        if (!data.imageUrls.includes(src)) {
                            data.imageUrls.push(src);
                            data.hasImage = true;
                        }
                    }
                }
            });
        }

        // Extract all choices
        const choiceItems = document.querySelectorAll('.multi-choice-item');
        choiceItems.forEach(item => {
            const letterSpan = item.querySelector('.multi-choice-letter');
            const letter = letterSpan ? letterSpan.getAttribute('data-choice-letter') : '';
            let choiceText = item.textContent.trim();
            // Remove the letter prefix (e.g., "A.")
            choiceText = choiceText.replace(/^[A-Z]\.\s*/, '').trim();

            data.choices.push({ letter, text: choiceText });

            // Check if this is the correct answer
            if (item.classList.contains('correct-hidden') || item.style.backgroundColor === 'rgb(212, 237, 218)') {
                data.correctAnswers.push(letter);
            }
        });

        // Extract community voted answers from comments
        const voteComments = document.querySelectorAll('.comment-container');
        voteComments.forEach(comment => {
            const voteAnswer = comment.querySelector('.voted-answer-holder');
            if (voteAnswer) {
                data.communityAnswers.push(voteAnswer.textContent.trim());
            }
        });

        // Also check the voted-answers-tally (JSON data embedded in the page)
        const tallyScripts = document.querySelectorAll('.voted-answers-tally script');
        tallyScripts.forEach(script => {
            try {
                const tallyData = JSON.parse(script.textContent);
                if (Array.isArray(tallyData) && tallyData.length > 0) {
                    data.communityAnswers = tallyData;
                }
            } catch (e) { /* ignore */ }
        });

        return data;
    }

    // =============================================
    // 6. FORMAT & COPY TO CLIPBOARD (Main Domain Only)
    // =============================================
    function formatQA(data) {
        let text = '';
        text += `📝 Exam: ${data.exam}\n`;
        text += `📋 Topic ${data.topic} - Question ${data.questionNum}\n`;
        text += `${'─'.repeat(50)}\n\n`;
        text += `❓ Question:\n${data.questionText}\n`;

        if (data.imageUrls && data.imageUrls.length > 0) {
            text += `\n🖼️ Question Images:\n`;
            data.imageUrls.forEach((url, idx) => {
                text += `  - Image ${idx + 1}: ${url}\n`;
            });
        } else if (data.hasImage) {
            text += `\n⚠️ [Câu hỏi có hình ảnh - xem trên trang web]\n`;
        }
        text += `\n`;

        text += `📌 Choices:\n`;
        data.choices.forEach(c => {
            const isCorrect = data.correctAnswers.includes(c.letter);
            const marker = isCorrect ? '✅' : '  ';
            text += `  ${marker} ${c.letter}. ${c.text}\n`;
        });

        text += `\n${'─'.repeat(50)}\n`;
        text += `✅ Correct Answer: ${data.correctAnswers.length > 0 ? data.correctAnswers.join(', ') : 'N/A (check community votes)'}\n`;

        if (data.communityAnswers.length > 0) {
            text += `👥 Community Votes: ${JSON.stringify(data.communityAnswers)}\n`;
        }

        return text;
    }

    // =============================================
    // 7. CREATE FLOATING UI PANEL (Main Domain Only)
    // =============================================
    function injectMainStyle() {
        GM_addStyle(`
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

            #et-revealer-panel {
                position: fixed;
                top: 12px;
                right: 12px;
                z-index: 999999;
                font-family: 'Inter', -apple-system, sans-serif;
                width: 340px;
                max-height: calc(100vh - 24px);
                display: flex;
                flex-direction: column;
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(83,120,255,0.15);
                color: #e0e0e0;
                overflow: hidden;
                backdrop-filter: blur(20px);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }

            #et-revealer-panel.minimized {
                width: 56px;
                height: 56px;
                max-height: 56px;
                border-radius: 50%;
                cursor: pointer;
                overflow: hidden;
            }

            #et-revealer-panel.minimized .et-panel-body,
            #et-revealer-panel.minimized .et-panel-header-text {
                display: none;
            }

            .et-panel-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 14px 18px;
                background: linear-gradient(90deg, rgba(83,120,255,0.3), rgba(0,200,150,0.2));
                border-bottom: 1px solid rgba(255,255,255,0.08);
                cursor: move;
                user-select: none;
            }

            .minimized .et-panel-header {
                padding: 0;
                width: 56px;
                height: 56px;
                display: flex;
                align-items: center;
                justify-content: center;
                border: none;
            }

            .et-panel-header-icon {
                font-size: 22px;
                filter: drop-shadow(0 0 6px rgba(83,120,255,0.5));
            }

            .et-panel-header-text h3 {
                margin: 0;
                font-size: 14px;
                font-weight: 700;
                color: #fff;
                letter-spacing: 0.5px;
            }

            .et-panel-header-text span {
                font-size: 11px;
                color: rgba(255,255,255,0.5);
            }

            .et-btn-minimize {
                background: none;
                border: none;
                color: rgba(255,255,255,0.6);
                font-size: 18px;
                cursor: pointer;
                padding: 4px;
                border-radius: 6px;
                transition: all 0.2s;
            }
            .et-btn-minimize:hover {
                background: rgba(255,255,255,0.1);
                color: #fff;
            }

            .et-panel-body {
                padding: 16px 18px;
                overflow-y: auto;
                flex: 1;
            }

            /* Custom sleek scrollbar for premium aesthetic */
            .et-panel-body::-webkit-scrollbar {
                width: 6px;
            }
            .et-panel-body::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.02);
                border-radius: 3px;
            }
            .et-panel-body::-webkit-scrollbar-thumb {
                background: rgba(83, 120, 255, 0.3);
                border-radius: 3px;
            }
            .et-panel-body::-webkit-scrollbar-thumb:hover {
                background: rgba(83, 120, 255, 0.5);
            }

            .et-answer-badge {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 10px 18px;
                background: linear-gradient(135deg, #28a745, #20c997);
                border-radius: 10px;
                font-size: 20px;
                font-weight: 700;
                color: #fff;
                letter-spacing: 1px;
                box-shadow: 0 4px 15px rgba(40,167,69,0.4);
                margin-bottom: 14px;
                animation: et-pulse 2s ease-in-out infinite;
            }

            @keyframes et-pulse {
                0%, 100% { box-shadow: 0 4px 15px rgba(40,167,69,0.4); }
                50% { box-shadow: 0 4px 25px rgba(40,167,69,0.7); }
            }

            .et-answer-badge .et-badge-icon { font-size: 24px; }

            .et-info-row {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 0;
                font-size: 13px;
                color: rgba(255,255,255,0.7);
            }

            .et-info-row .et-info-label {
                color: rgba(255,255,255,0.4);
                min-width: 70px;
            }

            .et-divider {
                height: 1px;
                background: rgba(255,255,255,0.08);
                margin: 12px 0;
            }

            .et-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                width: 100%;
                padding: 10px 16px;
                border: none;
                border-radius: 10px;
                font-family: inherit;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                margin-bottom: 8px;
            }

            .et-btn-copy {
                background: linear-gradient(135deg, #5378ff, #3b5bdb);
                color: #fff;
            }
            .et-btn-copy:hover {
                background: linear-gradient(135deg, #6b8aff, #4c6ef5);
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(83,120,255,0.4);
            }

            .et-btn-copy.copied {
                background: linear-gradient(135deg, #28a745, #20c997);
            }

            .et-btn-nav {
                background: rgba(255,255,255,0.06);
                color: rgba(255,255,255,0.8);
                border: 1px solid rgba(255,255,255,0.1);
            }
            .et-btn-nav:hover {
                background: rgba(255,255,255,0.12);
                color: #fff;
            }

            .et-question-preview {
                font-size: 12px;
                color: rgba(255,255,255,0.5);
                line-height: 1.5;
                max-height: 60px;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
            }
        `);
    }

    function createMainPanel(data) {
        if (!isMainDomain) return;
        injectMainStyle();

        const panel = document.createElement('div');
        panel.id = 'et-revealer-panel';

        const answerDisplay = data.correctAnswers.length > 0
            ? data.correctAnswers.join(', ')
            : (data.communityAnswers.length > 0
                ? `Community: ${JSON.stringify(data.communityAnswers)}`
                : 'Chưa xác định');

        const questionPreview = data.questionText.length > 120
            ? data.questionText.substring(0, 120) + '...'
            : data.questionText;

        let imageListHtml = '';
        if (data.imageUrls && data.imageUrls.length > 0) {
            imageListHtml = `
                <div class="et-divider"></div>
                <div class="et-info-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                    <span class="et-info-label" style="font-size: 11px;">Question Images:</span>
                    <div style="width: 100%; max-height: 85px; overflow-y: auto; background: rgba(0,0,0,0.25); border-radius: 8px; padding: 6px; box-sizing: border-box;">
                        ${data.imageUrls.map((url, idx) => `
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 11px; gap: 8px;">
                                <span style="color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;" title="${url}">🖼️ Image ${idx + 1}</span>
                                <div style="display: flex; gap: 4px;">
                                    <button class="et-open-img-btn" data-url="${url}" style="background: rgba(83,120,255,0.25); border: 1px solid rgba(83,120,255,0.4); color: #38bdf8; border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(83,120,255,0.4)'" onmouseout="this.style.background='rgba(83,120,255,0.25)'">Open</button>
                                    <button class="et-copy-img-btn" data-url="${url}" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.8); border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">Copy</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        panel.innerHTML = `
            <div class="et-panel-header">
                <span class="et-panel-header-icon">🔓</span>
                <div class="et-panel-header-text">
                    <h3>ExamTopics Ultimate Helper</h3>
                    <span>v3.1 — Answer & Image Unlocked</span>
                </div>
                <button class="et-btn-minimize" title="Thu nhỏ">−</button>
            </div>
            <div class="et-panel-body">
                <div class="et-answer-badge">
                    <span class="et-badge-icon">✅</span>
                    <span>Đáp án: ${answerDisplay}</span>
                </div>

                <div class="et-info-row">
                    <span class="et-info-label">Exam:</span>
                    <span>${data.exam}</span>
                </div>
                <div class="et-info-row">
                    <span class="et-info-label">Question:</span>
                    <span>Topic ${data.topic} — #${data.questionNum}</span>
                </div>

                <div class="et-divider"></div>

                <div class="et-question-preview">${questionPreview}</div>

                ${imageListHtml}

                <button class="et-btn et-btn-copy" id="et-copy-btn" style="margin-top: 8px;">
                    📋 Copy Câu hỏi + Đáp án + Ảnh [C]
                </button>
                <button class="et-btn et-btn-nav" id="et-copy-answer-only">
                    📝 Copy Đáp án Only [V]
                </button>
            </div>
        `;

        document.body.appendChild(panel);

        // Minimize / restore
        const minimizeBtn = panel.querySelector('.et-btn-minimize');
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('minimized');
            minimizeBtn.textContent = panel.classList.contains('minimized') ? '+' : '−';
        });

        panel.addEventListener('click', () => {
            if (panel.classList.contains('minimized')) {
                panel.classList.remove('minimized');
                minimizeBtn.textContent = '−';
            }
        });

        // Copy full Q&A
        const copyBtn = document.getElementById('et-copy-btn');
        copyBtn.addEventListener('click', () => {
            const text = formatQA(data);
            copyToClipboard(text);
            copyBtn.classList.add('copied');
            copyBtn.innerHTML = '✅ Đã copy!';
            showToast('📋 Đã copy câu hỏi, đáp án và ảnh vào clipboard!');
            setTimeout(() => {
                copyBtn.classList.remove('copied');
                copyBtn.innerHTML = '📋 Copy Câu hỏi + Đáp án + Ảnh [C]';
            }, 2000);
        });

        // Copy answer only
        const copyAnswerBtn = document.getElementById('et-copy-answer-only');
        copyAnswerBtn.addEventListener('click', () => {
            const answerText = `${data.exam} - Q${data.questionNum}: ${answerDisplay}`;
            copyToClipboard(answerText);
            showToast(`📝 Đáp án: ${answerDisplay}`);
        });

        // Open image links in new tab
        const openImgBtns = panel.querySelectorAll('.et-open-img-btn');
        openImgBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const url = btn.getAttribute('data-url');
                GM_openInTab(url, { active: true, insert: true });
            });
        });

        // Copy image links
        const copyImgBtns = panel.querySelectorAll('.et-copy-img-btn');
        copyImgBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const url = btn.getAttribute('data-url');
                if (copyToClipboard(url)) {
                    btn.textContent = 'Copied!';
                    btn.style.background = '#28a745';
                    btn.style.borderColor = '#28a745';
                    showToast('🖼️ Copied image URL to clipboard!');
                    setTimeout(() => {
                        btn.textContent = 'Copy';
                        btn.style.background = 'rgba(255,255,255,0.1)';
                        btn.style.borderColor = 'rgba(255,255,255,0.15)';
                    }, 1500);
                }
            });
        });

        // Dragging
        let isDragging = false, offsetX, offsetY;
        const header = panel.querySelector('.et-panel-header');

        header.addEventListener('mousedown', (e) => {
            if (panel.classList.contains('minimized')) return;
            isDragging = true;
            offsetX = e.clientX - panel.getBoundingClientRect().left;
            offsetY = e.clientY - panel.getBoundingClientRect().top;
            panel.style.transition = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            panel.style.left = (e.clientX - offsetX) + 'px';
            panel.style.top = (e.clientY - offsetY) + 'px';
            panel.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            panel.style.transition = '';
        });
    }

    // =============================================
    // 8. CREATE IMAGE HELPER PANEL (Image Domain Only)
    // =============================================
    function injectImageStyle() {
        const style = document.createElement('style');
        style.innerHTML = `
            #et-helper-panel {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 280px;
                max-height: calc(100vh - 40px);
                overflow-y: auto;
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

            /* Sleek scrollbar for helper panel */
            #et-helper-panel::-webkit-scrollbar {
                width: 6px;
            }
            #et-helper-panel::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.02);
                border-radius: 3px;
            }
            #et-helper-panel::-webkit-scrollbar-thumb {
                background: rgba(56, 189, 248, 0.3);
                border-radius: 3px;
            }
            #et-helper-panel::-webkit-scrollbar-thumb:hover {
                background: rgba(56, 189, 248, 0.5);
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
    }

    function createImagePanel() {
        if (!isImageDomain) return;

        const parsed = parseUrl(currentUrl);
        if (!parsed) return;

        injectImageStyle();

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

        // Event listeners for UI controls
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

        const copyBtnEl = document.getElementById('et-btn-copy');
        if (copyBtnEl) {
            copyBtnEl.onclick = () => {
                copyCleanLink(currentUrl);
                const originalText = copyBtnEl.innerHTML;
                copyBtnEl.innerHTML = '✅ Copied!';
                copyBtnEl.style.background = '#22c55e';
                copyBtnEl.style.borderColor = '#22c55e';
                setTimeout(() => {
                    copyBtnEl.innerHTML = originalText;
                    copyBtnEl.style.background = '';
                    copyBtnEl.style.borderColor = '';
                }, 1500);
            };
        }
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

        // Auto-start Logic
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
    }

    // =============================================
    // 9. GLOBAL EVENT LISTENERS (Paste & Keydown)
    // =============================================
    function setupEventListeners() {
        // Global Paste Interceptor (runs inside text inputs)
        document.addEventListener('paste', (e) => {
            const activeEl = document.activeElement;
            const isInput = activeEl && (
                activeEl.tagName === 'INPUT' ||
                activeEl.tagName === 'TEXTAREA' ||
                activeEl.isContentEditable
            );

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

        // Keydown Shortcuts
        document.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            const activeEl = document.activeElement;
            const isInput = activeEl && (
                activeEl.tagName === 'INPUT' ||
                activeEl.tagName === 'TEXTAREA' ||
                activeEl.isContentEditable
            );

            // Intercept macOS Cmd + Control + V OR Alt + V anywhere on the page
            const isMacShortcut = e.metaKey && e.ctrlKey && key === 'v';
            const isAltV = e.altKey && key === 'v';
            if (isMacShortcut || isAltV) {
                navigator.clipboard.readText().then(text => {
                    if (processAndOpenPastedLink(text)) {
                        e.preventDefault();
                    }
                }).catch(err => {
                    console.warn('Clipboard read permission denied/failed: ', err);
                });
                return;
            }

            if (isInput) return;

            // Ignore shortcuts if Ctrl, Cmd, Alt or Shift is pressed (except when captured above)
            if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

            // Shortcuts for Main Domain (www.examtopics.com)
            if (isMainDomain) {
                if (key === 'a' || key === 'arrowleft') {
                    const prevLink = getPageNavigationLink('prev');
                    if (prevLink) {
                        prevLink.click();
                        showToast('Navigating to previous question...');
                    }
                } else if (key === 'd' || key === 'arrowright') {
                    const nextLink = getPageNavigationLink('next');
                    if (nextLink) {
                        nextLink.click();
                        showToast('Navigating to next question...');
                    }
                } else if (key === 'c') {
                    const copyBtn = document.getElementById('et-copy-btn');
                    if (copyBtn) copyBtn.click();
                } else if (key === 'v') {
                    const copyAnsBtn = document.getElementById('et-copy-answer-only');
                    if (copyAnsBtn) copyAnsBtn.click();
                } else if (key === 'o') {
                    const openBtns = document.querySelectorAll('.et-open-img-btn');
                    if (openBtns.length > 0) {
                        openBtns.forEach(btn => btn.click());
                        showToast(`Opened ${openBtns.length} images in new tabs!`);
                    } else {
                        showToast('No images found in this question.');
                    }
                }
            }

            // Shortcuts for Image Domain (img.examtopics.com)
            if (isImageDomain) {
                const parsed = parseUrl(currentUrl);
                if (parsed) {
                    if (parsed.isDual) {
                        if (key === 'q') navigateImage('prev', 'q');
                        else if (key === 'e') navigateImage('next', 'q');
                        else if (key === 'a') navigateImage('prev', 'img');
                        else if (key === 'd') navigateImage('next', 'img');
                        else if (key === 's') triggerAutoToggle();
                        else if (key === 'c') triggerCopyLink();
                    } else {
                        if (key === 'a') navigateImage('prev');
                        else if (key === 'd') navigateImage('next');
                        else if (key === 's') triggerAutoToggle();
                        else if (key === 'c') triggerCopyLink();
                    }
                }
            }
        });
    }

    // Helper wrappers to trigger panel click handlers
    function navigateImage(direction, component) {
        const btnId = component === 'q'
            ? (direction === 'next' ? 'et-btn-q-next' : 'et-btn-q-prev')
            : (component === 'img'
                ? (direction === 'next' ? 'et-btn-img-next' : 'et-btn-img-prev')
                : (direction === 'next' ? 'et-btn-next' : 'et-btn-prev'));
        const btn = document.getElementById(btnId);
        if (btn) btn.click();
    }

    function triggerAutoToggle() {
        const autoBtn = document.getElementById('et-btn-auto');
        if (autoBtn) autoBtn.click();
    }

    function triggerCopyLink() {
        const btn = document.getElementById('et-btn-copy');
        if (btn) btn.click();
    }

    // =============================================
    // 10. MAIN INITIALIZATION
    // =============================================
    function main() {
        if (isMainDomain) {
            if (window.location.pathname.includes('/discussions/') || window.location.pathname.includes('/exams/')) {
                // Reveal hidden answers
                revealAnswers();

                // Extract data
                const data = extractQuestionData();

                // Create floating panel
                createMainPanel(data);

                // Show initial toast
                if (data.correctAnswers.length > 0) {
                    showToast(`🔓 Đáp án câu ${data.questionNum}: ${data.correctAnswers.join(', ')}`);
                } else {
                    showToast(`⚠️ Câu ${data.questionNum}: Đáp án ẩn sau paywall`);
                }

                console.log('[ET Revealer] Question Data:', data);
            }
        } else if (isImageDomain) {
            createImagePanel();
        }

        // Setup global event listeners
        setupEventListeners();
    }

    // Defer execution of UI setup until DOM is loaded
    function waitAndRun() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(main, 800);
            });
        } else {
            setTimeout(main, 800);
        }
    }

    waitAndRun();
})();
