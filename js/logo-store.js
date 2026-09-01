/**
 * Logo 文件存储模块
 * 统一管理 logo/ 子目录中的 Logo 图片：列出文件、保存上传、解析来源、打开文件夹
 * 依赖 NW.js 的 Node 集成（fs/path/nw.gui），非 Node 环境下自动降级
 */
var LogoStore = (function() {
    'use strict';

    var LOGO_DIR_NAME = 'logo';
    var DEFAULT_LOGO_FILE = 'logo.png';
    var IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];

    var fs = null, path = null, gui = null;
    try {
        fs = require('fs');
        path = require('path');
        try {
            gui = require('nw.gui');
        } catch (e2) {
            gui = (typeof window !== 'undefined' && window.nw) ? window.nw : null;
        }
    } catch (e) {
        // 非 NW.js 环境（如纯浏览器调试），文件功能不可用
    }

    function available() { return !!fs; }

    /** 应用根目录（优先取页面所在目录，避免启动目录差异导致路径错误） */
    function _appRoot() {
        try {
            if (path && typeof window !== 'undefined' && window.location && window.location.pathname) {
                var dir = path.dirname(decodeURIComponent(window.location.pathname));
                if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
            }
        } catch (e) { /* 回退 cwd */ }
        return process.cwd();
    }

    /** Logo 目录绝对路径（不存在时自动创建） */
    function getLogoDir() {
        if (!fs) return LOGO_DIR_NAME;
        var dir = path.join(_appRoot(), LOGO_DIR_NAME);
        try {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        } catch (e) {
            console.error('创建 Logo 目录失败:', e);
        }
        return dir;
    }

    /** 默认 Logo 相对路径（优先 logo/ 子目录，兼容根目录旧文件） */
    function getDefaultLogoPath() {
        if (fs) {
            try {
                if (fs.existsSync(path.join(_appRoot(), LOGO_DIR_NAME, DEFAULT_LOGO_FILE))) {
                    return LOGO_DIR_NAME + '/' + DEFAULT_LOGO_FILE;
                }
            } catch (e) { /* 忽略，走回退 */ }
        }
        return DEFAULT_LOGO_FILE;
    }

    /** 列出 logo/ 目录中的图片文件名（按名称排序） */
    function listLogoFiles() {
        if (!fs) return [DEFAULT_LOGO_FILE];
        var dir = getLogoDir();
        try {
            return fs.readdirSync(dir).filter(function(f) {
                var ext = (f.split('.').pop() || '').toLowerCase();
                return IMAGE_EXTS.indexOf(ext) !== -1;
            }).sort();
        } catch (e) {
            console.error('读取 Logo 目录失败:', e);
            return [];
        }
    }

    /** 校验文件名是否存在于 logo/ 目录 */
    function fileExists(filename) {
        if (!fs || !filename) return false;
        try { return fs.existsSync(path.join(getLogoDir(), filename)); }
        catch (e) { return false; }
    }

    /** 清理非法文件名字符，保留扩展名 */
    function _sanitizeName(name) {
        var dot = name.lastIndexOf('.');
        var base = dot > 0 ? name.slice(0, dot) : name;
        var ext = dot > 0 ? name.slice(dot) : '';
        base = base.replace(/[\\/:*?"<>|]/g, '_').trim();
        if (!base) base = 'logo';
        return base + ext.toLowerCase();
    }

    /**
     * 保存 Logo 文件到 logo/ 目录
     * @param {string} filename - 期望文件名（自动清理非法字符，重名追加序号）
     * @param {string} dataUrl - base64 DataURL
     * @returns {string|null} 实际保存的文件名，失败返回 null
     */
    function saveLogoFile(filename, dataUrl) {
        if (!fs) return null;
        try {
            var match = /^data:image\/[a-zA-Z+.-]+;base64,(.+)$/.exec(dataUrl);
            if (!match) return null;
            var buf = Buffer.from(match[1], 'base64');
            var name = _sanitizeName(filename || 'logo.png');
            var dir = getLogoDir();
            // 重名时追加序号，避免覆盖已有文件
            var finalName = name, i = 1, dot = name.lastIndexOf('.');
            var baseName = dot > 0 ? name.slice(0, dot) : name;
            var ext = dot > 0 ? name.slice(dot) : '';
            while (fs.existsSync(path.join(dir, finalName))) {
                finalName = baseName + '(' + i + ')' + ext;
                i++;
            }
            fs.writeFileSync(path.join(dir, finalName), buf);
            return finalName;
        } catch (e) {
            console.error('保存 Logo 文件失败:', e);
            return null;
        }
    }

    /** 在资源管理器中打开 logo/ 目录 */
    function openLogoFolder() {
        if (!fs || !gui || !gui.Shell) return false;
        try {
            gui.Shell.openItem(getLogoDir());
            return true;
        } catch (e) {
            console.error('打开 Logo 目录失败:', e);
            return false;
        }
    }

    /**
     * 将布局中的 Logo 来源解析为可用的 src
     * 兼容旧格式：'default'/'custom'；新格式：logo/ 目录内的文件名
     * @param {string} source - 布局 logo.source 值
     * @param {string|null} legacyCustom - 旧版 localStorage 中的自定义 Logo base64
     */
    function resolveLogoSource(source, legacyCustom) {
        var def = getDefaultLogoPath();
        if (!source || source === 'default') return def;
        if (source === 'custom') return legacyCustom || def; // 旧版兼容
        if (/^data:/.test(source)) return source;             // 直接 base64（兜底）
        if (fileExists(source)) return LOGO_DIR_NAME + '/' + source;
        return def; // 文件不存在时回退默认
    }

    return {
        available: available,
        getDefaultLogoPath: getDefaultLogoPath,
        listLogoFiles: listLogoFiles,
        saveLogoFile: saveLogoFile,
        openLogoFolder: openLogoFolder,
        resolveLogoSource: resolveLogoSource
    };
})();
