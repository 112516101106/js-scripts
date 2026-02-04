// ==UserScript==
// @name         Bỏ qua giới thiệu rophim
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       You
// @match        https://*.rophim.la/*
// @match        https://rophim.la/*
// @match        *://*.rophim.*/*
// @match        *://rophim.*/*
// @include      /^https?:\/\/(www\.)?rophim\..*\/.*$/
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Log ngay khi script được nạp để biết script có chạy không
    console.log('[AutoSkip] Script đã load! Chuẩn bị khởi chạy...');

    const SELECTOR = '.item.item-auto.toggle-basic-label';
    const LABEL_TEXT = 'Bỏ qua giới thiệu';
    const RETRY_DELAY = 1000; // 1 giây
    const MAX_RETRIES = 15; // Tăng số lần thử lên chút

    let retryCount = 0;

    function enableSkipIntro() {
        // Tìm button, hỗ trợ cả trường hợp shadow DOM nếu có (dù rophim có vẻ không dùng)
        const items = document.querySelectorAll(SELECTOR);
        let found = false;

        items.forEach(item => {
            if (item.textContent.includes(LABEL_TEXT)) {
                found = true;

                // Nếu item đã được xử lý (đã reset) thì bỏ qua
                if (item.dataset.autoSkipHandled) return;

                if (!item.classList.contains('is-on')) {
                    console.log('[AutoSkip] Nút đang OFF. Click để BẬT...');
                    item.click();
                    item.dataset.autoSkipHandled = 'true';
                } else {
                    console.log('[AutoSkip] Nút đang ON. Thực hiện Reset (OFF -> ON) để đảm bảo hoạt động.');

                    // Click lần 1: Tắt
                    item.click();

                    // Chờ 500ms rồi bật lại
                    setTimeout(() => {
                        console.log('[AutoSkip] Đang bật lại sau khi reset...');
                        item.click();
                        // Gán cờ handled để không lặp lại
                        item.dataset.autoSkipHandled = 'true';
                    }, 500);
                }
            }
        });

        return found;
    }

    // Hàm khởi chạy
    function init() {
        console.log('[AutoSkip] Chờ 5s để trang ổn định (Firefox/Chrome)...');
        setTimeout(() => {
            console.log('[AutoSkip] Bắt đầu quét nút sau delay...');

            // Quét ngay lập tức lần đầu
            enableSkipIntro();

            const interval = setInterval(() => {
                const found = enableSkipIntro();
                retryCount++;

                if (retryCount >= MAX_RETRIES) {
                    clearInterval(interval);
                    console.log('[AutoSkip] Dừng quét.');
                }
            }, RETRY_DELAY);
        }, 5000);
    }

    // Vì đã dùng @run-at document-idle, ta có thể chạy init ngay
    init();
})();
