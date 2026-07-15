/*
 * main.js — логика панели Skrerg Timings.
 * Запрашивает у Premiere тайминги выделенных клипов, отображает их и
 * позволяет скопировать в буфер обмена.
 */
(function () {
    "use strict";

    var cs = new CSInterface();

    var els = {
        list: document.getElementById("list"),
        status: document.getElementById("status"),
        refreshBtn: document.getElementById("refreshBtn"),
        copyBtn: document.getElementById("copyBtn"),
        copyHint: document.getElementById("copyHint"),
        autoRefresh: document.getElementById("autoRefresh"),
        showTimecode: document.getElementById("showTimecode"),
        showSeconds: document.getElementById("showSeconds"),
        showTimeline: document.getElementById("showTimeline")
    };

    var lastData = { clips: [], fps: 0, sequence: "" };
    var autoTimer = null;

    // ---- Форматирование времени --------------------------------------------

    // Переводит секунды в таймкод HH:MM:SS:FF при заданной частоте кадров.
    function toTimecode(seconds, fps) {
        if (!fps || fps <= 0) return "--:--:--:--";
        var rounded = Math.round(fps);
        var totalFrames = Math.round(seconds * fps);
        var frames = totalFrames % rounded;
        var totalSeconds = Math.floor(totalFrames / rounded);
        var s = totalSeconds % 60;
        var m = Math.floor(totalSeconds / 60) % 60;
        var h = Math.floor(totalSeconds / 3600);
        return pad(h) + ":" + pad(m) + ":" + pad(s) + ":" + pad(frames);
    }

    function toSeconds(seconds) {
        return Number(seconds).toFixed(3) + " с";
    }

    function pad(n) {
        n = Math.abs(n);
        return n < 10 ? "0" + n : "" + n;
    }

    // ---- Запрос данных из Premiere -----------------------------------------

    function refresh() {
        cs.evalScript("getSelectedClipTimings()", function (res) {
            var data;
            try {
                data = JSON.parse(res);
            } catch (e) {
                setStatus("Не удалось получить данные из Premiere.");
                return;
            }

            if (!data.ok) {
                lastData = { clips: [], fps: 0, sequence: "" };
                render();
                setStatus(data.error || "Ошибка.");
                els.copyBtn.disabled = true;
                return;
            }

            lastData = data;
            render();
            var n = data.clips.length;
            setStatus(
                (data.sequence ? "Секвенция: " + data.sequence + " · " : "") +
                (data.fps ? data.fps.toFixed(2) + " fps · " : "") +
                "выделено: " + n
            );
            els.copyBtn.disabled = n === 0;
        });
    }

    function setStatus(text) {
        els.status.textContent = text || "";
    }

    // ---- Рендеринг ----------------------------------------------------------

    function render() {
        var clips = lastData.clips || [];
        var fps = lastData.fps;
        els.list.innerHTML = "";

        if (clips.length === 0) {
            var empty = document.createElement("div");
            empty.className = "empty";
            empty.textContent = "Нет выделенных клипов.\nВыделите фрагменты на таймлайне и нажмите «Обновить».";
            els.list.appendChild(empty);
            return;
        }

        for (var i = 0; i < clips.length; i++) {
            els.list.appendChild(buildClipCard(clips[i], fps));
        }
    }

    function buildClipCard(clip, fps) {
        var card = document.createElement("div");
        card.className = "clip";

        var head = document.createElement("div");
        head.className = "clip-head";

        var name = document.createElement("div");
        name.className = "clip-name";
        name.textContent = clip.source || clip.name;

        var track = document.createElement("div");
        track.className = "clip-track";
        track.textContent = clip.track;

        head.appendChild(name);
        head.appendChild(track);
        card.appendChild(head);

        var rows = document.createElement("div");
        rows.className = "rows";

        // Тайминги относительно исходного клипа.
        addRow(rows, "Вход (источник)", formatValue(clip.inSec, fps));
        addRow(rows, "Выход (источник)", formatValue(clip.outSec, fps));
        addRow(rows, "Длительность", formatValue(clip.durSec, fps));

        // Опционально — положение на таймлайне.
        if (els.showTimeline.checked) {
            addRow(rows, "Начало (таймлайн)", formatValue(clip.startSec, fps));
            addRow(rows, "Конец (таймлайн)", formatValue(clip.endSec, fps));
        }

        card.appendChild(rows);
        return card;
    }

    function addRow(container, key, value) {
        var k = document.createElement("div");
        k.className = "k";
        k.textContent = key;
        var v = document.createElement("div");
        v.className = "v";
        v.textContent = value;
        container.appendChild(k);
        container.appendChild(v);
    }

    // Собирает строку значения из включённых форматов (таймкод / секунды).
    function formatValue(seconds, fps) {
        var parts = [];
        if (els.showTimecode.checked) parts.push(toTimecode(seconds, fps));
        if (els.showSeconds.checked) parts.push(toSeconds(seconds));
        if (parts.length === 0) parts.push(toTimecode(seconds, fps));
        return parts.join("  ·  ");
    }

    // ---- Копирование --------------------------------------------------------

    function buildClipboardText() {
        var clips = lastData.clips || [];
        var fps = lastData.fps;
        var lines = [];

        if (lastData.sequence) {
            lines.push("Секвенция: " + lastData.sequence);
        }
        if (fps) {
            lines.push("Частота кадров: " + fps.toFixed(2) + " fps");
        }
        lines.push("");

        for (var i = 0; i < clips.length; i++) {
            var c = clips[i];
            lines.push((i + 1) + ". " + (c.source || c.name) + "  [" + c.track + "]");
            lines.push("   Вход (источник):  " + formatValue(c.inSec, fps));
            lines.push("   Выход (источник): " + formatValue(c.outSec, fps));
            lines.push("   Длительность:     " + formatValue(c.durSec, fps));
            if (els.showTimeline.checked) {
                lines.push("   Начало (таймлайн): " + formatValue(c.startSec, fps));
                lines.push("   Конец (таймлайн):  " + formatValue(c.endSec, fps));
            }
            lines.push("");
        }

        return lines.join("\n").replace(/\n+$/, "\n");
    }

    function copyToClipboard() {
        var text = buildClipboardText();
        var ta = document.getElementById("hiddenCopy");
        if (!ta) {
            ta = document.createElement("textarea");
            ta.id = "hiddenCopy";
            document.body.appendChild(ta);
        }
        ta.value = text;
        ta.select();
        ta.setSelectionRange(0, text.length);

        var ok = false;
        try {
            ok = document.execCommand("copy");
        } catch (e) {
            ok = false;
        }

        // Резервный путь через асинхронный Clipboard API, если доступен.
        if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                flashCopyHint("Скопировано");
            }, function () {
                flashCopyHint("Не удалось скопировать");
            });
            return;
        }

        flashCopyHint(ok ? "Скопировано" : "Не удалось скопировать");
    }

    function flashCopyHint(msg) {
        els.copyHint.textContent = msg;
        setTimeout(function () {
            els.copyHint.textContent = "";
        }, 1800);
    }

    // ---- Авто-обновление ----------------------------------------------------

    function setAutoRefresh(on) {
        if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
        }
        if (on) {
            autoTimer = setInterval(refresh, 1000);
        }
    }

    // ---- Инициализация ------------------------------------------------------

    els.refreshBtn.addEventListener("click", refresh);
    els.copyBtn.addEventListener("click", copyToClipboard);
    els.autoRefresh.addEventListener("change", function () {
        setAutoRefresh(els.autoRefresh.checked);
    });
    els.showTimecode.addEventListener("change", render);
    els.showSeconds.addEventListener("change", render);
    els.showTimeline.addEventListener("change", render);

    refresh();
})();
