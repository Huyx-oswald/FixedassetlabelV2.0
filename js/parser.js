/**
 * 数据解析与校验模块
 * 负责：文本解析、Excel 数据转换、日期格式化、数据校验
 */
var Parser = (function() {
    'use strict';

    // Excel 日期序列号的基准偏移（1899-12-30 到 1970-01-01 的天数差）
    var EXCEL_DATE_OFFSET = 25569;
    var MS_PER_DAY = 86400000;

    // 表头关键词（用于自动跳过表头行）
    var HEADER_KEYWORDS = [
        '资产编码', '资产名称', '使用部门', '规格型号', '开始使用日期', '责任人',
        '编码', '名称', '部门', '型号', '日期'
    ];

    /**
     * 格式化日期值 → "YYYY/MM/DD"
     * 支持：Excel 序列号、日期字符串、Date 对象
     */
    function formatDate(value) {
        if (!value || value === '' || value === '—') return '';

        // Excel 数字序列号
        if (typeof value === 'number' && !isNaN(value) && value > 1) {
            return _excelNumToDate(value);
        }

        if (typeof value === 'string') {
            // 尝试解析为数字（Excel 序列号）
            var num = parseFloat(value);
            if (!isNaN(num) && num > 1 && value.indexOf('/') === -1 && value.indexOf('-') === -1) {
                return _excelNumToDate(num);
            }
            // 尝试匹配日期格式
            var m = value.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
            if (m) {
                return m[1] + '/' + _pad(m[2]) + '/' + _pad(m[3]);
            }
            return value;
        }

        if (value instanceof Date && !isNaN(value)) {
            return value.getFullYear() + '/' + _pad(value.getMonth() + 1) + '/' + _pad(value.getDate());
        }

        return String(value);
    }

    function _excelNumToDate(num) {
        var d = new Date((num - EXCEL_DATE_OFFSET) * MS_PER_DAY);
        return d.getFullYear() + '/' + _pad(d.getMonth() + 1) + '/' + _pad(d.getDate());
    }

    function _pad(n) {
        return String(n).padStart(2, '0');
    }

    /**
     * 解析一行文本为字段数组
     * 支持：逗号分隔、Tab 分隔、多空格分隔
     */
    function parseLine(line) {
        var parts;
        if (line.indexOf(',') > -1) {
            parts = line.split(',').map(function(s) { return s.trim(); });
        } else if (line.indexOf('\t') > -1) {
            parts = line.split('\t').map(function(s) { return s.trim(); });
        } else {
            parts = line.split(/\s{2,}/).map(function(s) { return s.trim(); });
        }
        // 补齐到 6 个字段
        while (parts.length < 6) parts.push('');
        return parts.slice(0, 6);
    }

    /**
     * 判断是否为表头行
     */
    function isHeaderLine(parts) {
        if (!parts || parts.length === 0) return false;
        var count = 0;
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i] || '';
            for (var j = 0; j < HEADER_KEYWORDS.length; j++) {
                if (p.indexOf(HEADER_KEYWORDS[j]) > -1) { count++; break; }
            }
        }
        return count >= 2;
    }

    /**
     * 将文本行解析为数据项数组
     * @param {string} rawText - 原始文本
     * @returns {Array} 数据项数组 [{code, name, dept, model, date, person}]
     */
    function parseText(rawText) {
        var lines = rawText.split('\n').map(function(l) { return l.trim(); }).filter(function(l) {
            return l && l.indexOf('--') !== 0 && l.indexOf('//') !== 0;
        });

        var items = [];
        for (var i = 0; i < lines.length; i++) {
            var parts = parseLine(lines[i]);
            if (parts.every(function(p) { return !p; })) continue;  // 空行
            if (isHeaderLine(parts)) continue;                       // 表头行

            var item = {
                code:   parts[0] || '',
                name:   parts[1] || '',
                dept:   parts[2] || '',
                model:  parts[3] || '',
                date:   formatDate(parts[4]),
                person: parts[5] || ''
            };
            if (!item.code && !item.name) continue;
            items.push(item);
        }
        return items;
    }

    /**
     * 解析 Excel 数据（由 XLSX 库读取后的二维数组）
     * @param {Array<Array>} jsonData - 二维数组
     * @returns {Array} 数据项数组
     */
    function parseExcelData(jsonData) {
        if (!jsonData || jsonData.length === 0) return [];

        // 智能检测表头行（检查前 3 行）
        var startRow = 0;
        for (var r = 0; r < jsonData.length && r < 3; r++) {
            var row = jsonData[r];
            if (!row || row.length === 0) continue;
            var rowStr = row.join(',').toLowerCase();
            if (rowStr.indexOf('资产编码') > -1 || rowStr.indexOf('资产名称') > -1 ||
                rowStr.indexOf('编码') > -1 || rowStr.indexOf('名称') > -1) {
                startRow = r + 1;
                break;
            }
        }

        var items = [];
        for (var r2 = startRow; r2 < jsonData.length; r2++) {
            var row2 = jsonData[r2];
            if (!row2 || row2.length === 0) continue;

            // 检查是否有有效数据
            var hasData = false;
            for (var c = 0; c < row2.length; c++) {
                if (row2[c] !== undefined && row2[c] !== null && row2[c] !== '') {
                    hasData = true; break;
                }
            }
            if (!hasData) continue;

            // 提取 6 个字段
            var fields = [];
            for (var c2 = 0; c2 < 6; c2++) {
                var cell = (c2 < row2.length) ? row2[c2] : '';
                if (cell === undefined || cell === null) cell = '';
                if (cell instanceof Date && !isNaN(cell)) {
                    cell = cell.getFullYear() + '/' + _pad(cell.getMonth() + 1) + '/' + _pad(cell.getDate());
                }
                fields.push(String(cell).trim());
            }

            var item = {
                code:   fields[0],
                name:   fields[1],
                dept:   fields[2],
                model:  fields[3],
                date:   formatDate(fields[4]),
                person: fields[5]
            };
            if (!item.code && !item.name) continue;
            items.push(item);
        }
        return items;
    }

    /**
     * 将数据项数组转回文本格式（用于 textarea 显示）
     */
    function itemsToText(items) {
        return items.map(function(item) {
            return [item.code, item.name, item.dept, item.model, item.date, item.person].join(', ');
        }).join('\n');
    }

    /**
     * 校验数据项
     * @param {Array} items - 数据项数组
     * @returns {Object} { valid: boolean, errors: [{index, field, message}], warnings: [...] }
     */
    function validate(items) {
        var errors = [];
        var warnings = [];
        var codeSet = {};

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var rowLabel = '第 ' + (i + 1) + ' 行';

            // 必填字段检查
            for (var f = 0; f < APP_CONFIG.requiredFields.length; f++) {
                var key = APP_CONFIG.requiredFields[f];
                if (!item[key] || item[key].trim() === '') {
                    var fieldName = APP_CONFIG.fieldOrder[APP_CONFIG.fieldKeys.indexOf(key)];
                    errors.push({ index: i, field: key, message: rowLabel + '：' + fieldName + ' 不能为空' });
                }
            }

            // 编码唯一性检查
            if (item.code) {
                if (codeSet[item.code]) {
                    errors.push({ index: i, field: 'code', message: rowLabel + '：资产编码 "' + item.code + '" 与第 ' + (codeSet[item.code] + 1) + ' 行重复' });
                } else {
                    codeSet[item.code] = i;
                }
            }

            // 字段长度检查
            var v = APP_CONFIG.validation;
            if (item.code && item.code.length > v.maxCodeLength) {
                warnings.push({ index: i, field: 'code', message: rowLabel + '：资产编码超过 ' + v.maxCodeLength + ' 字符' });
            }
            if (item.name && item.name.length > v.maxNameLength) {
                warnings.push({ index: i, field: 'name', message: rowLabel + '：资产名称超过 ' + v.maxNameLength + ' 字符' });
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors,
            warnings: warnings
        };
    }

    /**
     * 导出为 CSV 格式文本
     */
    function toCSV(items) {
        var header = APP_CONFIG.fieldOrder.join(',');
        var rows = items.map(function(item) {
            return APP_CONFIG.fieldKeys.map(function(key) {
                var val = item[key] || '';
                // 包含逗号或引号时用引号包裹
                if (val.indexOf(',') > -1 || val.indexOf('"') > -1) {
                    return '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            }).join(',');
        });
        return '\uFEFF' + header + '\n' + rows.join('\n');  // BOM for Excel 兼容
    }

    return {
        formatDate: formatDate,
        parseLine: parseLine,
        isHeaderLine: isHeaderLine,
        parseText: parseText,
        parseExcelData: parseExcelData,
        itemsToText: itemsToText,
        validate: validate,
        toCSV: toCSV
    };
})();
