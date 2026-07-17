/*
 * host.jsx — ExtendScript-часть панели Skrerg Timings.
 * Собирает тайминги выделенных клипов в активной секвенции и возвращает JSON.
 *
 * Для каждого выделенного клипа возвращаются его in/out ТОЧКИ ИСТОЧНИКА —
 * то есть тайминги относительно исходного клипа (медиафайла), из которого
 * фрагмент был вырезан, а также положение фрагмента на таймлайне.
 */

// Количество тиков в одной секунде во внутреннем времени Premiere Pro.
var TICKS_PER_SECOND = 254016000000;

/**
 * Возвращает JSON-строку с таймингами всех выделенных клипов.
 */
function getSelectedClipTimings() {
    var result = {
        ok: false,
        error: "",
        sequence: "",
        fps: 0,
        clips: []
    };

    try {
        if (!app.project) {
            result.error = "Нет открытого проекта.";
            return JSON.stringify(result);
        }

        var seq = app.project.activeSequence;
        if (!seq) {
            result.error = "Нет активной секвенции. Откройте секвенцию и выделите клипы.";
            return JSON.stringify(result);
        }

        result.sequence = seq.name;

        // Частота кадров секвенции = тики в секунду / тики на кадр.
        var timebase = Number(seq.timebase);
        var fps = timebase > 0 ? (TICKS_PER_SECOND / timebase) : 0;
        result.fps = fps;

        // Учитываем только видеосоставляющую — аудиодорожки пропускаем.
        collectFromTracks(seq.videoTracks, "V", result.clips);

        result.ok = true;
    } catch (e) {
        result.error = "Ошибка: " + e.toString();
    }

    return JSON.stringify(result);
}

/**
 * Перебирает клипы во всех дорожках коллекции и добавляет выделенные в out.
 */
function collectFromTracks(tracks, kind, out) {
    for (var t = 0; t < tracks.numTracks; t++) {
        var track = tracks[t];
        for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            if (clip && clip.isSelected && clip.isSelected()) {
                out.push(describeClip(clip, kind + (t + 1)));
            }
        }
    }
}

/**
 * Описывает один клип: имя источника, in/out источника, положение на таймлайне.
 */
function describeClip(clip, trackLabel) {
    var item = {
        name: safeStr(clip.name),
        source: safeStr(clip.name),
        track: trackLabel,
        // Тайминги относительно исходного клипа (медиа), из которого взят фрагмент:
        inSec: timeSeconds(clip.inPoint),
        outSec: timeSeconds(clip.outPoint),
        durSec: timeSeconds(clip.duration),
        // Положение фрагмента на таймлайне секвенции:
        startSec: timeSeconds(clip.start),
        endSec: timeSeconds(clip.end)
    };

    try {
        if (clip.projectItem && clip.projectItem.name) {
            item.source = safeStr(clip.projectItem.name);
        }
    } catch (e) {}

    return item;
}

/**
 * Безопасно извлекает .seconds из Time-объекта Premiere.
 */
function timeSeconds(timeObj) {
    try {
        if (timeObj === undefined || timeObj === null) return 0;
        return Number(timeObj.seconds);
    } catch (e) {
        return 0;
    }
}

function safeStr(v) {
    try {
        return String(v);
    } catch (e) {
        return "";
    }
}

/**
 * Ставит одиночные маркеры на таймлайне активной секвенции и, опционально,
 * делает надрезы (razor) на всех дорожках в этих же позициях.
 * @param {string} timecodesJson — JSON-массив таймкодов вида "HH:MM:SS:FF".
 *   Каждый таймкод трактуется как позиция НА ТАЙМЛАЙНЕ (от начала секвенции).
 * @param {boolean} withRazor — если true, в каждой позиции добавляется надрез.
 * @return {string} JSON: { ok, error, created, cuts }.
 */
