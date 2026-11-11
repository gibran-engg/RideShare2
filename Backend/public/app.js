// Small progressive enhancements. Every page works without JavaScript.
(function () {
    "use strict";

    // Confirm destructive actions: <form data-confirm="Cancel this ride?">
    document.addEventListener("submit", function (event) {
        var form = event.target;
        var message = form.getAttribute("data-confirm");
        if (message && !window.confirm(message)) {
            event.preventDefault();
            return;
        }
        var button = form.querySelector("button[type=submit]");
        if (button) {
            // Prevent double submits while the request is in flight.
            setTimeout(function () { button.disabled = true; }, 0);
        }
    });

    // <select data-autosubmit> submits its form on change.
    document.addEventListener("change", function (event) {
        if (event.target.matches("select[data-autosubmit]")) {
            event.target.form.requestSubmit();
        }
    });

    // Live updates: the server sends "refresh" when this user's rides or requests change.
    var liveUrl = document.body.getAttribute("data-live");
    if (liveUrl && "EventSource" in window) {
        var pendingReload = false;
        var isTyping = function () {
            var el = document.activeElement;
            return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && el.value;
        };
        var reload = function () {
            if (isTyping()) {
                pendingReload = true;
                return;
            }
            window.location.reload();
        };
        document.addEventListener("focusout", function () {
            if (pendingReload) setTimeout(reload, 50);
        });

        var source = new EventSource(liveUrl);
        source.addEventListener("refresh", reload);
        source.addEventListener("signed-out", function () {
            window.location.href = "/login";
        });
        var indicator = document.querySelector("[data-live-indicator]");
        source.onopen = function () { if (indicator) indicator.classList.add("on"); };
        source.onerror = function () { if (indicator) indicator.classList.remove("on"); };
    }
})();
