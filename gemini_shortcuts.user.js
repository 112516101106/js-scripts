// ==UserScript==
// @name         Gemini Copy Response Shortcut & Autofocus
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Press Alt+C to copy the last response, Alt+I to focus input, Alt+Enter/Ctrl+Enter/Alt+S to submit, and autofocus input on load/navigation.
// @author       You
// @match        https://gemini.google.com/*
// @updateURL    https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/gemini_shortcuts.user.js
// @downloadURL  https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/gemini_shortcuts.user.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=gemini.google.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Inject flash effect styles for copy visual feedback
    const style = document.createElement('style');
    style.textContent = `
        @keyframes gemini-copy-flash {
            0% { background-color: rgba(66, 133, 244, 0.25); }
            100% { background-color: transparent; }
        }
        .gemini-response-flash {
            animation: gemini-copy-flash 0.8s ease-out;
            border-radius: 8px;
        }
    `;
    document.head.appendChild(style);

    function log(msg) {
        console.log(`[Gemini Shortcuts] ${msg}`);
    }

    // Find all response copy buttons, excluding code block copy buttons
    function getResponseCopyButtons() {
        const buttons = Array.from(document.querySelectorAll('copy-button button, [data-test-id="copy-button"] button'));
        return buttons.filter(btn => !btn.closest('.code-block') && !btn.closest('pre'));
    }

    // Copy the last response
    function copyLastResponse() {
        const copyButtons = getResponseCopyButtons();
        if (copyButtons.length > 0) {
            const lastBtn = copyButtons[copyButtons.length - 1];
            lastBtn.click();

            // Visual feedback - flash the copied response container
            const responseContainer = lastBtn.closest('model-response') || 
                                      lastBtn.closest('.response-container') || 
                                      lastBtn.closest('.message-content') ||
                                      lastBtn.closest('.structured-content-container');
            if (responseContainer) {
                responseContainer.classList.add('gemini-response-flash');
                setTimeout(() => {
                    responseContainer.classList.remove('gemini-response-flash');
                }, 800);
            }
            log('Copied last response!');
        } else {
            log('No copy button found for the last response.');
        }
    }

    // Focus the Gemini input box
    function focusInput() {
        const input = document.querySelector('div.ql-editor[contenteditable="true"]');
        if (input) {
            input.focus();
            return true;
        }
        return false;
    }

    // Find the Gemini send/submit button
    function findSendButton() {
        const selectors = [
            'button[data-test-id="send-button"]',
            'button[aria-label="Send message"]',
            'button[aria-label="Send prompt"]',
            'button[aria-label="Send"]',
            'button[aria-label*="Send" i]',
            'button[aria-label*="Gửi" i]',
            'button[aria-label*="gửi" i]'
        ];
        for (const selector of selectors) {
            const btn = document.querySelector(selector);
            if (btn) return btn;
        }

        // Search in mat-icons for "send"
        const sendIcon = Array.from(document.querySelectorAll('mat-icon')).find(icon => {
            const text = icon.textContent ? icon.textContent.trim().toLowerCase() : '';
            const fonticon = icon.getAttribute('fonticon') || '';
            return text === 'send' || fonticon.includes('send');
        });
        if (sendIcon) {
            const btn = sendIcon.closest('button');
            if (btn) return btn;
        }

        // Fallback: search in input-area-v2 buttons
        const inputArea = document.querySelector('input-area-v2') || document.querySelector('.input-area');
        if (inputArea) {
            const buttons = Array.from(inputArea.querySelectorAll('button'));
            const sendBtn = buttons.find(btn => {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const testId = btn.getAttribute('data-test-id') || '';
                return (ariaLabel.toLowerCase().includes('send') || 
                        ariaLabel.toLowerCase().includes('gửi') || 
                        testId.toLowerCase().includes('send'));
            });
            if (sendBtn) return sendBtn;
        }
        return null;
    }

    // Submit the prompt
    function submitPrompt() {
        const sendBtn = findSendButton();
        if (sendBtn) {
            if (!sendBtn.disabled) {
                sendBtn.click();
                log('Prompt submitted via shortcut!');
                return true;
            } else {
                log('Send button is disabled (generating or empty input).');
            }
        } else {
            log('Send button not found.');
        }
        return false;
    }

    // Autofocus on load & SPA navigation
    let autofocusAttempts = 0;
    function tryAutofocus() {
        autofocusAttempts = 0;
        const interval = setInterval(() => {
            const focused = focusInput();
            autofocusAttempts++;
            if (focused || autofocusAttempts > 25) { // Stop after 5 seconds
                clearInterval(interval);
            }
        }, 200);
    }

    // Run autofocus on load
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        tryAutofocus();
    } else {
        window.addEventListener('DOMContentLoaded', tryAutofocus);
    }

    // Watch for SPA URL changes to trigger autofocus
    let lastUrl = location.href;
    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            log('URL changed, triggering autofocus...');
            setTimeout(tryAutofocus, 300);
        }
    }, 500);

    // Keyboard shortcut listeners
    window.addEventListener('keydown', (e) => {
        // 1. Alt + C (Option + C on Mac) -> Copy last response
        if (e.altKey && e.code === 'KeyC') {
            e.preventDefault();
            e.stopPropagation();
            copyLastResponse();
        }

        // 2. Alt + I (Option + I on Mac) -> Focus input
        if (e.altKey && e.code === 'KeyI') {
            e.preventDefault();
            e.stopPropagation();
            focusInput();
        }

        // 3. Submit shortcuts: Alt+Enter, Ctrl+Enter, Cmd+Enter, Alt+S
        const isEnter = e.code === 'Enter' || e.code === 'NumpadEnter';
        const isS = e.code === 'KeyS';
        const isMetaOrCtrl = e.metaKey || e.ctrlKey;

        if ((isEnter && (e.altKey || isMetaOrCtrl)) || (isS && e.altKey)) {
            e.preventDefault();
            e.stopPropagation();
            submitPrompt();
        }
    }, true); // Use capture phase to ensure shortcuts run before page-level handlers

})();
