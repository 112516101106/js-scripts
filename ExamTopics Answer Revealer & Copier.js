// ==UserScript==
// @name         ExamTopics Answer Revealer & Copier
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Tự động hiển thị đáp án ẩn trên ExamTopics, copy câu hỏi + đáp án, thông báo đáp án
// @author       You
// @match        https://www.examtopics.com/discussions/*/view/*
// @match        https://www.examtopics.com/exams/*/view/*
// @updateURL    https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/ExamTopics%20Answer%20Revealer%20&%20Copier.js
// @downloadURL  https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/ExamTopics%20Answer%20Revealer%20&%20Copier.js
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // =============================================
    // 1. NUCLEAR POPUP BLOCKER (4-layer defense)
    // =============================================

    // --- LAYER 1: CSS kill (instant, before any paint) ---
    // Inject a <style> into <head>/<html> as early as possible.
    // This hides the popup via CSS so it NEVER visually appears,
    // even if JS recreates the DOM node every 200ms.
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
    // ExamTopics does: setTimeout(() => { setInterval(createPopup, 200) }, 2000)
    // We intercept setInterval and block any callback that mentions "createPopup"
    // or targets popup-related elements.
    const _origSetInterval = window.setInterval;
    window.setInterval = function (fn, delay, ...args) {
        const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
        if (fnStr.includes('createPopup') || fnStr.includes('notRemoverPopup') || fnStr.includes('popup-overlay')) {
            // Silently block this interval — return a dummy ID
            return _origSetInterval(() => {}, 999999999);
        }
        return _origSetInterval.call(this, fn, delay, ...args);
    };

    // Also hijack setTimeout for the outer wrapper
    const _origSetTimeout = window.setTimeout;
    window.setTimeout = function (fn, delay, ...args) {
        const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
        if (fnStr.includes('createPopup') || fnStr.includes('notRemoverPopup')) {
            return _origSetTimeout(() => {}, 999999999);
        }
        return _origSetTimeout.call(this, fn, delay, ...args);
    };

    // --- LAYER 3: Nullify the createPopup function when it gets defined ---
    // Override it on window so even if it slips through, it does nothing.
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

    // --- LAYER 4: MutationObserver — last line of defense ---
    // If anything somehow still adds a popup-overlay to the DOM,
    // remove it instantly (before the browser's next paint frame).
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue; // only element nodes
                if (
                    node.id === 'notRemoverPopup' ||
                    node.classList?.contains('popup-overlay') ||
                    node.classList?.contains('show')
                ) {
                    node.remove();
                }
            }
            // Also catch class additions (the "show" class being added)
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const target = mutation.target;
                if (target.classList?.contains('popup-overlay') || target.id === 'notRemoverPopup') {
                    target.remove();
                }
            }
        }
    });
    // Start observing as soon as possible
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });

    // --- Clean up existing popups once DOM is ready ---
    function cleanExistingPopups() {
        document.querySelectorAll('.popup-overlay, #notRemoverPopup').forEach(el => el.remove());
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', cleanExistingPopups);
    } else {
        cleanExistingPopups();
    }

    // --- Re-enable right-click and keyboard shortcuts ---
    document.addEventListener('contextmenu', e => e.stopPropagation(), true);
    document.addEventListener('keydown', e => e.stopPropagation(), true);

    // =============================================
    // 2. REVEAL HIDDEN ANSWERS
    // =============================================

    function revealAnswers() {
        // Method 1: Find items with class "correct-hidden" (the suggested answer)
        const correctItems = document.querySelectorAll('.multi-choice-item.correct-hidden');
        correctItems.forEach(item => {
            item.classList.remove('correct-hidden');
            item.style.backgroundColor = '#d4edda';
            item.style.borderLeft = '4px solid #28a745';
            item.style.paddingLeft = '10px';
            item.style.fontWeight = 'bold';
        });

        // Method 2: Find answer from "Show Suggested Answer" button area
        // Some pages hide the answer behind a paywall button
        const answerBtn = document.querySelector('a.btn.btn-primary[href*="/view/"]');
        if (answerBtn) {
            answerBtn.style.display = 'none'; // Hide the paywall button
        }

        return correctItems;
    }

    // =============================================
    // 3. EXTRACT QUESTION & ANSWER DATA
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
            hasImage: false
        };

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

        // Extract question text
        const questionBody = document.querySelector('.question-body .card-text');
        if (questionBody) {
            data.questionText = questionBody.textContent.trim();
            if (questionBody.querySelector('img')) {
                data.hasImage = true;
            }
        }

        // Extract all choices
        const choiceItems = document.querySelectorAll('.multi-choice-item');
        choiceItems.forEach(item => {
            const letterSpan = item.querySelector('.multi-choice-letter');
            const letter = letterSpan ? letterSpan.getAttribute('data-choice-letter') : '';
            // Get text content excluding the letter span
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
            } catch (e) { /* ignore parse errors */ }
        });

        return data;
    }

    // =============================================
    // 4. FORMAT & COPY TO CLIPBOARD
    // =============================================

    function formatQA(data) {
        let text = '';
        text += `📝 Exam: ${data.exam}\n`;
        text += `📋 Topic ${data.topic} - Question ${data.questionNum}\n`;
        text += `${'─'.repeat(50)}\n\n`;
        text += `❓ Question:\n${data.questionText}\n`;
        if (data.hasImage) {
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

    // =============================================
    // 5. CREATE FLOATING UI PANEL
    // =============================================

    GM_addStyle(`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

        #et-revealer-panel {
            position: fixed;
            top: 12px;
            right: 12px;
            z-index: 999999;
            font-family: 'Inter', -apple-system, sans-serif;
            width: 340px;
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

        .et-toast {
            position: fixed;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            background: linear-gradient(135deg, #28a745, #20c997);
            color: #fff;
            padding: 12px 28px;
            border-radius: 30px;
            font-family: 'Inter', sans-serif;
            font-size: 14px;
            font-weight: 600;
            box-shadow: 0 8px 30px rgba(40,167,69,0.4);
            z-index: 9999999;
            transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            pointer-events: none;
        }
        .et-toast.show {
            transform: translateX(-50%) translateY(0);
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
            margin-bottom: 10px;
            padding: 8px;
            background: rgba(0,0,0,0.2);
            border-radius: 8px;
        }
    `);

    function showToast(msg) {
        let toast = document.getElementById('et-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'et-toast';
            toast.className = 'et-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2500);
    }

    function createPanel(data) {
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

        panel.innerHTML = `
            <div class="et-panel-header">
                <span class="et-panel-header-icon">🔓</span>
                <div class="et-panel-header-text">
                    <h3>ExamTopics Revealer</h3>
                    <span>v2.0 — Answer Unlocked</span>
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

                <button class="et-btn et-btn-copy" id="et-copy-btn">
                    📋 Copy Câu hỏi + Đáp án
                </button>
                <button class="et-btn et-btn-nav" id="et-copy-answer-only">
                    📝 Copy Đáp án Only
                </button>
            </div>
        `;

        document.body.appendChild(panel);

        // === Event handlers ===

        // Minimize / restore
        const minimizeBtn = panel.querySelector('.et-btn-minimize');
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('minimized');
            minimizeBtn.textContent = panel.classList.contains('minimized') ? '+' : '−';
        });

        // Click on minimized panel to restore
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
            showToast('📋 Đã copy câu hỏi + đáp án vào clipboard!');
            setTimeout(() => {
                copyBtn.classList.remove('copied');
                copyBtn.innerHTML = '📋 Copy Câu hỏi + Đáp án';
            }, 2000);
        });

        // Copy answer only
        const copyAnswerBtn = document.getElementById('et-copy-answer-only');
        copyAnswerBtn.addEventListener('click', () => {
            const answerText = `${data.exam} - Q${data.questionNum}: ${answerDisplay}`;
            copyToClipboard(answerText);
            showToast(`📝 Đáp án: ${answerDisplay}`);
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
    // 6. MAIN - Run everything
    // =============================================

    function main() {
        // Reveal hidden answers
        revealAnswers();

        // Extract data
        const data = extractQuestionData();

        // Create floating panel
        createPanel(data);

        // Show initial toast
        if (data.correctAnswers.length > 0) {
            showToast(`🔓 Đáp án câu ${data.questionNum}: ${data.correctAnswers.join(', ')}`);
        } else {
            showToast(`⚠️ Câu ${data.questionNum}: Đáp án ẩn sau paywall`);
        }

        // Log to console for debugging
        console.log('[ET Revealer] Question Data:', data);
        console.log('[ET Revealer] Formatted:', formatQA(data));
    }

    // Since @run-at is document-start, wait for DOM to be fully loaded
    function waitAndRun() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                _origSetTimeout(main, 800);
            });
        } else {
            _origSetTimeout(main, 800);
        }
    }

    waitAndRun();

})();