function placeTimelineMarkers(timecodesJson, withRazor) {
    var result = { ok: false, error: "", created: 0, cuts: 0 };

    try {
        var seq = app.project.activeSequence;
        if (!seq) {
            result.error = "Нет активной секвенции.";
            return JSON.stringify(result);
        }

        var timecodes = JSON.parse(timecodesJson);
        var timebase = Number(seq.timebase);
        var fps = timebase > 0 ? (TICKS_PER_SECOND / timebase) : 0;

        // Для надрезов нужен QE-DOM — включаем его только по запросу.
        var qeSeq = null;
        if (withRazor) {
            try {
                app.enableQE();
                qeSeq = qe.project.getActiveSequence();
            } catch (e) {
                result.error = "Не удалось включить QE для надрезов: " + e.toString();
            }
        }

        var count = 0;
        var cuts = 0;
        for (var i = 0; i < timecodes.length; i++) {
            var tc = parseTimecode(timecodes[i]);
            if (tc === null) continue;

            var sec = tc.h * 3600 + tc.m * 60 + tc.s + (fps > 0 ? tc.f / fps : 0);

            // Одиночный маркер без имени/комментария/длительности.
            seq.markers.createMarker(sec);
            count++;

            if (qeSeq) {
                var tcStr = pad2(tc.h) + ":" + pad2(tc.m) + ":" + pad2(tc.s) + ":" + pad2(tc.f);
                if (razorAllTracks(qeSeq, tcStr)) {
                    cuts++;
                }
            }
        }

        result.created = count;
        result.cuts = cuts;
        result.ok = true;
    } catch (e) {
        result.error = "Ошибка: " + e.toString();
    }

    return JSON.stringify(result);
}

/**
 * Делает надрез на всех видео- и аудиодорожках в позиции tcStr (таймкод).
 * @return {boolean} true, если надрез применён хотя бы к одной дорожке.
 */
function razorAllTracks(qeSeq, tcStr) {
    var did = false;
    try {
        var nv = qeSeq.numVideoTracks;
        for (var i = 0; i < nv; i++) {
            var vt = qeSeq.getVideoTrackAt(i);
            if (vt) { vt.razor(tcStr); did = true; }
        }
        var na = qeSeq.numAudioTracks;
        for (var j = 0; j < na; j++) {
            var at = qeSeq.getAudioTrackAt(j);
            if (at) { at.razor(tcStr); did = true; }
        }
    } catch (e) {}
    return did;
}

/**
 * Разбирает таймкод "HH:MM:SS:FF" на компоненты. Возвращает null при несовпадении.
 */
function parseTimecode(tc) {
    var m = String(tc).match(/(\d+):(\d+):(\d+):(\d+)/);
    if (!m) return null;
    return {
        h: Number(m[1]),
        m: Number(m[2]),
        s: Number(m[3]),
        f: Number(m[4])
    };
}

function pad2(n) {
    n = Math.abs(Number(n));
    return n < 10 ? "0" + n : "" + n;
}

/**
 * Пересобирает фрагменты в конец таймлайна (копиями, не трогая оригинал).
 *
 * Переносится ВЕСЬ стек дорожек: все видеодорожки (V1, V2, ...) и, если
 * withAudio, все аудиодорожки (A1, A2, ...). Каждый клип кладётся на свою
 * дорожку назначения с сохранением взаимного выравнивания между дорожками.
 *
 * @param {string} groupsJson — JSON: массив групп, каждая группа — массив пар
 *   [inTc, outTc] таймкодов "HH:MM:SS:FF" (позиции НА ТАЙМЛАЙНЕ).
 * @param {boolean} withAudio — переносить ли аудиодорожки.
 * @param {string} startTc — таймкод старта сборки, напр. "00:30:00:00".
 * @param {number} gapSec — пауза в секундах между группами.
 * @return {string} JSON: { ok, error, placed, groups }.
 *
 * Внутри группы сегменты стыкуются вплотную (destTime растёт на длину
 * сегмента); между группами вставляется пауза gapSec.
 */
