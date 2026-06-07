// ==UserScript==
// @name         ExamTopics - Copy & Open Exam
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Adds a button next to each exam link to copy the title and open the link in a new tab (auto-closes after 10s)
// @author       You
// @match        https://www.examtopics.com/exams/*/
// @exclude      https://www.examtopics.com/exams/*/*/view/*
// @updateURL    https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/ExamTopics%20-%20Copy%20&%20Open%20Exam.js
// @downloadURL  https://raw.githubusercontent.com/112516101106/js-scripts/refs/heads/main/ExamTopics%20-%20Copy%20&%20Open%20Exam.js
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── Inject styles ──
  const style = document.createElement('style');
  style.textContent = `
    .et-copy-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 8px;
      padding: 3px 10px;
      font-size: 12px;
      font-weight: 600;
      color: #fff;
      background: linear-gradient(135deg, #007bff, #0056d2);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s ease;
      vertical-align: middle;
      line-height: 1.4;
      box-shadow: 0 1px 3px rgba(0,123,255,0.3);
      white-space: nowrap;
    }
    .et-copy-btn:hover {
      background: linear-gradient(135deg, #0056d2, #003f9e);
      box-shadow: 0 2px 6px rgba(0,123,255,0.45);
      transform: translateY(-1px);
    }
    .et-copy-btn:active {
      transform: translateY(0);
      box-shadow: 0 1px 2px rgba(0,123,255,0.2);
    }
    .et-copy-btn.et-copied {
      background: linear-gradient(135deg, #28a745, #1e7e34);
      box-shadow: 0 1px 3px rgba(40,167,69,0.3);
    }
  `;
  document.head.appendChild(style);

  // ── Track opened tabs for auto-close ──
  const openedTabs = [];

  // ── Find all exam links ──
  const examLinks = document.querySelectorAll('a.popular-exam-link');

  examLinks.forEach((link) => {
    const btn = document.createElement('button');
    btn.className = 'et-copy-btn';
    btn.textContent = '📋 Copy & Open';
    btn.title = 'Copy exam title → clipboard, open link in new tab (auto-close after 10s)';

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // ── 1. Copy exam title ──
      const titleText = link.textContent.trim();
      GM_setClipboard(titleText, 'text');

      // ── 2. Visual feedback ──
      btn.textContent = '✅ Copied!';
      btn.classList.add('et-copied');
      setTimeout(() => {
        btn.textContent = '📋 Copy & Open';
        btn.classList.remove('et-copied');
      }, 2000);

      // ── 3. Open in new tab & schedule auto-close ──
      const examUrl = link.href;
      const newWin = window.open(examUrl, '_blank');

      if (newWin) {
        openedTabs.push(newWin);
        setTimeout(() => {
          try {
            newWin.close();
          } catch (err) {
            console.warn('[ET Copier] Could not auto-close tab (cross-origin):', err.message);
          }
        }, 10000); // 10 seconds
      } else {
        console.warn('[ET Copier] Popup blocked. Please allow popups for examtopics.com');
      }
    });

    // Insert button after the link
    link.parentNode.insertBefore(btn, link.nextSibling);
  });

  console.log(`[ET Copier] Injected ${examLinks.length} copy buttons`);
})();
