// ==UserScript==
// @name         BigQuery Console Enhancer
// @namespace    http://tampermonkey.net/
// @version      0.19
// @description  Add "Copy Results" button to BigQuery Console
// @author       You
// @match        https://console.cloud.google.com/bigquery*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=google.com
// @updateURL    https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/fast_copy_and_fit_bq.js
// @downloadURL  https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/fast_copy_and_fit_bq.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function log(msg) {
        console.log(`[BQ Enhancer] ${msg}`);
    }

    // --- Features ---

    async function copyToClipboardAction() {
        let saveBtn = document.querySelector('button[id$="save-results-menu-button"]');

        if (!saveBtn) {
            const buttons = Array.from(document.querySelectorAll('button'));
            saveBtn = buttons.find(b => {
                const text = b.textContent.toLowerCase();
                return text.includes('save results') || text.includes('lưu kết quả');
            });
        }

        if (!saveBtn) {
            alert("Save results button not found.");
            return;
        }

        // --- HIDE MENU START ---
        // Strategy: Use opacity 0 + visibility hidden to make it invisible.
        // We target multiple potential classes to be sure.
        const hideStyle = document.createElement('style');
        document.head.appendChild(hideStyle);

        const cssRules = [
            '.cdk-overlay-container { opacity: 0 !important; visibility: hidden !important; }',
            '.cdk-overlay-backdrop { opacity: 0 !important; visibility: hidden !important; }',
            '.cdk-overlay-pane { opacity: 0 !important; visibility: hidden !important; }',
            '.mat-menu-panel { opacity: 0 !important; visibility: hidden !important; }'
        ];

        try {
            cssRules.forEach((rule, idx) => {
                try {
                    hideStyle.sheet.insertRule(rule, idx);
                } catch (e) { /* ignore individual rule errors */ }
            });
        } catch (e) {
            console.warn("BQ Enhancer: Failed to inject hide styles", e);
        }
        // -----------------------

        try {
            saveBtn.click();

            // Wait for Overlay (menu to appear in DOM)
            await new Promise(r => setTimeout(r, 450));

            const overlay = document.querySelector('.cdk-overlay-container');

            // Find label
            const labels = overlay ? Array.from(overlay.querySelectorAll('.cfc-menu-item-label, .cfc-menu-item-text-content, span')) : [];
            const copyLabel = labels.find(el => {
                const text = el.textContent ? el.textContent.toLowerCase() : "";
                return (text.includes('copy to clipboard') ||
                    text.includes('sao chép vào khay nhớ tạm')) &&
                    !text.includes('json') &&
                    !text.includes('csv');
            });

            const clickable = copyLabel ? (copyLabel.closest('.cfc-menu-item-row') || copyLabel.closest('[role="menuitem"]') || copyLabel) : null;

            if (clickable) {
                clickable.click();

                const myBtn = document.getElementById('bq-enhancer-copy-btn');
                if (myBtn) {
                    const oldText = myBtn.innerText;
                    // Provide feedback
                    myBtn.innerText = "Copied!";
                    setTimeout(() => myBtn.innerText = oldText, 2000);
                }
            } else {
                saveBtn.click(); // Close menu if failing
                alert("Could not find 'Copy to Clipboard' item.");
            }
        } catch (err) {
            console.error("BQ Enhancer Error:", err);
        } finally {
            // --- HIDE MENU END ---
            // Remove style immediately to restore UI
            setTimeout(() => {
                if (hideStyle.parentNode) hideStyle.parentNode.removeChild(hideStyle);
            }, 300);
        }
    }

    function injectControls() {
        if (document.getElementById('bq-enhancer-container')) return;

        const buttons = Array.from(document.querySelectorAll('button'));
        const createConvBtn = buttons.find(b => b.id && b.id.includes('create-conversation-button'));

        if (!createConvBtn) return;

        const container = createConvBtn.parentElement;
        if (!container) return;

        const myContainer = document.createElement('div');
        myContainer.id = 'bq-enhancer-container';
        // Match the toolbar alignment
        myContainer.style.cssText = 'display: inline-flex; gap: 0px; margin-right: 4px; align-items: center; vertical-align: middle;';

        const copyBtn = document.createElement('button');
        copyBtn.id = 'bq-enhancer-copy-btn';
        copyBtn.innerText = "Copy Results";
        copyBtn.title = "Save results > Copy to clipboard";

        // Style to match "Save results" (Text button look)
        // Material Design text button: Transparent bg, Primary color text, Caps/Sentence case, 36px height
        copyBtn.style.cssText = `
            background-color: transparent;
            color: #3367d6; /* Standard Google Blue */
            border: none;
            padding: 0 8px;
            font-family: Roboto, "Helvetica Neue", sans-serif;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            border-radius: 4px;
            height: 32px;
            line-height: 32px;
            text-transform: none; /* Keep Sentence case */
            min-width: 64px;
            transition: background 0.2s;
            margin: 0 4px;
        `;

        // Hover effect (light grey background)
        copyBtn.onmouseover = () => copyBtn.style.backgroundColor = 'rgba(51, 103, 214, 0.04)'; // Subtle blue tint or grey #f1f3f4
        copyBtn.onmouseout = () => copyBtn.style.backgroundColor = 'transparent';

        copyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            copyToClipboardAction();
        });

        myContainer.appendChild(copyBtn);

        container.insertBefore(myContainer, createConvBtn);
        log("Copy button injected (v0.19).");
    }

    setInterval(injectControls, 1000);

})();
