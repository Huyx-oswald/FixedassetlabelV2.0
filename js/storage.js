/**
 * 数据持久化模块 - localStorage 封装
 * 提供带防抖的自动保存和数据恢复功能
 */
var Storage = (function() {
    'use strict';

    /**
     * 保存数据到 localStorage
     * @param {string} key - 存储键名
     * @param {*} value - 要存储的值
     * @returns {boolean} 是否成功
     */
    function save(key, value) {
        try {
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            return true;
        } catch (e) {
            console.warn('[Storage] 保存失败:', e.message);
            return false;
        }
    }

    /**
     * 从 localStorage 读取数据
     * @param {string} key - 存储键名
     * @returns {*} 存储的值，不存在返回 null
     */
    function load(key) {
        try {
            var val = localStorage.getItem(key);
            if (val === null) return null;
            // 尝试 JSON 解析，失败则返回原始字符串
            try { return JSON.parse(val); } catch (e) { return val; }
        } catch (e) {
            console.warn('[Storage] 读取失败:', e.message);
            return null;
        }
    }

    /**
     * 删除指定键
     * @param {string} key
     */
    function remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) { /* 忽略 */ }
    }

    /**
     * 创建带防抖的自动保存函数
     * @param {Function} getDataFn - 获取当前数据的函数
     * @param {string} key - 存储键名
     * @param {number} [delay=500] - 防抖延迟（ms）
     * @returns {Function} 触发保存的函数
     */
    function createAutoSaver(getDataFn, key, delay) {
        delay = delay || 500;
        var timer = null;
        return function() {
            if (timer) clearTimeout(timer);
            timer = setTimeout(function() {
                save(key, getDataFn());
            }, delay);
        };
    }

    return {
        save: save,
        load: load,
        remove: remove,
        createAutoSaver: createAutoSaver
    };
})();
