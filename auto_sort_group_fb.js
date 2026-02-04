// ==UserScript==
// @name         Auto Sort
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Quét liên tục mỗi 500ms để ép chuyển hướng sang Chronological
// @author
// @match        https://www.facebook.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=facebook.com
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const targetPath = "/groups";
    const sortParam = "sorting_setting=CHRONOLOGICAL";

    function forceRedirect() {
        const currentUrl = window.location.href;

        if (currentUrl.includes(targetPath)) {

            const isDetailedPage = currentUrl.includes("/posts/") ||
                currentUrl.includes("/user/") ||
                currentUrl.includes("/permalink/") ||
                currentUrl.includes("/comment/");

            if (!currentUrl.includes(sortParam) && !isDetailedPage) {
                const separator = currentUrl.includes("?") ? "&" : "?";
                const newUrl = currentUrl + separator + sortParam;

                window.location.href = newUrl;
            }
        }
    }

    setInterval(forceRedirect, 500);

})();