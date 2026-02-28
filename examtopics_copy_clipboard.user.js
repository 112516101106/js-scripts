// ==UserScript==
// @name         ExamTopics Auto Copy to Clipboard
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Automatically copies ExamTopics question data to clipboard when the page loads
// @author       You
// @match        https://www.examtopics.com/discussions/*/view/*
// @updateURL    https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/examtopics_copy_clipboard.user.js
// @downloadURL  https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/examtopics_copy_clipboard.user.js
// @grant        GM_setClipboard
// @grant        window.close
// ==/UserScript==

(function () {
    'use strict';

    function extractData() {
        // 1. Extract the question text
        const questionBody = document.querySelector('.question-body');
        if (!questionBody) {
            console.log('[ExamTopics Copy] Question body not found, retrying...');
            return null;
        }

        const questionTextEl = questionBody.querySelector('.card-text');
        if (!questionTextEl) {
            console.log('[ExamTopics Copy] Question text not found');
            return null;
        }

        // Get question text, handle images in question
        let questionText = '';
        const questionNodes = questionTextEl.childNodes;
        for (const node of questionNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                const t = node.textContent.trim();
                if (t) questionText += t + ' ';
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'IMG') {
                    questionText += `![](${node.src}) `;
                } else {
                    const imgs = node.querySelectorAll('img');
                    if (imgs.length > 0) {
                        // Mix text + images
                        const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
                        let cur;
                        while ((cur = walk.nextNode())) {
                            if (cur.nodeType === Node.TEXT_NODE) {
                                const t = cur.textContent.trim();
                                if (t) questionText += t + ' ';
                            } else if (cur.tagName === 'IMG') {
                                questionText += `![](${cur.src}) `;
                            }
                        }
                    } else {
                        const t = node.textContent.trim();
                        if (t) questionText += t + ' ';
                    }
                }
            }
        }
        questionText = questionText.trim();

        // 2. Extract answer choices
        const choiceItems = questionBody.querySelectorAll('.multi-choice-item');
        if (choiceItems.length === 0) {
            console.log('[ExamTopics Copy] No choices found');
            return null;
        }

        const choices = [];
        choiceItems.forEach(item => {
            const letterSpan = item.querySelector('.multi-choice-letter');
            const letter = letterSpan ? letterSpan.getAttribute('data-choice-letter') : '';

            // Get the content after the letter span, but SKIP badges and other non-content elements
            let choiceContent = '';
            const childNodes = item.childNodes;
            for (const node of childNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Skip the letter span
                    if (node.classList && node.classList.contains('multi-choice-letter')) continue;
                    // Skip badges (e.g. "Most Voted", "Correct", etc.)
                    if (node.classList && node.classList.contains('badge')) continue;
                    // Skip any voting/tally related elements
                    if (node.classList && (
                        node.classList.contains('voted-answers-tally') ||
                        node.classList.contains('most-voted') ||
                        node.classList.contains('correct-icon') ||
                        node.classList.contains('answer-vote-count')
                    )) continue;

                    if (node.tagName === 'IMG') {
                        choiceContent += `![](${node.src})`;
                    } else {
                        const imgs = node.querySelectorAll('img');
                        if (imgs.length > 0) {
                            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
                            let current;
                            while ((current = walker.nextNode())) {
                                if (current.nodeType === Node.TEXT_NODE) {
                                    choiceContent += current.textContent;
                                } else if (current.tagName === 'IMG') {
                                    choiceContent += `![](${current.src})`;
                                }
                            }
                        } else {
                            choiceContent += node.textContent;
                        }
                    }
                } else if (node.nodeType === Node.TEXT_NODE) {
                    choiceContent += node.textContent;
                }
            }
            // Clean up: collapse whitespace, trim
            choiceContent = choiceContent.replace(/\s+/g, ' ').trim();

            if (letter && choiceContent) {
                choices.push(`- ${letter}. ${choiceContent}`);
            }
        });

        // 3. Extract the suggested answer
        const correctAnswerEl = questionBody.querySelector('.correct-answer');
        let suggestedAnswer = correctAnswerEl ? correctAnswerEl.textContent.trim() : '';

        // 4. Try to get the most voted answer from the voting tally JSON
        let mostVotedAnswer = '';
        const votedTallyDiv = questionBody.querySelector('.voted-answers-tally');
        if (votedTallyDiv) {
            const scriptEl = votedTallyDiv.querySelector('script[type="application/json"]');
            if (scriptEl) {
                try {
                    const votingData = JSON.parse(scriptEl.textContent);
                    const mostVoted = votingData.find(v => v.is_most_voted);
                    if (mostVoted) {
                        mostVotedAnswer = mostVoted.voted_answers;
                    }
                } catch (e) {
                    console.log('[ExamTopics Copy] Error parsing voting data:', e);
                }
            }
        }

        const finalAnswer = mostVotedAnswer || suggestedAnswer;

        // 5. Build the reference URL
        const referenceUrl = window.location.href.split('#')[0].split('?')[0];

        // 6. Format the output
        const output = `${finalAnswer}----${questionText}\n${choices.join('\n')}\n[Reference: ${referenceUrl}]\n\n\n`;

        return output;
    }

    function copyToClipboard(text) {
        // Primary: use GM_setClipboard (Tampermonkey API, works without user gesture)
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text, 'text');
            showNotification('✅ Question copied to clipboard!', 'success');
            console.log('[ExamTopics Copy] Copied via GM_setClipboard:\n', text);
            setTimeout(() => { window.close(); }, 500);
            return;
        }

        // Fallback 1: navigator.clipboard (requires secure context + may need user gesture)
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showNotification('✅ Question copied to clipboard!', 'success');
                console.log('[ExamTopics Copy] Copied via navigator.clipboard:\n', text);
                setTimeout(() => { window.close(); }, 500);
            }).catch(() => {
                // Fallback 2: show copy button for manual click
                showCopyButton(text);
            });
        } else {
            showCopyButton(text);
        }
    }

    function showCopyButton(text) {
        // Create a visible button so user can click to trigger copy (user gesture required)
        const btn = document.createElement('button');
        btn.textContent = '📋 Click to Copy Question';
        btn.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 999999;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            color: white;
            background-color: #007bff;
            border: none;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        btn.addEventListener('click', () => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.cssText = 'position:fixed;opacity:0;';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            btn.remove();
            showNotification('✅ Question copied to clipboard!', 'success');
            console.log('[ExamTopics Copy] Copied via button click:\n', text);
        });
        document.body.appendChild(btn);
        showNotification('⚠️ Click the blue button to copy', 'error');
    }

    function showNotification(message, type) {
        const notification = document.createElement('div');
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 999999;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            color: white;
            background-color: ${type === 'success' ? '#28a745' : '#dc3545'};
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: opacity 0.5s ease;
            opacity: 1;
        `;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 500);
        }, 3000);
    }

    // Wait for the page to fully load, then extract
    function waitAndExtract() {
        let attempts = 0;
        const maxAttempts = 20;
        const interval = setInterval(() => {
            attempts++;
            const output = extractData();
            if (output) {
                clearInterval(interval);
                copyToClipboard(output);
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                console.log('[ExamTopics Copy] Max attempts reached, could not find question data');
                showNotification('⚠️ Could not find question data on this page', 'error');
            }
        }, 500);
    }

    // Start after DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', waitAndExtract);
    } else {
        waitAndExtract();
    }
})();
