/**
 * 设置管理模块 - 标签模板配置
 * 提供 UI 面板让用户自定义公司名称、颜色、标签尺寸、字段顺序等
 * 设置持久化到 localStorage，覆盖 APP_CONFIG 默认值
 */
var Settings = (function() {
    'use strict';

    var isLoaded = false;
    var _layoutCache = null;      // 布局缓存（内存）
    var _customLogoCache = null;  // 自定义 Logo 缓存
    var _layoutDirty = true;      // 标记是否需要重新读取

    /**
     * 从 localStorage 加载设置并应用到 APP_CONFIG
     */
    function load() {
        var saved = Storage.load(APP_CONFIG.storageKeys.settings);
        if (!saved || typeof saved !== 'object') { isLoaded = true; return; }

        if (saved.companyName) APP_CONFIG.companyName = saved.companyName;
        if (saved.labelWidth) APP_CONFIG.labelWidth = saved.labelWidth;
        if (saved.labelHeight) APP_CONFIG.labelHeight = saved.labelHeight;
        if (saved.qrSize) APP_CONFIG.qrSize = saved.qrSize;
        if (saved.qrErrorLevel) APP_CONFIG.qrErrorLevel = saved.qrErrorLevel;
        if (saved.qrModuleGap !== undefined) APP_CONFIG.qrModuleGap = saved.qrModuleGap;
        if (saved.qrQuietZone !== undefined) APP_CONFIG.qrQuietZone = saved.qrQuietZone;
        if (saved.fields && Array.isArray(saved.fields) && saved.fields.length > 0) {
            APP_CONFIG.fields = saved.fields;
            APP_CONFIG.fieldOrder = saved.fields.map(function(f) { return f.label; });
            APP_CONFIG.fieldKeys = saved.fields.map(function(f) { return f.key; });
        }
        if (saved.pdfQuality) {
            APP_CONFIG.pdf.quality = saved.pdfQuality;
        }
        // 缓存布局和 Logo 到内存
        _layoutCache = saved.layout || null;
        _customLogoCache = saved.customLogo || null;
        _layoutDirty = false;

        isLoaded = true;
    }

    /**
     * 保存当前 APP_CONFIG 中的可配置项到 localStorage
     */
    function save() {
        var existing = Storage.load(APP_CONFIG.storageKeys.settings) || {};
        var settings = {
            companyName: APP_CONFIG.companyName,
            labelWidth: APP_CONFIG.labelWidth,
            labelHeight: APP_CONFIG.labelHeight,
            qrSize: APP_CONFIG.qrSize,
            qrErrorLevel: APP_CONFIG.qrErrorLevel,
            qrModuleGap: APP_CONFIG.qrModuleGap,
            qrQuietZone: APP_CONFIG.qrQuietZone,
            fields: APP_CONFIG.fields || _defaultFields(),
            pdfQuality: APP_CONFIG.pdf.quality,
            // 保留布局和 Logo（由编辑器单独管理）
            layout: existing.layout || null,
            customLogo: existing.customLogo || null
        };
        Storage.save(APP_CONFIG.storageKeys.settings, settings);
    }

    /**
     * 恢复默认设置
     */
    function reset() {
        Storage.remove(APP_CONFIG.storageKeys.settings);
        APP_CONFIG.companyName = '湖北华工图像技术开发有限公司';
        APP_CONFIG.labelWidth = 105;
        APP_CONFIG.labelHeight = 70;
        APP_CONFIG.qrSize = 16;
        APP_CONFIG.qrErrorLevel = 'M';
        APP_CONFIG.qrModuleGap = 0;
        APP_CONFIG.qrQuietZone = 1;
        APP_CONFIG.pdf.quality = 0.92;
        APP_CONFIG.fields = _defaultFields();
        APP_CONFIG.fieldOrder = APP_CONFIG.fields.map(function(f) { return f.label; });
        APP_CONFIG.fieldKeys = APP_CONFIG.fields.map(function(f) { return f.key; });
    }

    function _defaultFields() {
        return [
            { key: 'code', label: '资产编码', visible: true },
            { key: 'name', label: '资产名称', visible: true },
            { key: 'dept', label: '使用部门', visible: true },
            { key: 'model', label: '规格型号', visible: true },
            { key: 'date', label: '开始使用日期', visible: true },
            { key: 'person', label: '责任人', visible: true }
        ];
    }

    /**
     * 获取可见字段列表
     */
    function getVisibleFields() {
        var fields = APP_CONFIG.fields || _defaultFields();
        return fields.filter(function(f) { return f.visible; });
    }

    // ========== 布局位置管理 ==========

    /**
     * 获取保存的布局位置
     * @returns {Object|null} 位置对象 { company: {x,y}, field_code: {x,y}, ... }
     */
    function getLayout() {
        if (!_layoutDirty) return _layoutCache;
        // 仅在脏时重新读取（兼容外部直接修改 storage 的场景）
        var saved = Storage.load(APP_CONFIG.storageKeys.settings);
        _layoutCache = (saved && saved.layout) ? saved.layout : null;
        _layoutDirty = false;
        return _layoutCache;
    }

    /**
     * 保存布局位置
     * @param {Object} positions - 位置对象
     */
    function setLayout(positions) {
        var saved = Storage.load(APP_CONFIG.storageKeys.settings) || {};
        saved.layout = positions;
        Storage.save(APP_CONFIG.storageKeys.settings, saved);
        _layoutCache = positions; // 同步更新内存缓存
        _layoutDirty = false;
    }

    // ========== 自定义 Logo 管理 ==========

    /**
     * 获取自定义 Logo（base64）
     * @returns {string|null}
     */
    function getCustomLogo() {
        return _customLogoCache;
    }

    /**
     * 设置自定义 Logo
     * @param {string|null} base64 - Logo 的 base64 DataURL，null 表示移除自定义
     */
    function setCustomLogo(base64) {
        var saved = Storage.load(APP_CONFIG.storageKeys.settings) || {};
        saved.customLogo = base64;
        Storage.save(APP_CONFIG.storageKeys.settings, saved);
        _customLogoCache = base64; // 同步更新内存缓存
    }

    // ========== 设置面板 UI ==========

    /**
     * 打开设置面板
     * @param {Function} onSaveCallback - 保存后的回调
     */
    function openPanel(onSaveCallback) {
        var overlay = document.createElement('div');
        overlay.id = 'settingsOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:99998;display:flex;align-items:center;justify-content:center;';

        var panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:14px;padding:0;width:520px;max-width:94%;max-height:88vh;overflow:auto;box-shadow:0 16px 48px rgba(0,0,0,0.2);';

        // 标题栏
        var header = '<div style="padding:20px 28px 16px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">' +
            '<div style="font-size:18px;font-weight:700;color:#1a3c6e;">⚙️ 标签模板设置</div>' +
            '<button id="settingsClose" style="background:none;border:none;font-size:20px;cursor:pointer;color:#999;padding:4px 8px;border-radius:4px;">✕</button>' +
            '</div>';

        // 内容区
        var body = '<div style="padding:20px 28px;">';

        // 公司信息
        body += '<div style="margin-bottom:18px;">' +
            '<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #f0f0f0;">🏢 公司信息</div>' +
            '<div style="margin-bottom:10px;">' +
                '<label style="display:block;font-size:12px;color:#888;margin-bottom:3px;">公司名称</label>' +
                '<input type="text" id="setCompanyName" value="' + _attr(APP_CONFIG.companyName) + '" style="width:100%;padding:8px 12px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;">' +
            '</div>' +
            '</div>';

        // 标签尺寸
        body += '<div style="margin-bottom:18px;">' +
            '<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #f0f0f0;">📐 标签尺寸</div>' +
            '<div style="display:flex;gap:16px;">' +
                '<div style="flex:1;">' +
                    '<label style="display:block;font-size:12px;color:#888;margin-bottom:3px;">宽度 (mm)</label>' +
                    '<input type="number" id="setLabelWidth" value="' + APP_CONFIG.labelWidth + '" min="50" max="200" style="width:100%;padding:8px 12px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;">' +
                '</div>' +
                '<div style="flex:1;">' +
                    '<label style="display:block;font-size:12px;color:#888;margin-bottom:3px;">高度 (mm)</label>' +
                    '<input type="number" id="setLabelHeight" value="' + APP_CONFIG.labelHeight + '" min="30" max="150" style="width:100%;padding:8px 12px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;">' +
                '</div>' +
            '</div>' +
            '</div>';

        // 二维码设置
        body += '<div style="margin-bottom:18px;">' +
            '<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #f0f0f0;">📱 二维码</div>' +
            '<div style="display:flex;gap:16px;">' +
                '<div style="flex:1;">' +
                    '<label style="display:block;font-size:12px;color:#888;margin-bottom:3px;">尺寸 (mm)</label>' +
                    '<input type="number" id="setQrSize" value="' + APP_CONFIG.qrSize + '" min="8" max="30" style="width:100%;padding:8px 12px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;">' +
                '</div>' +
                '<div style="flex:1;">' +
                    '<label style="display:block;font-size:12px;color:#888;margin-bottom:3px;">纠错级别</label>' +
                    '<select id="setQrLevel" style="width:100%;padding:8px 12px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;">' +
                        '<option value="L"' + (APP_CONFIG.qrErrorLevel === 'L' ? ' selected' : '') + '>L - 低 (7%)</option>' +
                        '<option value="M"' + (APP_CONFIG.qrErrorLevel === 'M' ? ' selected' : '') + '>M - 中 (15%)</option>' +
                        '<option value="Q"' + (APP_CONFIG.qrErrorLevel === 'Q' ? ' selected' : '') + '>Q - 较高 (25%)</option>' +
                        '<option value="H"' + (APP_CONFIG.qrErrorLevel === 'H' ? ' selected' : '') + '>H - 高 (30%)</option>' +
                    '</select>' +
                '</div>' +
            '</div>' +
            '<div style="display:flex;gap:16px;margin-top:12px;">' +
                '<div style="flex:1;">' +
                    '<label style="display:block;font-size:12px;color:#888;margin-bottom:3px;">模块间隙 <span id="setQrGapVal" style="color:#1a3c6e;font-weight:600;">' + (Math.round(APP_CONFIG.qrModuleGap * 100)) + '%</span></label>' +
                    '<input type="range" id="setQrGap" value="' + APP_CONFIG.qrModuleGap + '" min="0" max="0.5" step="0.05" style="width:100%;accent-color:#1a3c6e;cursor:pointer;">' +
                    '<div style="font-size:11px;color:#aaa;margin-top:2px;">0=紧贴,渗墨打印机建议 15%-25%</div>' +
                '</div>' +
                '<div style="flex:1;">' +
                    '<label style="display:block;font-size:12px;color:#888;margin-bottom:3px;">静默区 <span id="setQrQuietVal" style="color:#1a3c6e;font-weight:600;">' + APP_CONFIG.qrQuietZone + ' 模块</span></label>' +
                    '<input type="range" id="setQrQuiet" value="' + APP_CONFIG.qrQuietZone + '" min="0" max="4" step="1" style="width:100%;accent-color:#1a3c6e;cursor:pointer;">' +
                    '<div style="font-size:11px;color:#aaa;margin-top:2px;">四周留白,QR标准建议 4</div>' +
                '</div>' +
            '</div>' +
            '</div>';

        // PDF 质量
        body += '<div style="margin-bottom:18px;">' +
            '<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #f0f0f0;">📄 PDF 质量</div>' +
            '<select id="setPdfQuality" style="width:100%;padding:8px 12px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;">' +
                '<option value="0.6"' + (APP_CONFIG.pdf.quality <= 0.65 ? ' selected' : '') + '>草稿 (快速)</option>' +
                '<option value="0.8"' + (APP_CONFIG.pdf.quality > 0.65 && APP_CONFIG.pdf.quality <= 0.85 ? ' selected' : '') + '>标准</option>' +
                '<option value="0.95"' + (APP_CONFIG.pdf.quality > 0.85 ? ' selected' : '') + '>高质量 (较慢)</option>' +
            '</select>' +
            '</div>';

        // 字段管理
        var fields = APP_CONFIG.fields || _defaultFields();
        body += '<div style="margin-bottom:10px;">' +
            '<div style="font-size:14px;font-weight:600;color:#333;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #f0f0f0;">📝 字段管理 <span style="font-size:12px;color:#999;font-weight:400;">（勾选显示，↑↓调整顺序）</span></div>' +
            '<div id="fieldEditor">';

        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            body += '<div class="field-row" data-index="' + i + '" style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;background:#f8f9fa;border-radius:6px;">' +
                '<input type="checkbox" class="field-vis" data-index="' + i + '"' + (f.visible ? ' checked' : '') + ' style="cursor:pointer;">' +
                '<input type="text" class="field-label" data-index="' + i + '" value="' + _attr(f.label) + '" style="flex:1;padding:5px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;">' +
                '<button class="field-up" data-index="' + i + '" title="上移" style="padding:2px 8px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:14px;">↑</button>' +
                '<button class="field-down" data-index="' + i + '" title="下移" style="padding:2px 8px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;font-size:14px;">↓</button>' +
                '</div>';
        }

        body += '</div></div>';
        body += '</div>'; // end body

        // 底部按钮
        var footer = '<div style="padding:16px 28px;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">' +
            '<button id="settingsReset" style="padding:8px 16px;border:1px solid #dc3545;border-radius:6px;background:#fff;color:#dc3545;cursor:pointer;font-size:13px;">恢复默认</button>' +
            '<div style="display:flex;gap:10px;">' +
                '<button id="settingsCancel" style="padding:8px 20px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">取消</button>' +
                '<button id="settingsSave" style="padding:8px 20px;border:none;border-radius:6px;background:#1a3c6e;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">💾 保存设置</button>' +
            '</div>' +
            '</div>';

        panel.innerHTML = header + body + footer;
        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        // 绑定事件
        function close() { overlay.remove(); }

        panel.querySelector('#settingsClose').onclick = close;
        panel.querySelector('#settingsCancel').onclick = close;
        overlay.onclick = function(e) { if (e.target === overlay) close(); };

        // 二维码滑条实时联动数字显示
        (function() {
            var gapEl = panel.querySelector('#setQrGap');
            var gapVal = panel.querySelector('#setQrGapVal');
            if (gapEl && gapVal) {
                gapEl.oninput = function() {
                    gapVal.textContent = Math.round(parseFloat(this.value) * 100) + '%';
                };
            }
            var quietEl = panel.querySelector('#setQrQuiet');
            var quietVal = panel.querySelector('#setQrQuietVal');
            if (quietEl && quietVal) {
                quietEl.oninput = function() {
                    quietVal.textContent = this.value + ' 模块';
                };
            }
        })();

        // 字段上下移动
        panel.querySelectorAll('.field-up').forEach(function(btn) {
            btn.onclick = function() { _moveField(panel, parseInt(this.getAttribute('data-index')), -1); };
        });
        panel.querySelectorAll('.field-down').forEach(function(btn) {
            btn.onclick = function() { _moveField(panel, parseInt(this.getAttribute('data-index')), 1); };
        });

        // 恢复默认
        panel.querySelector('#settingsReset').onclick = function() {
            UI.confirm('恢复默认', '确认恢复所有设置为默认值？', function() {
                close();
                reset();
                save();
                if (onSaveCallback) onSaveCallback();
                UI.toast('已恢复默认设置', 'success');
            });
        };

        // 保存
        panel.querySelector('#settingsSave').onclick = function() {
            // 收集设置
            APP_CONFIG.companyName = panel.querySelector('#setCompanyName').value.trim() || APP_CONFIG.companyName;
            APP_CONFIG.labelWidth = parseInt(panel.querySelector('#setLabelWidth').value) || APP_CONFIG.labelWidth;
            APP_CONFIG.labelHeight = parseInt(panel.querySelector('#setLabelHeight').value) || APP_CONFIG.labelHeight;
            APP_CONFIG.qrSize = parseInt(panel.querySelector('#setQrSize').value) || APP_CONFIG.qrSize;
            APP_CONFIG.qrErrorLevel = panel.querySelector('#setQrLevel').value;
            APP_CONFIG.qrModuleGap = parseFloat(panel.querySelector('#setQrGap').value) || 0;
            APP_CONFIG.qrQuietZone = parseInt(panel.querySelector('#setQrQuiet').value) || 0;
            APP_CONFIG.pdf.quality = parseFloat(panel.querySelector('#setPdfQuality').value);
            // 清除二维码缓存,使新参数立即生效
            if (typeof QRCodeGen !== 'undefined' && QRCodeGen.clearCache) QRCodeGen.clearCache();

            // 收集字段设置（按当前 DOM 顺序）
            var rows = panel.querySelectorAll('#fieldEditor .field-row');
            var newFields = [];
            rows.forEach(function(row) {
                var idx = row.getAttribute('data-index');
                var vis = row.querySelector('.field-vis').checked;
                var lbl = row.querySelector('.field-label').value.trim();
                if (lbl) {
                    newFields.push({
                        key: APP_CONFIG.fields[idx] ? APP_CONFIG.fields[idx].key : 'field_' + idx,
                        label: lbl,
                        visible: vis
                    });
                }
            });
            if (newFields.length > 0) {
                APP_CONFIG.fields = newFields;
                APP_CONFIG.fieldOrder = newFields.map(function(f) { return f.label; });
                APP_CONFIG.fieldKeys = newFields.map(function(f) { return f.key; });
            }

            save();
            close();
            if (onSaveCallback) onSaveCallback();
            UI.toast('设置已保存', 'success');
        };
    }

    /**
     * 移动字段顺序
     */
    function _moveField(panel, index, direction) {
        var editor = panel.querySelector('#fieldEditor');
        var rows = editor.querySelectorAll('.field-row');
        var newIndex = index + direction;
        if (newIndex < 0 || newIndex >= rows.length) return;

        // 交换 DOM 位置
        var currentRow = rows[index];
        var targetRow = rows[newIndex];
        if (direction === -1) {
            editor.insertBefore(currentRow, targetRow);
        } else {
            editor.insertBefore(targetRow, currentRow);
        }
    }

    function _attr(str) {
        return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    return {
        load: load,
        save: save,
        reset: reset,
        openPanel: openPanel,
        getVisibleFields: getVisibleFields,
        getLayout: getLayout,
        setLayout: setLayout,
        getCustomLogo: getCustomLogo,
        setCustomLogo: setCustomLogo
    };
})();