function assembleFragments(groupsJson, withAudio, startTc, gapSec) {
    var result = { ok: false, error: "", placed: 0, groups: 0 };

    try {
        var seq = app.project.activeSequence;
        if (!seq) {
            result.error = "Нет активной секвенции.";
            return JSON.stringify(result);
        }

        var fps = (function () {
            var tb = Number(seq.timebase);
            return tb > 0 ? (TICKS_PER_SECOND / tb) : 0;
        })();

        var vTracks = seq.videoTracks;
        var aTracks = seq.audioTracks;
        if (!vTracks || vTracks.numTracks === 0) {
            result.error = "Нет видеодорожек в секвенции.";
            return JSON.stringify(result);
        }

        var groups = JSON.parse(groupsJson);

        var startSec = tcToSeconds(startTc, fps);
        if (startSec === null) startSec = 30 * 60; // запасной старт 00:30:00:00

        gapSec = Number(gapSec);
        if (isNaN(gapSec) || gapSec < 0) gapSec = 0;

        var destTime = startSec;
        var placed = 0;

        for (var g = 0; g < groups.length; g++) {
            if (g > 0) {
                destTime += gapSec; // пауза между группами
            }

            var segs = groups[g];
            for (var s = 0; s < segs.length; s++) {
                var t1 = tcToSeconds(segs[s][0], fps);
                var t2 = tcToSeconds(segs[s][1], fps);
                if (t1 === null || t2 === null || t2 <= t1) continue;

                // Кладём содержимое диапазона со всех дорожек на те же дорожки
                // назначения. destTime — общая точка старта сегмента; внутри
                // сегмента каждый суб-клип смещается на (os - t1), сохраняя
                // выравнивание между дорожками и внутренние зазоры.
                var vi;
                for (vi = 0; vi < vTracks.numTracks; vi++) {
                    placed += placeTrackRange(vTracks[vi], vTracks[vi], t1, t2, destTime);
                }
                if (withAudio && aTracks) {
                    for (vi = 0; vi < aTracks.numTracks; vi++) {
                        placed += placeTrackRange(aTracks[vi], aTracks[vi], t1, t2, destTime);
                    }
                }

                destTime += (t2 - t1); // сегменты группы стыкуются вплотную
            }
        }

        result.placed = placed;
        result.groups = groups.length;
        result.ok = true;
    } catch (e) {
        result.error = "Ошибка: " + e.toString();
    }

    return JSON.stringify(result);
}

/**
 * Копирует содержимое диапазона [t1, t2] исходной дорожки на дорожку
 * назначения, начиная с destTime, сохраняя относительные смещения клипов.
 * @return {number} сколько клипов вставлено.
 */
function placeTrackRange(srcTrack, dstTrack, t1, t2, destTime) {
    var subs = subSegmentsForRange(srcTrack, t1, t2);
    var count = 0;
    for (var k = 0; k < subs.length; k++) {
        var sub = subs[k];
        var projItem = sub.item.projectItem;
        if (!projItem) continue;

        setClipInOut(projItem, sub.srcIn, sub.srcIn + sub.dur);
        var placeAt = destTime + (sub.os - t1);
        try {
            dstTrack.overwriteClip(projItem, placeAt);
            count++;
        } catch (e) {}
    }
    return count;
}

/**
 * Возвращает под-сегменты, покрывающие диапазон [t1, t2] таймлайна,
 * разбитые по границам клипов дорожки. Каждый: { item, srcIn, dur, os }.
 */
function subSegmentsForRange(track, t1, t2) {
    var subs = [];
    for (var c = 0; c < track.clips.numItems; c++) {
        var it = track.clips[c];
        var s = it.start.seconds;
        var e = it.end.seconds;
        var os = s > t1 ? s : t1;         // начало перекрытия
        var oe = e < t2 ? e : t2;         // конец перекрытия
        if (oe - os > 0.0005) {
            subs.push({
                os: os,
                item: it,
                srcIn: it.inPoint.seconds + (os - s),
                dur: oe - os
            });
        }
    }
    subs.sort(function (a, b) { return a.os - b.os; });
    return subs;
}

/**
 * Задаёт точки in/out проектного элемента (в секундах) для overwriteClip.
 * mediaType 4 = любой (видео+аудио); при ошибке пробуем без mediaType.
 */
function setClipInOut(projItem, inSec, outSec) {
    try {
        projItem.setInPoint(inSec, 4);
        projItem.setOutPoint(outSec, 4);
    } catch (e) {
        try {
            projItem.setInPoint(inSec);
            projItem.setOutPoint(outSec);
        } catch (e2) {}
    }
}

/**
 * Таймкод "HH:MM:SS:FF" → секунды. null при несовпадении.
 */
function tcToSeconds(tc, fps) {
    var p = parseTimecode(tc);
    if (!p) return null;
    return p.h * 3600 + p.m * 60 + p.s + (fps > 0 ? p.f / fps : 0);
}
