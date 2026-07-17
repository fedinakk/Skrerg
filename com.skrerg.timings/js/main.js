/*
 * main.js — логика панели Skrerg Timings.
 * Запрашивает у Premiere тайминги выделенных ВИДЕОклипов, отображает их,
 * копирует в компактном формате и расставляет маркеры на таймлайне.
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
        markerInput: document.getElementById("markerInput"),
        markerBtn: document.getElementById("markerBtn"),
        markerHint: document.getElementById("markerHint"),
        withRazor: document.getElementById("withRazor"),
        asmInput: document.getElementById("asmInput"),
        asmStart: document.getElementById("asmStart"),
        asmGap: document.getElementById("asmGap"),
        asmAudio: document.getElementById("asmAudio"),
        asmBtn: document.getElementById("asmBtn"),
        asmHint: document.getElementById("asmHint")
    };

    var TC_RE = /\d{1,2}:\d{1,2}:\d{1,2}:\d{1,3}/g;

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
            empty.textContent = "Нет выделенных видеоклипов.\nВыделите фрагменты на таймлайне и нажмите «Обновить».";
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
        addRow(rows, "Вход (источник)", toTimecode(clip.inSec, fps));
        addRow(rows, "Выход (источник)", toTimecode(clip.outSec, fps));
        addRow(rows, "Длительность", toTimecode(clip.durSec, fps));
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

    // ---- Копирование (компактный формат) -----------------------------------
    // Формат: "in - out + in - out + ..." для всех выделенных клипов.

    function buildClipboardText() {
        var clips = lastData.clips || [];
        var fps = lastData.fps;
        var parts = [];
        for (var i = 0; i < clips.length; i++) {
            var c = clips[i];
            parts.push(toTimecode(c.inSec, fps) + " - " + toTimecode(c.outSec, fps));
        }
        return parts.join(" + ");
    }

    function copyToClipboard() {
        var text = buildClipboardText();
        if (!text) {
            flashHint(els.copyHint, "Нет данных для копирования");
            return;
        }
        writeClipboard(text, function (ok) {
            flashHint(els.copyHint, ok ? "Скопировано" : "Не удалось скопировать");
        });
    }

    // Универсальная запись в буфер: execCommand + резерв через Clipboard API.
    function writeClipboard(text, done) {
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

        if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                done(true);
            }, function () {
                done(false);
            });
            return;
        }
        done(ok);
    }

    // ---- Расстановка маркеров -----------------------------------------------
    // Из введённого текста извлекаются ВСЕ таймкоды HH:MM:SS:FF, и на каждой
    // позиции (относительно таймлайна) ставится одиночный маркер.

    function placeMarkers() {
        var text = els.markerInput.value || "";
        var timecodes = text.match(/\d{1,2}:\d{1,2}:\d{1,2}:\d{1,3}/g) || [];

        if (timecodes.length === 0) {
            flashHint(els.markerHint, "Не найдено таймкодов формата 00:00:00:00");
            return;
        }

        var withRazor = !!els.withRazor.checked;
        var arg = JSON.stringify(timecodes);
        var script = "placeTimelineMarkers(" + JSON.stringify(arg) + ", " + withRazor + ")";

        cs.evalScript(script, function (res) {
            var data;
            try {
                data = JSON.parse(res);
            } catch (e) {
                flashHint(els.markerHint, "Ошибка выполнения скрипта");
                return;
            }
            if (!data.ok) {
                flashHint(els.markerHint, data.error || "Не удалось расставить маркеры");
                return;
            }
            var msg = "Поставлено маркеров: " + data.created;
            if (withRazor) {
                msg += " · надрезов: " + data.cuts;
            }
            flashHint(els.markerHint, msg);
        });
    }

    function flashHint(el, msg) {
        el.textContent = msg;
        setTimeout(function () {
            el.textContent = "";
        }, 2500);
    }

    // ---- Пересборка фрагментов в конец дорожки ------------------------------
    // Каждая строка ввода — группа. Таймкоды в строке разбиваются на пары
    // [вход, выход]. Внутри группы сегменты стыкуются, между группами — пауза.

    function parseGroups(text) {
        var lines = String(text).split(/\r?\n/);
        var groups = [];
        for (var i = 0; i < lines.length; i++) {
            var tcs = lines[i].match(TC_RE);
            if (!tcs || tcs.length < 2) continue;
            var segs = [];
            for (var j = 0; j + 1 < tcs.length; j += 2) {
                segs.push([tcs[j], tcs[j + 1]]);
            }
            if (segs.length) groups.push(segs);
        }
        return groups;
    }

    function assemble() {
        var groups = parseGroups(els.asmInput.value || "");
        if (groups.length === 0) {
            flashHint(els.asmHint, "Не найдено пар таймкодов (мин. вход и выход в строке)");
            return;
        }

        var withAudio = !!els.asmAudio.checked;
        var startTc = (els.asmStart.value || "00:30:00:00").trim();
        var gap = parseFloat(els.asmGap.value);
        if (isNaN(gap) || gap < 0) gap = 0;

        var script = "assembleFragments(" +
            JSON.stringify(JSON.stringify(groups)) + ", " +
            withAudio + ", " +
            JSON.stringify(startTc) + ", " +
            gap + ")";

        cs.evalScript(script, function (res) {
            var data;
            try {
                data = JSON.parse(res);
            } catch (e) {
                flashHint(els.asmHint, "Ошибка выполнения скрипта");
                return;
            }
            if (!data.ok) {
                flashHint(els.asmHint, data.error || "Не удалось собрать фрагменты");
                return;
            }
            flashHint(els.asmHint,
                "Групп: " + data.groups + " · вставлено фрагментов: " + data.placed);
        });
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
    els.markerBtn.addEventListener("click", placeMarkers);
    els.asmBtn.addEventListener("click", assemble);
    els.autoRefresh.addEventListener("change", function () {
        setAutoRefresh(els.autoRefresh.checked);
    });

    refresh();
})();
