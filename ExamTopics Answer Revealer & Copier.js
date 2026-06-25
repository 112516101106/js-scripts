// ==UserScript==
// @name         ExamTopics Answer Revealer & Copier & Predictor
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Tự động hiển thị đáp án ẩn, copy Q&A+ảnh, predict link ảnh đáp án từ câu hỏi (DRAG DROP variant swap, same-base incrementing)
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

    const delayMs = 1500;
    let isAutoEnabled = GM_getValue('et_auto_enabled', false);
    let tabMode = GM_getValue('et_tab_mode', 'new_tab');
    let autoTarget = GM_getValue('et_auto_target', 'img');
    let countdownInterval = null;

    // =============================================
    // 2. IMAGE URL PARSER (IMPROVED v4.0)
    // =============================================
    /**
     * Parses ExamTopics image URLs into structured components.
     *
     * Supported formats:
     *   Sequential:  https://.../01508/00033500001.ext  (10 digits → 5 base + 5 variant)
     *   Named:       https://.../01508/n26127200000.ext  (prefix 'n' + 6 base + 5 variant)
     *   Named short: https://.../01508/n26084000000.ext  (prefix 'n' + 5 base + 6 variant)
     *
     * Returns: { prefix, baseId, variant, ext, suffix, format, fullBase, fullVariant, url }
     *   or null if not parseable.
     */
    function parseImageUrl(url) {
        if (!url) return null;

        // Normalize relative paths
        let normalized = url;
        if (normalized.startsWith('/assets/')) {
            normalized = 'https://www.examtopics.com' + normalized;
        } else if (normalized.startsWith('assets/')) {
            normalized = 'https://www.examtopics.com/' + normalized;
        }

        // Extract filename from URL
        const urlParts = normalized.split('?')[0].split('#')[0];
        const pathParts = urlParts.split('/');
        const filename = pathParts[pathParts.length - 1];

        if (!filename) return null;

        // Try named format: n{digits}.{ext}  (e.g., n26127200000.png)
        // FIX: old regex /^(n\d+?)(0+)(\d+)$/ used lazy \d+? which broke on
        //      filenames like n26084000000 (matched base="26" instead of "26084")
        //      and (0+)(\d+) split variant "00000" into "0000"+"0".
        // NEW: capture ALL digits after 'n', then split with fixed offset.
        const namedMatch = filename.match(/^(n)(\d+)(\.[a-zA-Z0-9]+)$/);
        if (namedMatch) {
            const prefix = pathParts.slice(0, -1).join('/') + '/';
            const allDigits = namedMatch[2];        // e.g., "26127200000"
            const ext = namedMatch[3];              // e.g., ".png"

            // Split: last 5 digits = variant, everything before = base
            // Works for both 6+5 (n26127200000) and 5+6 (n26084000000) formats
            const VARIANT_LEN = 5;
            const baseNum = allDigits.slice(0, -VARIANT_LEN);  // "261272" or "260840"
            const variantStr = allDigits.slice(-VARIANT_LEN);   // "00000"
            const variantNum = parseInt(variantStr, 10);

            // Extract suffix from original URL (query params, hash)
            const suffix = url.includes('?') ? url.substring(url.indexOf('?')) : '';
            const hashSuffix = url.includes('#') ? url.split('#')[1] : '';

            return {
                prefix,
                baseId: baseNum,
                variant: variantNum,
                variantStr: variantStr,
                ext,
                suffix: hashSuffix ? '#' + hashSuffix : (suffix || ''),
                format: 'named',
                basePrefix: 'n',
                url: normalized,
            };
        }

        // Try sequential format: {10 digits}.{ext}
        const seqMatch = filename.match(/^(\d{10})(\.[a-zA-Z0-9]+)$/);
        if (seqMatch) {
            const prefix = pathParts.slice(0, -1).join('/') + '/';
            const numStr = seqMatch[1];
            const ext = seqMatch[2];

            // Split: first 5 = base, last 5 = variant
            const baseNum = numStr.substring(0, 5);
            const variantStr = numStr.substring(5, 10);
            const variantNum = parseInt(variantStr, 10);

            const hashSuffix = url.includes('#') ? url.split('#')[1] : '';

            return {
                prefix,
                baseId: baseNum,
                variant: variantNum,
                variantStr: variantStr,
                ext,
                suffix: hashSuffix ? '#' + hashSuffix : '',
                format: 'sequential',
                basePrefix: '',
                url: normalized,
            };
        }

        // Try shorter sequential: {8-9 digits}.{ext}
        const shortSeqMatch = filename.match(/^(\d{8,9})(\.[a-zA-Z0-9]+)$/);
        if (shortSeqMatch) {
            const prefix = pathParts.slice(0, -1).join('/') + '/';
            const numStr = shortSeqMatch[1];
            const ext = shortSeqMatch[2];

            return {
                prefix,
                baseId: numStr,
                variant: 0,
                variantStr: '',
                ext,
                suffix: '',
                format: 'short_seq',
                basePrefix: '',
                url: normalized,
            };
        }

        return null;
    }

    /**
     * Build URL from parsed components with new variant/base.
     */
    function buildImageUrl(parsed, overrides = {}) {
        if (!parsed) return null;

        const base = overrides.baseId !== undefined ? overrides.baseId : parsed.baseId;
        const variant = overrides.variant !== undefined ? overrides.variant : parsed.variant;
        const ext = overrides.ext !== undefined ? overrides.ext : parsed.ext;
        const prefix = overrides.prefix !== undefined ? overrides.prefix : parsed.prefix;

        let filename;
        if (parsed.format === 'named') {
            const variantLen = parsed.variantStr.length || 5;
            filename = parsed.basePrefix + base + String(variant).padStart(variantLen, '0') + ext;
        } else if (parsed.format === 'sequential') {
            const baseLen = parsed.baseId.length || 5;
            const varLen = parsed.variantStr.length || 5;
            filename = String(base).padStart(baseLen, '0') + String(variant).padStart(varLen, '0') + ext;
        } else {
            filename = base + ext;
        }

        return prefix + filename;
    }

    /**
     * Check if an image URL exists (HEAD request + image load fallback).
     * Returns { exists: bool, url: string }.
     */
    async function checkImageExists(url) {
        try {
            const resp = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
            if (resp.status === 200) return { exists: true, url };
            if (resp.type === 'opaque') return { exists: true, url };
            // Try GET as fallback for CORS issues
            const resp2 = await fetch(url, { method: 'GET', mode: 'no-cors' });
            if (resp2.status === 200 || resp2.type === 'opaque') return { exists: true, url };
            return { exists: false, url };
        } catch (e) {
            return new Promise(resolve => {
                const img = new Image();
                img.onload = () => resolve({ exists: true, url });
                img.onerror = () => resolve({ exists: false, url });
                img.src = url;
            });
        }
    }

    /**
     * Open URL in new tab with 404 detection.
     * If image doesn't exist, shows toast and opens next valid variant.
     */
    async function openWith404Check(url, fallbackFn) {
        const result = await checkImageExists(url);
        if (result.exists) {
            GM_openInTab(url, { active: true, insert: true });
        } else {
            showToast(`❌ 404: ${url.split('/').pop()} not found!`, 4000);
            if (fallbackFn) fallbackFn();
        }
    }

    // =============================================
    // 3. ANSWER PREDICTION ENGINE (NEW v4.0)
    // =============================================

    /**
     * Prediction strategies for different question types.
     */
    /**
     * Helper: get the alternate extension for ExamTopics images.
     * Common pattern: .png ↔ .jpg
     */
    function alternateExt(ext) {
        if (!ext) return ext;
        const lower = ext.toLowerCase();
        if (lower === '.png') return '.jpg';
        if (lower === '.jpg' || lower === '.jpeg') return '.png';
        return ext; // no alternate for .gif, .svg, etc.
    }

    /**
     * Helper: build prediction with both same and alternate extensions.
     * Returns array of { url, ext, label } objects.
     */
    function buildPredictionUrls(parsed, variant, labelPrefix) {
        const urls = [];
        // Same extension
        const sameUrl = buildImageUrl(parsed, { variant });
        urls.push({ url: sameUrl, ext: parsed.ext, label: labelPrefix, altExt: false });
        // Alternate extension
        const altExt = alternateExt(parsed.ext);
        if (altExt !== parsed.ext) {
            const altUrl = buildImageUrl(parsed, { variant, ext: altExt });
            urls.push({ url: altUrl, ext: altExt, label: `${labelPrefix} (${altExt})`, altExt: true });
        }
        return urls;
    }

    const PredictionStrategy = {
        /**
         * DRAG DROP: Q and A are互斥 variants of same base.
         * Also tries alternate extension (.png ↔ .jpg).
         */
        dragDropSwap(parsed) {
            if (!parsed || parsed.format === 'short_seq') return [];

            const predictions = [];
            const swapVariants = [1, 0];
            for (const v of swapVariants) {
                if (v !== parsed.variant) {
                    const predUrls = buildPredictionUrls(parsed, v, `Answer (variant ${v})`);
                    predUrls.forEach(p => {
                        predictions.push({
                            url: p.url,
                            strategy: 'drag_drop_swap',
                            label: p.label,
                            confidence: p.altExt ? 'medium' : 'high',
                        });
                    });
                }
            }
            // Also try variant 2 with both extensions
            if (parsed.variant <= 1) {
                const predUrls = buildPredictionUrls(parsed, 2, 'Answer (variant 2)');
                predUrls.forEach(p => {
                    predictions.push({
                        url: p.url,
                        strategy: 'drag_drop_extended',
                        label: p.label,
                        confidence: 'low',
                    });
                });
            }
            return predictions;
        },

        /**
         * Same-base incrementing: also tries alternate extension.
         */
        sameBaseIncrement(parsed, count = 3) {
            if (!parsed || parsed.format === 'short_seq') return [];

            const predictions = [];
            for (let i = 1; i <= count; i++) {
                const nextVariant = parsed.variant + i;
                const predUrls = buildPredictionUrls(parsed, nextVariant, `Option +${i} (variant ${nextVariant})`);
                predUrls.forEach(p => {
                    predictions.push({
                        url: p.url,
                        strategy: 'same_base_increment',
                        label: p.label,
                        confidence: (i <= 2 && !p.altExt) ? 'medium' : 'low',
                    });
                });
            }
            return predictions;
        },

        /**
         * Previous variant: also tries alternate extension.
         */
        previousVariant(parsed) {
            if (!parsed || parsed.format === 'short_seq') return [];

            const predictions = [];
            if (parsed.variant > 0) {
                const predUrls = buildPredictionUrls(parsed, parsed.variant - 1, `Previous (variant ${parsed.variant - 1})`);
                predUrls.forEach(p => {
                    predictions.push({
                        url: p.url,
                        strategy: 'previous_variant',
                        label: p.label,
                        confidence: p.altExt ? 'medium' : 'high',
                    });
                });
            }
            return predictions;
        },

        /**
         * Combined: generate all possible predictions for a parsed URL.
         * Returns categorized predictions.
         */
        predictAll(parsed) {
            if (!parsed) return { dragDrop: [], sameBase: [], previous: [] };

            return {
                dragDrop: this.dragDropSwap(parsed),
                sameBase: this.sameBaseIncrement(parsed, 3),
                previous: this.previousVariant(parsed),
            };
        },
    };

    /**
     * Check if a URL is likely a DRAG DROP question image.
     * Heuristic: named format with specific base ID ranges, or sequential with certain patterns.
     */
    function isDragDropImage(parsed) {
        if (!parsed) return false;
        if (parsed.format !== 'named') return false;

        // DRAG DROP base IDs for 200-125: 261271-261283
        const baseNum = parseInt(parsed.baseId, 10);
        if (baseNum >= 261271 && baseNum <= 261283) return true;

        // Generic check: if variant is 0 or 1, likely DRAG DROP
        if (parsed.variant <= 1) return true;

        return false;
    }

    /**
     * Normalize any ExamTopics image URL to a standard format.
     * Handles both relative and absolute paths.
     */
    function normalizeImageSrc(src) {
        if (!src) return null;
        let url = src.trim();
        if (url.startsWith('/assets/')) {
            url = 'https://www.examtopics.com' + url;
        } else if (url.startsWith('assets/')) {
            url = 'https://www.examtopics.com/' + url;
        }
        return url;
    }

    // Legacy parseUrl for backward compatibility with existing code
    function parseUrl(url) {
        const match = url.match(/^(.*\/[^0-9\/]*)(\d+)(\.[a-zA-Z0-9]+)?(#.*|\?.*)?$/);
        if (!match) return null;

        const prefix = match[1];
        const numStr = match[2];
        const ext = match[3] || '';
        const suffix = match[4] || '';
        const isDual = numStr.length === 10;

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
        // Try new parser first
        const parsed = parseImageUrl(url);
        if (parsed && parsed.format !== 'short_seq') {
            const delta = type === 'next' ? 1 : -1;
            const newVariant = Math.max(0, parsed.variant + delta);
            return buildImageUrl(parsed, { variant: newVariant });
        }

        // Fallback to legacy parser
        const legacy = parseUrl(url);
        if (!legacy) return null;

        let newNumStr = '';
        if (legacy.isDual) {
            if (component === 'q') {
                const newQ = type === 'next'
                    ? incrementNumberString(legacy.qStr)
                    : decrementNumberString(legacy.qStr);
                newNumStr = newQ + legacy.imgStr;
            } else {
                const newImg = type === 'next'
                    ? incrementNumberString(legacy.imgStr)
                    : decrementNumberString(legacy.imgStr);
                newNumStr = legacy.qStr + newImg;
            }
        } else {
            newNumStr = type === 'next'
                ? incrementNumberString(legacy.numStr)
                : decrementNumberString(legacy.numStr);
        }

        let cleanSuffix = legacy.suffix;
        if (cleanSuffix.includes('autochain=')) {
            cleanSuffix = cleanSuffix.replace(/[?#]autochain=(true|false)/g, '');
        }
        return legacy.prefix + newNumStr + legacy.ext + cleanSuffix;
    }

    function getPageNavigationLink(direction) {
        if (direction === 'next') {
            const nextEl = document.querySelector('.next-question, .next-btn, a[class*="next"]');
            if (nextEl) return nextEl;
            const links = document.querySelectorAll('a');
            for (const link of links) {
                if (link.textContent.toLowerCase().includes('next question')) return link;
            }
        } else {
            const prevEl = document.querySelector('.prev-question, .prev-btn, a[class*="prev"]');
            if (prevEl) return prevEl;
            const links = document.querySelectorAll('a');
            for (const link of links) {
                const txt = link.textContent.toLowerCase();
                if (txt.includes('previous question') || txt.includes('prev question')) return link;
            }
        }
        return null;
    }

    function copyCleanLink(url) {
        let cleanUrl = url;
        if (cleanUrl.includes('#')) cleanUrl = cleanUrl.split('#')[0];
        if (cleanUrl.includes('?')) cleanUrl = cleanUrl.replace(/[?&]autochain=(true|false)/g, '');
        copyToClipboard(cleanUrl);
        showToast('Copied clean link to clipboard!');
    }

    function processAndOpenPastedLink(text) {
        let pastedText = text.trim();
        if (!pastedText) return false;

        if (pastedText.startsWith('/assets/')) {
            pastedText = 'https://examtopics.com' + pastedText;
        } else if (pastedText.startsWith('assets/')) {
            pastedText = 'https://examtopics.com/' + pastedText;
        }

        if (pastedText.includes('examtopics.com')) {
            const parsed = parseImageUrl(pastedText);
            if (parsed) {
                // Generate predictions
                const predictions = PredictionStrategy.predictAll(parsed);
                const isDD = isDragDropImage(parsed);

                // Build action list
                const actions = [];

                // Always offer next variant
                const nextUrl = buildImageUrl(parsed, { variant: parsed.variant + 1 });
                actions.push({
                    label: `Next (+1)`,
                    primary: true,
                    callback: () => GM_openInTab(nextUrl, { active: true, insert: true }),
                });

                // If DRAG DROP, offer answer prediction
                if (isDD && predictions.dragDrop.length > 0) {
                    const answerUrl = predictions.dragDrop[0].url;
                    actions.push({
                        label: `🎯 Answer`,
                        primary: false,
                        callback: () => GM_openInTab(answerUrl, { active: true, insert: true }),
                    });
                }

                // Offer same-base increment
                if (predictions.sameBase.length > 0) {
                    actions.push({
                        label: `+2 Variant`,
                        primary: false,
                        callback: () => GM_openInTab(predictions.sameBase[0].url, { active: true, insert: true }),
                    });
                }

                const filename = pastedText.split('/').pop().split(/[?#]/)[0];
                const label = isDD
                    ? `DRAG DROP detected: ${filename}\n🎯 Answer: ${predictions.dragDrop[0]?.url?.split('/').pop() || 'N/A'}`
                    : `Pasted: ${filename}. Open next?`;

                showToast(label, delayMs + 1500, { actions });

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
                minWidth: '320px',
                maxWidth: '420px',
            });
            document.documentElement.appendChild(toast);
        }

        toast.innerHTML = `
            <div style="font-weight: 600; color: #38bdf8; margin-bottom: 2px;">ExamTopics Helper</div>
            <div style="color: #cbd5e1; font-size: 12px; margin-bottom: 4px; white-space: pre-wrap; word-break: break-all;">${message}</div>
            <div id="et-toast-actions" style="display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;"></div>
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
                    transition: 'all 0.2s',
                });
                btn.onmouseenter = () => { btn.style.background = action.primary ? '#0284c7' : 'rgba(255, 255, 255, 0.15)'; };
                btn.onmouseleave = () => { btn.style.background = action.primary ? '#0ea5e9' : 'rgba(255, 255, 255, 0.08)'; };
                btn.onclick = () => { closeToast(); if (action.callback) action.callback(); };
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
            fontWeight: '600',
        });
        cancelBtn.onclick = () => closeToast();
        actionsContainer.appendChild(cancelBtn);

        setTimeout(() => { toast.style.transform = 'translateX(-50%) translateY(0)'; }, 50);

        if (options.defaultAction) {
            setTimeout(() => { if (!isActionTaken) { closeToast(); options.defaultAction(); } }, duration);
        } else {
            setTimeout(() => { if (!isActionTaken) closeToast(); }, duration);
        }
    }

    // =============================================
    // 4. NUCLEAR POPUP BLOCKER (unchanged)
    // =============================================
    if (isMainDomain) {
        const cssKill = document.createElement('style');
        cssKill.textContent = `
            .popup-overlay, #notRemoverPopup, .popup-overlay.show {
                display: none !important; visibility: hidden !important; opacity: 0 !important;
                pointer-events: none !important; width: 0 !important; height: 0 !important;
                overflow: hidden !important; position: fixed !important;
                top: -9999px !important; left: -9999px !important; z-index: -1 !important;
            }
        `;
        (document.head || document.documentElement).appendChild(cssKill);

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

        Object.defineProperty(window, 'createPopup', {
            get() { return function() {}; },
            set() { },
            configurable: false
        });

        Object.defineProperty(window, 'originalPopupContent', {
            get() { return null; },
            set() { },
            configurable: false
        });

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.id === 'notRemoverPopup' || node.classList?.contains('popup-overlay') || node.classList?.contains('show')) {
                        node.remove();
                    }
                }
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    if (mutation.target.classList?.contains('popup-overlay') || mutation.target.id === 'notRemoverPopup') {
                        mutation.target.remove();
                    }
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

        const cleanExistingPopups = () => {
            document.querySelectorAll('.popup-overlay, #notRemoverPopup').forEach(el => el.remove());
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', cleanExistingPopups);
        } else {
            cleanExistingPopups();
        }

        document.addEventListener('contextmenu', e => e.stopPropagation(), true);
        document.addEventListener('keydown', e => {
            const key = e.key.toLowerCase();
            const activeEl = document.activeElement;
            const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
            if (
                ((e.ctrlKey || e.metaKey) && (key === 'c' || key === 'v' || key === 'a' || key === 'x')) ||
                key === 'f12' || (e.metaKey && e.ctrlKey && key === 'v') || (e.altKey && key === 'v')
            ) {
                e.stopPropagation();
            }
        }, true);
    }

    // =============================================
    // 5. REVEAL HIDDEN ANSWERS
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
        if (answerBtn) answerBtn.style.display = 'none';
        return correctItems;
    }

    // =============================================
    // 6. EXTRACT QUESTION & ANSWER DATA
    // =============================================
    function extractQuestionData() {
        const data = {
            exam: '', questionNum: '', topic: '',
            questionText: '', choices: [], correctAnswers: [],
            communityAnswers: [], hasImage: false, imageUrls: []
        };
        if (!isMainDomain) return data;

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

        const questionBody = document.querySelector('.question-body .card-text') || document.querySelector('.question-body');
        if (questionBody) {
            const cardTextEl = questionBody.classList.contains('card-text') ? questionBody : questionBody.querySelector('.card-text');
            data.questionText = cardTextEl ? cardTextEl.textContent.trim() : questionBody.textContent.trim();

            const rootBody = document.querySelector('.question-body') || questionBody;
            const imgs = rootBody.querySelectorAll('img');
            imgs.forEach(img => {
                const src = normalizeImageSrc(img.getAttribute('src') || img.getAttribute('data-src'));
                if (src && !data.imageUrls.includes(src)) {
                    data.imageUrls.push(src);
                    data.hasImage = true;
                }
            });
        }

        const choiceItems = document.querySelectorAll('.multi-choice-item');
        choiceItems.forEach(item => {
            const letterSpan = item.querySelector('.multi-choice-letter');
            const letter = letterSpan ? letterSpan.getAttribute('data-choice-letter') : '';
            let choiceText = item.textContent.trim().replace(/^[A-Z]\.\s*/, '').trim();

            // Extract images from choice items
            const choiceImgs = item.querySelectorAll('img');
            const choiceImageUrls = [];
            choiceImgs.forEach(img => {
                const src = normalizeImageSrc(img.getAttribute('src') || img.getAttribute('data-src'));
                if (src) choiceImageUrls.push(src);
            });

            data.choices.push({ letter, text: choiceText, imageUrls: choiceImageUrls });

            if (item.classList.contains('correct-hidden') || item.style.backgroundColor === 'rgb(212, 237, 218)') {
                data.correctAnswers.push(letter);
            }
        });

        const voteComments = document.querySelectorAll('.comment-container');
        voteComments.forEach(comment => {
            const voteAnswer = comment.querySelector('.voted-answer-holder');
            if (voteAnswer) data.communityAnswers.push(voteAnswer.textContent.trim());
        });

        return data;
    }

    // =============================================
    // 7. FORMAT & COPY TO CLIPBOARD
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

                // Add predicted answer images
                const parsed = parseImageUrl(url);
                if (parsed) {
                    const predictions = PredictionStrategy.predictAll(parsed);
                    if (predictions.dragDrop.length > 0) {
                        text += `  🎯 Predicted Answer: ${predictions.dragDrop[0].url}\n`;
                    }
                    if (predictions.sameBase.length > 0) {
                        text += `  📎 Option +1: ${predictions.sameBase[0].url}\n`;
                    }
                }
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
            if (c.imageUrls && c.imageUrls.length > 0) {
                c.imageUrls.forEach((imgUrl, idx) => {
                    text += `     🖼️ ${imgUrl}\n`;
                });
            }
        });

        text += `\n${'─'.repeat(50)}\n`;
        text += `✅ Correct Answer: ${data.correctAnswers.length > 0 ? data.correctAnswers.join(', ') : 'N/A (check community votes)'}\n`;
        if (data.communityAnswers.length > 0) {
            text += `👥 Community Votes: ${JSON.stringify(data.communityAnswers)}\n`;
        }
        return text;
    }

    // =============================================
    // 8. CREATE FLOATING UI PANEL (Main Domain)
    // =============================================
    function injectMainStyle() {
        GM_addStyle(`
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
            #et-revealer-panel {
                position: fixed; top: 12px; right: 12px; z-index: 999999;
                font-family: 'Inter', -apple-system, sans-serif; width: 360px;
                max-height: calc(100vh - 24px); display: flex; flex-direction: column;
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
                border: 1px solid rgba(255,255,255,0.1); border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(83,120,255,0.15);
                color: #e0e0e0; overflow: hidden; backdrop-filter: blur(20px);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            #et-revealer-panel.minimized {
                width: 56px; height: 56px; max-height: 56px; border-radius: 50%;
                cursor: pointer; overflow: hidden;
            }
            #et-revealer-panel.minimized .et-panel-body,
            #et-revealer-panel.minimized .et-panel-header-text { display: none; }
            .et-panel-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 14px 18px;
                background: linear-gradient(90deg, rgba(83,120,255,0.3), rgba(0,200,150,0.2));
                border-bottom: 1px solid rgba(255,255,255,0.08); cursor: move; user-select: none;
            }
            .minimized .et-panel-header {
                padding: 0; width: 56px; height: 56px; display: flex;
                align-items: center; justify-content: center; border: none;
            }
            .et-panel-header-icon { font-size: 22px; filter: drop-shadow(0 0 6px rgba(83,120,255,0.5)); }
            .et-panel-header-text h3 { margin: 0; font-size: 14px; font-weight: 700; color: #fff; letter-spacing: 0.5px; }
            .et-panel-header-text span { font-size: 11px; color: rgba(255,255,255,0.5); }
            .et-btn-minimize {
                background: none; border: none; color: rgba(255,255,255,0.6);
                font-size: 18px; cursor: pointer; padding: 4px; border-radius: 6px; transition: all 0.2s;
            }
            .et-btn-minimize:hover { background: rgba(255,255,255,0.1); color: #fff; }
            .et-panel-body { padding: 16px 18px; overflow-y: auto; flex: 1; }
            .et-panel-body::-webkit-scrollbar { width: 6px; }
            .et-panel-body::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); border-radius: 3px; }
            .et-panel-body::-webkit-scrollbar-thumb { background: rgba(83,120,255,0.3); border-radius: 3px; }
            .et-panel-body::-webkit-scrollbar-thumb:hover { background: rgba(83,120,255,0.5); }
            .et-answer-badge {
                display: inline-flex; align-items: center; gap: 8px;
                padding: 10px 18px; background: linear-gradient(135deg, #28a745, #20c997);
                border-radius: 10px; font-size: 20px; font-weight: 700; color: #fff;
                letter-spacing: 1px; box-shadow: 0 4px 15px rgba(40,167,69,0.4);
                margin-bottom: 14px; animation: et-pulse 2s ease-in-out infinite;
            }
            @keyframes et-pulse {
                0%, 100% { box-shadow: 0 4px 15px rgba(40,167,69,0.4); }
                50% { box-shadow: 0 4px 25px rgba(40,167,69,0.7); }
            }
            .et-answer-badge .et-badge-icon { font-size: 24px; }
            .et-info-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 13px; color: rgba(255,255,255,0.7); }
            .et-info-row .et-info-label { color: rgba(255,255,255,0.4); min-width: 70px; }
            .et-divider { height: 1px; background: rgba(255,255,255,0.08); margin: 12px 0; }
            .et-btn {
                display: flex; align-items: center; justify-content: center; gap: 8px;
                width: 100%; padding: 10px 16px; border: none; border-radius: 10px;
                font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
                transition: all 0.2s; margin-bottom: 8px;
            }
            .et-btn-copy { background: linear-gradient(135deg, #5378ff, #3b5bdb); color: #fff; }
            .et-btn-copy:hover { background: linear-gradient(135deg, #6b8aff, #4c6ef5); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(83,120,255,0.4); }
            .et-btn-copy.copied { background: linear-gradient(135deg, #28a745, #20c997); }
            .et-btn-nav { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); border: 1px solid rgba(255,255,255,0.1); }
            .et-btn-nav:hover { background: rgba(255,255,255,0.12); color: #fff; }
            .et-btn-predict {
                background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff;
                border: 1px solid rgba(245,158,11,0.4);
            }
            .et-btn-predict:hover { background: linear-gradient(135deg, #fbbf24, #f59e0b); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(245,158,11,0.4); }
            .et-question-preview {
                font-size: 12px; color: rgba(255,255,255,0.5); line-height: 1.5;
                max-height: 60px; overflow: hidden; text-overflow: ellipsis;
                display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
            }
            .et-prediction-box {
                background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2);
                border-radius: 8px; padding: 8px 10px; margin-top: 6px; font-size: 11px;
            }
            .et-prediction-box .et-pred-label { color: #fbbf24; font-weight: 600; margin-bottom: 4px; }
            .et-prediction-box .et-pred-item {
                display: flex; justify-content: space-between; align-items: center;
                padding: 3px 0; color: #cbd5e1;
            }
            .et-prediction-box .et-pred-item a {
                color: #38bdf8; text-decoration: none; font-family: monospace; font-size: 10px;
            }
            .et-prediction-box .et-pred-item a:hover { text-decoration: underline; }
        `);
    }

    function createMainPanel(data) {
        if (!isMainDomain) return;
        injectMainStyle();

        const panel = document.createElement('div');
        panel.id = 'et-revealer-panel';

        const answerDisplay = data.correctAnswers.length > 0
            ? data.correctAnswers.join(', ')
            : (data.communityAnswers.length > 0 ? `Community: ${JSON.stringify(data.communityAnswers)}` : 'Chưa xác định');

        const questionPreview = data.questionText.length > 120
            ? data.questionText.substring(0, 120) + '...' : data.questionText;

        // Build image list with predictions
        let imageListHtml = '';
        if (data.imageUrls && data.imageUrls.length > 0) {
            const imageItems = data.imageUrls.map((url, idx) => {
                const parsed = parseImageUrl(url);
                const predictions = parsed ? PredictionStrategy.predictAll(parsed) : null;
                const isDD = parsed ? isDragDropImage(parsed) : false;

                let predHtml = '';
                if (predictions && (predictions.dragDrop.length > 0 || predictions.sameBase.length > 0)) {
                    const predItems = [];
                    if (isDD && predictions.dragDrop.length > 0) {
                        const pUrl = predictions.dragDrop[0].url;
                        const pName = pUrl.split('/').pop();
                        predItems.push(`<div class="et-pred-item"><span>🎯 Answer:</span><a href="${pUrl}" target="_blank" title="${pUrl}">${pName}</a></div>`);
                    }
                    if (predictions.sameBase.length > 0) {
                        const pUrl = predictions.sameBase[0].url;
                        const pName = pUrl.split('/').pop();
                        predItems.push(`<div class="et-pred-item"><span>📎 +1:</span><a href="${pUrl}" target="_blank" title="${pUrl}">${pName}</a></div>`);
                    }
                    if (predictions.previous.length > 0) {
                        const pUrl = predictions.previous[0].url;
                        const pName = pUrl.split('/').pop();
                        predItems.push(`<div class="et-pred-item"><span>⬅️ Prev:</span><a href="${pUrl}" target="_blank" title="${pUrl}">${pName}</a></div>`);
                    }

                    if (predItems.length > 0) {
                        predHtml = `
                            <div class="et-prediction-box">
                                <div class="et-pred-label">${isDD ? '🔀 DRAG DROP Predictions:' : '🔗 Variant Predictions:'}</div>
                                ${predItems.join('')}
                            </div>
                        `;
                    }
                }

                return `
                    <div style="margin-bottom: 8px; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 6px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; gap: 8px;">
                            <span style="color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;" title="${url}">🖼️ Image ${idx + 1}</span>
                            <div style="display: flex; gap: 4px; flex-shrink: 0;">
                                <button class="et-open-img-btn" data-url="${url}" style="background: rgba(83,120,255,0.25); border: 1px solid rgba(83,120,255,0.4); color: #38bdf8; border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer;">Open</button>
                                <button class="et-copy-img-btn" data-url="${url}" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.8); border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer;">Copy</button>
                                ${isDD ? '<span style="color: #fbbf24; font-size: 10px;" title="DRAG DROP detected">🔀</span>' : ''}
                            </div>
                        </div>
                        ${predHtml}
                    </div>
                `;
            }).join('');

            imageListHtml = `
                <div class="et-divider"></div>
                <div class="et-info-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                    <span class="et-info-label" style="font-size: 11px;">Question Images & Predictions:</span>
                    <div style="width: 100%; max-height: 250px; overflow-y: auto; box-sizing: border-box;">
                        ${imageItems}
                    </div>
                </div>
            `;
        }

        panel.innerHTML = `
            <div class="et-panel-header">
                <span class="et-panel-header-icon">🔓</span>
                <div class="et-panel-header-text">
                    <h3>ExamTopics Ultimate Helper</h3>
                    <span>v4.0 — Answer & Image Prediction</span>
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
                    📋 Copy Câu hỏi + Đáp án + Ảnh + Predict [C]
                </button>
                <button class="et-btn et-btn-nav" id="et-copy-answer-only">
                    📝 Copy Đáp án Only [V]
                </button>
                <button class="et-btn et-btn-predict" id="et-open-all-predicted">
                    🎯 Open All Predicted Answers [P]
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

        // Copy full Q&A with predictions
        document.getElementById('et-copy-btn').addEventListener('click', () => {
            const text = formatQA(data);
            copyToClipboard(text);
            const btn = document.getElementById('et-copy-btn');
            btn.classList.add('copied');
            btn.innerHTML = '✅ Đã copy!';
            showToast('📋 Đã copy câu hỏi, đáp án, ảnh và predictions!');
            setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = '📋 Copy Câu hỏi + Đáp án + Ảnh + Predict [C]'; }, 2000);
        });

        // Copy answer only
        document.getElementById('et-copy-answer-only').addEventListener('click', () => {
            const answerText = `${data.exam} - Q${data.questionNum}: ${answerDisplay}`;
            copyToClipboard(answerText);
            showToast(`📝 Đáp án: ${answerDisplay}`);
        });

        // Open all predicted answer images
        document.getElementById('et-open-all-predicted').addEventListener('click', () => {
            let openedCount = 0;
            data.imageUrls.forEach(url => {
                const parsed = parseImageUrl(url);
                if (!parsed) return;
                const predictions = PredictionStrategy.predictAll(parsed);
                // Open the highest-confidence prediction
                const best = predictions.dragDrop[0] || predictions.sameBase[0];
                if (best) {
                    GM_openInTab(best.url, { active: false, insert: true });
                    openedCount++;
                }
            });
            if (openedCount > 0) {
                showToast(`🎯 Opened ${openedCount} predicted answer image(s)!`);
            } else {
                showToast('⚠️ No predictions available for this question.');
            }
        });

        // Open image buttons
        panel.querySelectorAll('.et-open-img-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                GM_openInTab(btn.getAttribute('data-url'), { active: true, insert: true });
            });
        });

        // Copy image buttons
        panel.querySelectorAll('.et-copy-img-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const url = btn.getAttribute('data-url');
                if (copyToClipboard(url)) {
                    btn.textContent = 'Copied!';
                    btn.style.background = '#28a745';
                    btn.style.borderColor = '#28a745';
                    showToast('🖼️ Copied image URL!');
                    setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = ''; btn.style.borderColor = ''; }, 1500);
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
        document.addEventListener('mouseup', () => { isDragging = false; panel.style.transition = ''; });
    }

    // =============================================
    // 9. CREATE IMAGE HELPER PANEL (Image Domain)
    // =============================================
    function injectImageStyle() {
        const style = document.createElement('style');
        style.innerHTML = `
            #et-helper-panel {
                position: fixed; top: 20px; right: 20px; width: 300px;
                max-height: calc(100vh - 40px); overflow-y: auto; padding: 16px;
                background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(12px) saturate(180%);
                -webkit-backdrop-filter: blur(12px) saturate(180%);
                border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); color: #f8fafc;
                font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
                z-index: 99999999; user-select: none;
                transition: opacity 0.3s, transform 0.3s;
            }
            #et-helper-panel::-webkit-scrollbar { width: 6px; }
            #et-helper-panel::-webkit-scrollbar-track { background: rgba(255,255,255,0.02); border-radius: 3px; }
            #et-helper-panel::-webkit-scrollbar-thumb { background: rgba(56,189,248,0.3); border-radius: 3px; }
            #et-helper-panel:hover { border-color: rgba(255, 255, 255, 0.2); }
            #et-helper-panel .et-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; }
            #et-helper-panel .et-title { font-weight: 600; color: #38bdf8; letter-spacing: 0.5px; }
            #et-helper-panel #et-btn-close { background: none; border: none; color: #94a3b8; font-size: 18px; cursor: pointer; line-height: 1; padding: 0 4px; transition: color 0.2s; }
            #et-helper-panel #et-btn-close:hover { color: #ef4444; }
            #et-helper-panel .et-status-section { margin-bottom: 12px; }
            #et-helper-panel .et-status-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
            #et-helper-panel .et-label { color: #94a3b8; }
            #et-helper-panel .et-value { font-family: monospace; font-weight: 500; }
            #et-helper-panel .et-settings-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; color: #94a3b8; font-size: 11px; }
            #et-helper-panel .et-progress-container { background: rgba(255,255,255,0.05); border-radius: 6px; height: 18px; position: relative; overflow: hidden; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; }
            #et-helper-panel .et-progress-bar { position: absolute; left: 0; top: 0; height: 100%; width: 0%; background: linear-gradient(90deg, #0ea5e9, #38bdf8); transition: width 0.1s linear; }
            #et-helper-panel .et-progress-text { position: relative; z-index: 1; font-size: 11px; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
            #et-helper-panel .et-controls { display: flex; gap: 8px; }
            #et-helper-panel .et-btn { flex: 1; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); color: #f8fafc; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; transition: all 0.2s; outline: none; text-align: center; }
            #et-helper-panel .et-btn:hover { background: rgba(255,255,255,0.15); border-color: rgba(255,255,255,0.2); }
            #et-helper-panel .et-btn-primary { background: #0ea5e9; border-color: #0ea5e9; }
            #et-helper-panel .et-btn-primary:hover { background: #0284c7; border-color: #0284c7; }
            #et-helper-panel .et-btn-active { background: #22c55e !important; border-color: #22c55e !important; }
            #et-helper-panel .et-btn-active:hover { background: #16a34a !important; border-color: #16a34a !important; }
            #et-helper-panel .et-btn-predict { background: linear-gradient(135deg, #f59e0b, #d97706); border-color: #f59e0b; }
            #et-helper-panel .et-btn-predict:hover { background: linear-gradient(135deg, #fbbf24, #f59e0b); }
            #et-helper-panel .et-footer { font-size: 10px; color: #64748b; text-align: center; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px; margin-top: 10px; }
            #et-helper-panel .et-predict-section { background: rgba(245,158,11,0.08); border: 1px solid rgba(245,158,11,0.2); border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; }
            #et-helper-panel .et-predict-title { color: #fbbf24; font-weight: 600; font-size: 12px; margin-bottom: 6px; }
            #et-helper-panel .et-predict-row { display: flex; justify-content: space-between; align-items: center; padding: 3px 0; font-size: 11px; }
            #et-helper-panel .et-predict-row .et-p-label { color: #94a3b8; }
            #et-helper-panel .et-predict-row .et-p-url { color: #38bdf8; font-family: monospace; font-size: 10px; cursor: pointer; text-decoration: none; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; }
            #et-helper-panel .et-predict-row .et-p-url:hover { text-decoration: underline; }
            #et-helper-panel .et-predict-row .et-p-badge { font-size: 9px; padding: 1px 4px; border-radius: 3px; font-weight: 600; }
            #et-helper-panel .et-predict-row .et-p-badge.high { background: rgba(34,197,94,0.2); color: #22c55e; }
            #et-helper-panel .et-predict-row .et-p-badge.medium { background: rgba(56,189,248,0.2); color: #38bdf8; }
            #et-helper-panel .et-predict-row .et-p-badge.low { background: rgba(255,255,255,0.1); color: #94a3b8; }
        `;
        document.head.appendChild(style);
    }

    // Detect if current page is a direct image URL (e.g., .png/.jpg on main domain)
    function isDirectImagePage() {
        return isMainDomain && /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(window.location.pathname);
    }

    function createImagePanel() {
        // Allow both img.examtopics.com AND direct image pages on www.examtopics.com
        if (!isImageDomain && !isDirectImagePage()) return;

        const parsed = parseImageUrl(currentUrl);
        if (!parsed) return;

        injectImageStyle();

        // Generate predictions
        const predictions = PredictionStrategy.predictAll(parsed);
        const isDD = isDragDropImage(parsed);

        // Build prediction section HTML
        let predictSectionHtml = '';
        const allPreds = [
            ...predictions.dragDrop.map(p => ({ ...p, category: 'DRAG DROP' })),
            ...predictions.sameBase.map(p => ({ ...p, category: 'Same Base' })),
            ...predictions.previous.map(p => ({ ...p, category: 'Previous' })),
        ];

        if (allPreds.length > 0) {
            const predRows = allPreds.map(p => {
                const filename = p.url.split('/').pop();
                return `
                    <div class="et-predict-row">
                        <span class="et-p-label">${p.label}</span>
                        <a class="et-p-url" href="${p.url}" target="_blank" title="${p.url}">${filename}</a>
                        <span class="et-p-badge ${p.confidence}">${p.confidence}</span>
                    </div>
                `;
            }).join('');

            predictSectionHtml = `
                <div class="et-predict-section">
                    <div class="et-predict-title">${isDD ? '🔀 DRAG DROP Predictions:' : '🔗 Image Predictions:'}</div>
                    ${predRows}
                </div>
            `;
        }

        // Status section
        let statusSectionHtml = '';
        let controlSectionHtml = '';
        let autoTargetSettingHtml = '';

        if (parsed.format !== 'short_seq') {
            const nextUrl = buildImageUrl(parsed, { variant: parsed.variant + 1 });
            const prevUrl = parsed.variant > 0 ? buildImageUrl(parsed, { variant: parsed.variant - 1 }) : null;
            const nextName = nextUrl ? nextUrl.split('/').pop() : 'N/A';
            const prevName = prevUrl ? prevUrl.split('/').pop() : 'N/A';

            statusSectionHtml = `
                <div class="et-status-row">
                    <span class="et-label">Current:</span>
                    <span class="et-value" title="${currentUrl}">${currentUrl.split('/').pop().split(/[?#]/)[0]}</span>
                </div>
                <div class="et-status-row">
                    <span class="et-label">Base ID:</span>
                    <span class="et-value">${parsed.basePrefix}${parsed.baseId}</span>
                </div>
                <div class="et-status-row">
                    <span class="et-label">Variant:</span>
                    <span class="et-value">${parsed.variant} ${isDD ? '🔀' : ''}</span>
                </div>
                <div class="et-status-row">
                    <span class="et-label">Prev:</span>
                    <span class="et-value" style="font-size: 10px;">${prevName}</span>
                </div>
                <div class="et-status-row">
                    <span class="et-label">Next:</span>
                    <span class="et-value" style="font-size: 10px;">${nextName}</span>
                </div>
            `;

            controlSectionHtml = `
                <div class="et-controls" style="margin-bottom: 12px;">
                    <button id="et-btn-prev" class="et-btn" title="Previous Variant [A]">&larr; Prev</button>
                    <button id="et-btn-next" class="et-btn" title="Next Variant [D]">Next &rarr;</button>
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
                <span class="et-title">ExamTopics Helper v4.0</span>
                <button id="et-btn-close" title="Close Panel">×</button>
            </div>
            <div class="et-status-section">
                ${statusSectionHtml}
            </div>
            ${predictSectionHtml}
            <div class="et-settings-row">
                <span>Navigation Target:</span>
                <button id="et-btn-mode" class="et-btn" style="padding: 2px 6px; font-size: 11px; flex: initial;"></button>
            </div>
            <div class="et-progress-container" id="et-progress-container" style="display: none;">
                <div class="et-progress-bar" id="et-progress-bar"></div>
                <span class="et-progress-text" id="et-progress-text">Opening next in 1.5s</span>
            </div>
            ${controlSectionHtml}
            <div class="et-controls" style="margin-top: 10px;">
                <button id="et-btn-copy" class="et-btn" title="Copy Current Link [C]">📋 Copy</button>
                <button id="et-btn-copy-answer" class="et-btn et-btn-predict" title="Copy Predicted Answer Link">🎯 Copy Answer</button>
                <button id="et-btn-auto" class="et-btn et-btn-primary" style="flex: 1.2;" title="Toggle Auto-Open [S]">Auto: OFF</button>
            </div>
            <div class="et-footer" id="et-footer-tips">
                Keys: [A] Prev | [D] Next | [S] Auto | [C] Copy | [P] Predict
            </div>
        `;
        document.documentElement.appendChild(panel);

        function updateSettingsUi() {
            const modeBtn = document.getElementById('et-btn-mode');
            if (modeBtn) modeBtn.innerText = tabMode === 'new_tab' ? 'New Tab' : 'Same Tab';
            const tips = document.getElementById('et-footer-tips');
            if (tips) tips.innerHTML = 'Keys: [A] Prev | [D] Next | [S] Auto | [C] Copy | [P] Predict';
        }
        updateSettingsUi();

        function startAutoAdvance() {
            const nextUrl = parsed.format !== 'short_seq'
                ? buildImageUrl(parsed, { variant: parsed.variant + 1 })
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
                        openWith404Check(targetUrl);
                        stopAutoAdvance();
                    } else {
                        window.location.href = nextUrl;
                    }
                }
            }, intervalStep);
        }

        function stopAutoAdvance() {
            if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
            const progressContainer = document.getElementById('et-progress-container');
            if (progressContainer) progressContainer.style.display = 'none';
            const autoBtn = document.getElementById('et-btn-auto');
            if (autoBtn) { autoBtn.innerText = 'Auto: OFF'; autoBtn.classList.remove('et-btn-active'); }
        }

        function toggleAuto() {
            isAutoEnabled = !isAutoEnabled;
            GM_setValue('et_auto_enabled', isAutoEnabled);
            const autoBtn = document.getElementById('et-btn-auto');
            if (isAutoEnabled) {
                if (autoBtn) { autoBtn.innerText = 'Auto: ON'; autoBtn.classList.add('et-btn-active'); }
                startAutoAdvance();
            } else {
                stopAutoAdvance();
            }
        }

        function navigate(direction) {
            if (parsed.format !== 'short_seq') {
                const delta = direction === 'next' ? 1 : -1;
                const tryNavigate = (variantOffset) => {
                    const newVariant = Math.max(0, parsed.variant + variantOffset);
                    const url = buildImageUrl(parsed, { variant: newVariant });
                    if (!url) return;
                    stopAutoAdvance();
                    if (tabMode === 'new_tab') {
                        openWith404Check(url, () => {
                            // 404 → try next variant in same direction
                            const nextOffset = variantOffset + delta;
                            if (Math.abs(nextOffset) <= 5) tryNavigate(nextOffset);
                        });
                    } else {
                        window.location.href = url;
                    }
                };
                tryNavigate(delta);
            } else {
                const url = getAdjacentUrl(currentUrl, direction);
                if (url) {
                    stopAutoAdvance();
                    if (tabMode === 'new_tab') {
                        openWith404Check(url);
                    } else {
                        window.location.href = url;
                    }
                }
            }
        }

        function copyAnswerLink() {
            if (predictions.dragDrop.length > 0) {
                copyToClipboard(predictions.dragDrop[0].url);
                showToast(`🎯 Copied predicted answer: ${predictions.dragDrop[0].url.split('/').pop()}`);
            } else if (predictions.sameBase.length > 0) {
                copyToClipboard(predictions.sameBase[0].url);
                showToast(`📎 Copied next variant: ${predictions.sameBase[0].url.split('/').pop()}`);
            } else {
                showToast('⚠️ No predictions available.');
            }
        }

        // Event listeners
        document.getElementById('et-btn-prev').onclick = () => navigate('prev');
        document.getElementById('et-btn-next').onclick = () => navigate('next');

        document.getElementById('et-btn-copy').onclick = () => {
            copyCleanLink(currentUrl);
            const btn = document.getElementById('et-btn-copy');
            btn.innerHTML = '✅ Copied!';
            btn.style.background = '#22c55e';
            btn.style.borderColor = '#22c55e';
            setTimeout(() => { btn.innerHTML = '📋 Copy'; btn.style.background = ''; btn.style.borderColor = ''; }, 1500);
        };

        document.getElementById('et-btn-copy-answer').onclick = () => copyAnswerLink();

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

        // Auto-start
        const hash = window.location.hash;
        const isChain = hash.includes('autochain=true');
        if (isAutoEnabled || isChain) {
            if (isChain && !isAutoEnabled) {
                isAutoEnabled = true;
                GM_setValue('et_auto_enabled', true);
            }
            const autoBtn = document.getElementById('et-btn-auto');
            if (autoBtn) { autoBtn.innerText = 'Auto: ON'; autoBtn.classList.add('et-btn-active'); }
            startAutoAdvance();
        }
    }

    // =============================================
    // 10. GLOBAL EVENT LISTENERS
    // =============================================
    function setupEventListeners() {
        document.addEventListener('paste', (e) => {
            const activeEl = document.activeElement;
            const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);
            if (isInput) {
                let pastedText = (e.clipboardData || window.clipboardData).getData('text')?.trim();
                if (pastedText) processAndOpenPastedLink(pastedText);
            }
        });

        document.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            const activeEl = document.activeElement;
            const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);

            const isMacShortcut = e.metaKey && e.ctrlKey && key === 'v';
            const isAltV = e.altKey && key === 'v';
            if (isMacShortcut || isAltV) {
                e.preventDefault();
                navigator.clipboard.readText().then(text => processAndOpenPastedLink(text)).catch(() => {});
                return;
            }

            if (isInput) return;
            if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

            if (isMainDomain) {
                if (key === 'a' || key === 'arrowleft') {
                    const prevLink = getPageNavigationLink('prev');
                    if (prevLink) { prevLink.click(); showToast('Navigating to previous question...'); }
                } else if (key === 'd' || key === 'arrowright') {
                    const nextLink = getPageNavigationLink('next');
                    if (nextLink) { nextLink.click(); showToast('Navigating to next question...'); }
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
                        showToast(`Opened ${openBtns.length} images!`);
                    } else {
                        showToast('No images found.');
                    }
                } else if (key === 'p') {
                    const predBtn = document.getElementById('et-open-all-predicted');
                    if (predBtn) predBtn.click();
                }
            }

            if (isImageDomain || isDirectImagePage()) {
                if (key === 'a') navigateImage('prev');
                else if (key === 'd') navigateImage('next');
                else if (key === 's') triggerAutoToggle();
                else if (key === 'c') triggerCopyLink();
                else if (key === 'p') copyAnswerLinkFromKey();
            }
        });
    }

    function navigateImage(direction) {
        const btnId = direction === 'next' ? 'et-btn-next' : 'et-btn-prev';
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

    function copyAnswerLinkFromKey() {
        const btn = document.getElementById('et-btn-copy-answer');
        if (btn) btn.click();
    }

    // =============================================
    // 11. MAIN INITIALIZATION
    // =============================================
    function main() {
        if (isMainDomain) {
            if (window.location.pathname.includes('/discussions/') || window.location.pathname.includes('/exams/')) {
                revealAnswers();
                const data = extractQuestionData();
                createMainPanel(data);
                if (data.correctAnswers.length > 0) {
                    showToast(`🔓 Đáp án câu ${data.questionNum}: ${data.correctAnswers.join(', ')}`);
                } else {
                    showToast(`⚠️ Câu ${data.questionNum}: Đáp án ẩn sau paywall`);
                }
                console.log('[ET Helper v4.0] Question Data:', data);
            }
        } else if (isImageDomain) {
            createImagePanel();
        }
        // Also show image panel when navigating directly to an image URL on main domain
        if (isMainDomain && isDirectImagePage()) {
            createImagePanel();
        }
        setupEventListeners();
    }

    function waitAndRun() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => setTimeout(main, 800));
        } else {
            setTimeout(main, 800);
        }
    }

    waitAndRun();
})();
