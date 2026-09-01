/**
 * 二维码生成模块
 * 封装 qrcode 库调用，提供缓存机制和 LRU 淘汰策略
 */
var QRCodeGen = (function() {
    'use strict';

    var cache = {};
    var cacheKeys = [];  // 记录插入顺序，用于 LRU 淘汰
    var MAX_CACHE_SIZE = 2000;  // 缓存上限

    /**
     * 生成二维码 DataURL
     * @param {string} text - 二维码内容
     * @param {number} size - 输出尺寸（像素）
     * @returns {string} PNG DataURL，失败返回空字符串
     */
    function generate(text, size) {
        if (typeof qrcode === 'undefined') {
            console.error('[QRCodeGen] 二维码库未加载，请检查 libs/qrcode.js');
            return '';
        }

        // 配置参数(支持外部覆盖)
        var gap = 0, quietZone = 0;
        try {
            if (typeof APP_CONFIG !== 'undefined') {
                gap = parseFloat(APP_CONFIG.qrModuleGap) || 0;
                quietZone = parseInt(APP_CONFIG.qrQuietZone) || 0;
            }
        } catch (e) { /* 默认值 */ }
        // gap 限定在 0-0.5
        if (gap < 0) gap = 0;
        if (gap > 0.5) gap = 0.5;
        // quietZone 限定在 0-4
        if (quietZone < 0) quietZone = 0;
        if (quietZone > 4) quietZone = 4;

        var key = text + '_' + size + '_' + gap + '_' + quietZone + '_' + (APP_CONFIG.qrErrorLevel || 'M');
        if (cache[key]) return cache[key];

        try {
            var qr = qrcode(0, APP_CONFIG.qrErrorLevel);
            qr.addData(unescape(encodeURIComponent(text || ' ')), 'Byte');
            qr.make();

            var moduleCount = qr.getModuleCount();
            var canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            var ctx = canvas.getContext('2d');

            // 整张白底(包含 quiet zone 区域)
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, size, size);

            // 数据区起点:留出 quietZone 个模块的边距
            // 总尺寸 = moduleCount + 2*quietZone 个"逻辑模块"
            var totalModules = moduleCount + 2 * quietZone;
            var cellSize = size / totalModules;  // 每模块占的像素
            var dataStart = quietZone * cellSize;

            // 模块绘制:严格按 cellSize,不留重叠 +1
            // gap > 0 时,每个黑块四周内缩 gap*cellSize/2,形成留白
            ctx.fillStyle = '#000000';
            var inset = cellSize * gap / 2;
            var drawSize = Math.max(0.5, cellSize - inset * 2);  // 极小时保留最小可见尺寸

            for (var row = 0; row < moduleCount; row++) {
                for (var col = 0; col < moduleCount; col++) {
                    if (qr.isDark(row, col)) {
                        var x = dataStart + col * cellSize + inset;
                        var y = dataStart + row * cellSize + inset;
                        ctx.fillRect(x, y, drawSize, drawSize);
                    }
                }
            }

            var dataUrl = canvas.toDataURL('image/png');

            // LRU 缓存管理
            cacheKeys.push(key);
            if (cacheKeys.length > MAX_CACHE_SIZE) {
                var oldKey = cacheKeys.shift();
                delete cache[oldKey];
            }
            cache[key] = dataUrl;

            return dataUrl;
        } catch (e) {
            console.warn('[QRCodeGen] 生成失败:', e.message);
            return '';
        }
    }

    /**
     * 构建二维码文本内容（逗号分隔所有字段）
     * @param {Object} item - 数据项 {code, name, dept, model, date, person}
     * @returns {string}
     */
    function buildQRText(item) {
        return [
            item.code || '',
            item.name || '',
            item.dept || '',
            item.model || '',
            item.date || '',
            item.person || ''
        ].join(', ');
    }

    /**
     * 清空缓存
     */
    function clearCache() {
        cache = {};
        cacheKeys = [];
    }

    /**
     * 获取缓存大小
     */
    function getCacheSize() {
        return cacheKeys.length;
    }

    return {
        generate: generate,
        buildQRText: buildQRText,
        clearCache: clearCache,
        getCacheSize: getCacheSize
    };
})();
