/*
 * CSInterface.js — компактная рабочая версия Adobe CEP CSInterface.
 * Содержит методы, необходимые панели: evalScript, getSystemPath,
 * getHostEnvironment, addEventListener/dispatchEvent, CSEvent.
 *
 * Основано на официальном Adobe-CEP CSInterface. Для большинства панелей
 * этого набора достаточно; при необходимости замените полной версией из
 * https://github.com/Adobe-CEP/CEP-Resources
 */

function SystemPath() {}
SystemPath.USER_DATA = "userData";
SystemPath.COMMON_FILES = "commonFiles";
SystemPath.MY_DOCUMENTS = "myDocuments";
SystemPath.APPLICATION = "application";
SystemPath.EXTENSION = "extension";
SystemPath.HOST_APPLICATION = "hostApplication";

function CSEvent(type, scope, appId, extensionId) {
    this.type = type;
    this.scope = scope;
    this.appId = appId;
    this.extensionId = extensionId;
    this.data = "";
}

function CSInterface() {}

CSInterface.prototype.hostEnvironment =
    (typeof window !== "undefined" && window.__adobe_cep__)
        ? JSON.parse(window.__adobe_cep__.getHostEnvironment())
        : null;

/**
 * Выполняет ExtendScript в хост-приложении (Premiere Pro).
 * @param {string} script — код ExtendScript.
 * @param {function} callback — вызывается со строковым результатом.
 */
CSInterface.prototype.evalScript = function (script, callback) {
    if (callback === null || callback === undefined) {
        callback = function () {};
    }
    window.__adobe_cep__.evalScript(script, callback);
};

CSInterface.prototype.getHostEnvironment = function () {
    this.hostEnvironment = JSON.parse(window.__adobe_cep__.getHostEnvironment());
    return this.hostEnvironment;
};

CSInterface.prototype.getSystemPath = function (pathType) {
    var path = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
    var OSVersion = this.getOSInformation();
    if (OSVersion.indexOf("Windows") >= 0) {
        path = path.replace("file:///", "");
    } else if (OSVersion.indexOf("Mac") >= 0) {
        path = path.replace("file://", "");
    }
    return path;
};

CSInterface.prototype.getApplicationID = function () {
    return this.getHostEnvironment().appId;
};

CSInterface.prototype.getOSInformation = function () {
    var userAgent = navigator.userAgent;
    if ((navigator.platform === "Win32") || (navigator.platform === "Windows")) {
        return "Windows";
    } else if ((navigator.platform === "MacIntel") || (navigator.platform === "Macintosh")) {
        return "Mac";
    }
    return userAgent;
};

CSInterface.prototype.addEventListener = function (type, listener, obj) {
    window.__adobe_cep__.addEventListener(type, listener, obj);
};

CSInterface.prototype.removeEventListener = function (type, listener, obj) {
    window.__adobe_cep__.removeEventListener(type, listener, obj);
};

CSInterface.prototype.dispatchEvent = function (event) {
    if (typeof event.data === "object") {
        event.data = JSON.stringify(event.data);
    }
    window.__adobe_cep__.dispatchEvent(event);
};

CSInterface.prototype.requestOpenExtension = function (extensionId, params) {
    window.__adobe_cep__.requestOpenExtension(extensionId, params);
};

CSInterface.prototype.getExtensions = function (extensionIds) {
    var extensionIdsStr = JSON.stringify(extensionIds || []);
    var extensionsStr = window.__adobe_cep__.getExtensions(extensionIdsStr);
    return JSON.parse(extensionsStr);
};

CSInterface.prototype.closeExtension = function () {
    window.__adobe_cep__.closeExtension();
};

CSInterface.prototype.openURLInDefaultBrowser = function (url) {
    if (window.cep && window.cep.util) {
        return window.cep.util.openURLInDefaultBrowser(url);
    }
};
