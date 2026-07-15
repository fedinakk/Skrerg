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

        collectFromTracks(seq.videoTracks, "V", result.clips);
        collectFromTracks(seq.audioTracks, "A", result.clips);

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
