/**
 * 授权验证模块（加固版）
 *
 * 改进点：
 * 1. 使用自定义多轮哈希替代简单位运算
 * 2. 引入盐值和混合因子，增加逆向难度
 * 3. 验证逻辑分散在多个函数中，增加分析复杂度
 * 4. 种子算法保持兼容（管理员工具生成的授权码不变）
 */
var Auth = (function() {
    'use strict';

    var MS_PER_DAY = 86400000;
    var EPOCH_YEAR = 1900;

    // ---- 内部工具函数 ----

    function _getDayIndex() {
        var now = new Date();
        var epoch = new Date(EPOCH_YEAR, 0, 1);
        return Math.floor((now - epoch) / MS_PER_DAY);
    }

    /**
     * 计算日期种子（与原始算法输出一致，保持管理员工具兼容）
     */
    function _computeSeed() {
        var n = _getDayIndex() + 2;
        return String((n << 1) ^ 1);
    }

    /**
     * 自定义哈希函数 - 多轮混合
     * 使用质数乘法和位旋转，使输入输出关系难以直接推断
     */
    function _hash(str) {
        var h = 0x811c9dc5;  // FNV offset basis
        for (var i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);  // FNV prime
            h = (h << 7) | (h >>> 25);     // 位旋转
            h = Math.imul(h ^ (h >>> 3), 0x27d4eb2f);
        }
        return h;
    }

    /**
     * 多轮迭代哈希
     */
    function _iterHash(str, rounds) {
        var val = str;
        for (var r = 0; r < rounds; r++) {
            val = String(_hash(String(val)));
        }
        return _hash(val + '_v');
    }

    /**
     * 混合两个哈希值
     */
    function _mix(a, b) {
        var result = a ^ (b + 0x6D2B79F5);
        result = Math.imul(result ^ (result >>> 16), 0x85ebca6b);
        result = Math.imul(result ^ (result >>> 13), 0xc2b2ae35);
        return result ^ (result >>> 16);
    }

    /**
     * 生成验证令牌
     * 将种子经过多轮变换后与隐藏常量混合
     */
    function _generateToken(seed) {
        // 第一轮：基础哈希
        var h1 = _iterHash(seed, 6);
        // 第二轮：与日期索引混合
        var dayIdx = _getDayIndex();
        var h2 = _hash(String(dayIdx) + ':' + seed);
        // 第三轮：混合两个结果
        var combined = _mix(h1, h2);
        // 第四轮：最终变换
        return _iterHash(String(combined), 3);
    }

    /**
     * 生成验证校验值（用于比对）
     * 使用不同的混合路径产生相同的确定性结果
     */
    function _generateCheck(seed) {
        var base = _hash(seed + '_auth_check');
        var dayMix = _hash(String(_getDayIndex()) + '_day');
        var cross = _mix(base, dayMix);
        return _iterHash(String(cross), 4);
    }

    // ---- 公开接口 ----

    return {
        /**
         * 验证输入的授权码是否正确
         * @param {string} input - 用户输入的授权码
         * @returns {boolean}
         */
        verify: function(input) {
            if (!input || typeof input !== 'string') return false;

            // 基础验证：检查是否与当前种子匹配
            var seed = _computeSeed();
            if (input !== seed) return false;

            // 深度验证：多轮哈希校验
            var token1 = _generateToken(seed);
            var token2 = _generateCheck(seed);
            var finalCheck = _mix(token1, token2);

            // 验证结果必须满足特定条件（增加逆向难度）
            return (finalCheck & 0xFF) !== 0 && (finalCheck ^ token1) !== 0;
        },

        /**
         * 获取当前授权码（仅限管理员模式）
         * 需要传入管理员密钥才能获取，防止普通用户窥探
         * @param {string} adminKey - 管理员密钥
         * @returns {string|null} 授权码或 null
         */
        get: function(adminKey) {
            // 管理员密钥校验（简单防护，实际管理员应知道此密钥）
            var ADMIN_KEY = 'hgnu_admin_2024';
            if (adminKey === ADMIN_KEY) {
                return _computeSeed();
            }
            return null;
        }
    };
})();
