/**
 * 标签可视化编辑器 v5
 * 功能：拖拽定位、字号/粗细调整、Logo 尺寸调整、智能对齐辅助线
 */
var LabelEditor = (function() {
    'use strict';

    var SCALE = 4;
    var MIN_FONT = 6;
    var MAX_FONT = 36;
    var DEF_COMPANY_FS = 14;
    var DEF_FIELD_FS = 11;
    var DEF_LOGO_W = 10;
    var DEF_LOGO_H = 8;
    var ALIGN_THRESHOLD = 3; // px 对齐吸附阈值

    // ========== 默认布局 ==========

    function _getDefaults() {
        var lw = APP_CONFIG.labelWidth;
        var lh = APP_CONFIG.labelHeight;
        var fields = (typeof Settings !== 'undefined') ? Settings.getVisibleFields() : APP_CONFIG.fields;
        var lineH = 5.5;
        var companyY = 3;
        var fieldsStartY = companyY + 10;

        var pos = {
            logo:    { x: 4,  y: companyY, fontSize: DEF_COMPANY_FS, width: DEF_LOGO_W, height: DEF_LOGO_H },
            company: { x: 16, y: companyY, fontSize: DEF_COMPANY_FS, fontWeight: '700', fontFamily: APP_CONFIG.defaultFont }
        };

        for (var i = 0; i < fields.length; i++) {
            var key = fields[i] ? fields[i].key : APP_CONFIG.fieldKeys[i];
            pos['field_' + key] = { x: 4, y: fieldsStartY + i * lineH, fontSize: DEF_FIELD_FS, fontWeight: '400', fontFamily: APP_CONFIG.defaultFont };
        }

        pos.qr = { x: lw - APP_CONFIG.qrSize - 3, y: lh - APP_CONFIG.qrSize - 5 };
        return pos;
    }

    // ========== 状态 ==========

    var _overlay = null;
    var _positions = {};
    var _selectedKey = '';
    var _propPanel = null;
    var _drag = { active: false, el: null, key: '', startMX: 0, startMY: 0, startEX: 0, startEY: 0 };
    var _resize = { active: false, el: null, key: '', startMY: 0, startFS: 0 };
    // mode: 'both' 等比缩放 | 'x' 仅横向 | 'y' 仅竖向
    var _logoResize = { active: false, el: null, mode: 'both', startMX: 0, startMY: 0, startW: 0, startH: 0 };
    var _guides = []; // 对齐辅助线 [{type:'h'|'v', pos:number}]

    // 撤销/重做栈
    var _undoStack = [];
    var _redoStack = [];
    var MAX_UNDO = 30;

    // ========== 公开接口 ==========

    function open(onSaveCallback) {
        if (_overlay) return;
        var saved = (typeof Settings !== 'undefined') ? Settings.getLayout() : null;
        _positions = saved || _getDefaults();

        // 向后兼容
        if (!_positions.logo && !_positions.company) _positions = _getDefaults();
        if (!_positions.logo) _positions.logo = { x: 4, y: (_positions.company ? _positions.company.y : 3), fontSize: DEF_COMPANY_FS, width: DEF_LOGO_W, height: DEF_LOGO_H };
        if (!_positions.logo.width) _positions.logo.width = DEF_LOGO_W;
        if (!_positions.logo.height) _positions.logo.height = DEF_LOGO_H;
        if (_positions.company && !_positions.company.fontSize) _positions.company.fontSize = DEF_COMPANY_FS;
        _selectedKey = '';

        // 清空撤销栈
        _undoStack = [];
        _redoStack = [];

        _overlay = document.createElement('div');
        _overlay.id = 'editorOverlay';
        _overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
            'background:rgba(0,0,0,0.6);z-index:99998;display:flex;align-items:center;' +
            'justify-content:center;flex-direction:column;';

        _buildUI();
        document.body.appendChild(_overlay);
        _renderCanvas();
        _bindGlobalEvents();
        if (onSaveCallback) _overlay._onSave = onSaveCallback;
    }

    function close() {
        if (_overlay) { _overlay.remove(); _overlay = null; }
        _drag.active = false; _resize.active = false;
        _logoResize.active = false;
        _selectedKey = '';
    }

    // ========== UI 构建 ==========

    function _buildUI() {
        var lw = APP_CONFIG.labelWidth;
        var lh = APP_CONFIG.labelHeight;

        var info = document.createElement('div');
        info.style.cssText = 'color:#fff;font-size:14px;margin-bottom:14px;text-align:center;';
        info.innerHTML = '🏷️ <strong>标签布局编辑器</strong> — 拖拽定位 | 点击元素编辑属性 | 拖拽时自动显示对齐线（' + lw + '×' + lh + 'mm）';
        _overlay.appendChild(info);

        var mainWrap = document.createElement('div');
        mainWrap.style.cssText = 'display:flex;gap:24px;align-items:flex-start;';

        var canvasWrap = document.createElement('div');
        canvasWrap.style.cssText = 'background:#fff;border:2px solid #333;position:relative;box-shadow:0 8px 32px rgba(0,0,0,0.3);';
        canvasWrap.style.width = (lw * SCALE) + 'px';
        canvasWrap.style.height = (lh * SCALE) + 'px';
        canvasWrap.id = 'editorCanvas';
        _overlay.appendChild(mainWrap);
        mainWrap.appendChild(canvasWrap);

        // 右侧面板（工具 + 属性）
        var rightPanel = document.createElement('div');
        rightPanel.style.cssText = 'display:flex;flex-direction:column;gap:16px;max-height:80vh;overflow-y:auto;';

        // 工具面板
        var toolPanel = document.createElement('div');
        toolPanel.style.cssText = 'background:#fff;border-radius:10px;padding:18px;width:220px;box-shadow:0 4px 16px rgba(0,0,0,0.2);';
        toolPanel.innerHTML =
            '<div style="font-size:15px;font-weight:700;color:#1a3c6e;margin-bottom:14px;">🛠️ 工具</div>' +
            '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
                '<button id="editorUndo" title="撤销 (Ctrl+Z)" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">↩️ 撤销</button>' +
                '<button id="editorRedo" title="重做 (Ctrl+Y)" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">↪️ 重做</button>' +
            '</div>' +
            '<div style="margin-bottom:10px;">' +
                '<button id="editorImportLogo" style="width:100%;padding:9px;border:2px dashed #1a3c6e;border-radius:6px;background:#f0f4f8;cursor:pointer;font-size:13px;font-weight:600;color:#1a3c6e;">📷 上传 Logo（自动存入 logo/ 文件夹）</button>' +
                '<input type="file" id="editorLogoInput" accept="image/*" style="display:none;">' +
            '</div>' +
            '<div style="margin-bottom:10px;">' +
                '<label style="font-size:11px;color:#888;display:block;margin-bottom:4px;font-weight:600;">🖼️ Logo 样式（logo/ 文件夹）</label>' +
                '<select id="editorLogoSource" style="width:100%;padding:7px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;cursor:pointer;box-sizing:border-box;"></select>' +
                '<button id="editorOpenLogoDir" style="width:100%;margin-top:6px;padding:6px;border:1px solid #6c757d;border-radius:6px;background:#f8f9fa;cursor:pointer;font-size:11px;color:#495057;">📂 打开 Logo 文件夹（可直接放入图片）</button>' +
            '</div>' +
            '<div id="editorLogoPreview" style="margin-bottom:10px;text-align:center;"></div>' +

            '<div style="margin-bottom:10px;">' +
                '<button id="editorResetLayout" style="width:100%;padding:8px;border:1px solid #ffc107;border-radius:6px;background:#fffdf0;cursor:pointer;font-size:13px;color:#856404;">🔄 重置为默认布局</button>' +
            '</div>' +
            '<div style="display:flex;gap:6px;margin-bottom:10px;">' +
                '<button id="editorExportLayout" style="flex:1;padding:8px;border:1px solid #17a2b8;border-radius:6px;background:#f0f9fb;cursor:pointer;font-size:12px;color:#17a2b8;">📤 导出布局</button>' +
                '<button id="editorImportLayout" style="flex:1;padding:8px;border:1px solid #17a2b8;border-radius:6px;background:#f0f9fb;cursor:pointer;font-size:12px;color:#17a2b8;">📥 导入布局</button>' +
                '<input type="file" id="editorLayoutInput" accept=".json" style="display:none;">' +
            '</div>' +
            '<div style="margin-bottom:10px;">' +
                '<button id="editorRemoveLogo" style="width:100%;padding:8px;border:1px solid #dc3545;border-radius:6px;background:#fff5f5;cursor:pointer;font-size:13px;color:#dc3545;">↩️ 恢复默认 Logo（不删除文件）</button>' +
            '</div>' +
            '<hr style="border:none;border-top:1px solid #eee;margin:14px 0;">' +
            '<div style="font-size:12px;color:#888;line-height:1.8;">' +
                '💡 <strong>操作提示</strong>：<br>' +
                '• 拖拽元素 → 调整位置<br>' +
                '• 点击元素 → 精确输入坐标/调整粗细<br>' +
                '• 拖拽 <span style="color:#4a90d9;">▪</span> → 调整字号<br>' +
                '• 拖拽 Logo <span style="color:#e67e22;">▪</span> → 右下角等比缩放，<br>' +
                '&nbsp;&nbsp;右/下中点手柄 → 横向/竖向拉伸<br>' +
                '• Logo 右上角 <span style="color:#17a2b8;">↺</span> → 还原默认尺寸<br>' +
                '• Logo 图片统一存放在 logo/ 文件夹，<br>' +
                '&nbsp;&nbsp;上传的图片也会自动存入其中<br>' +
                '• 拖拽时自动显示对齐线<br>' +
                '• <strong>Ctrl+Z</strong> 撤销 / <strong>Ctrl+Y</strong> 重做<br>' +
                '• 导出/导入布局 → JSON 文件备份' +
            '</div>' +
            '<hr style="border:none;border-top:1px solid #eee;margin:14px 0;">' +
            '<div style="display:flex;gap:8px;">' +
                '<button id="editorCancel" style="flex:1;padding:9px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">取消</button>' +
                '<button id="editorSave" style="flex:1;padding:9px;border:none;border-radius:6px;background:#1a3c6e;color:#fff;cursor:pointer;font-size:13px;font-weight:600;">💾 保存</button>' +
            '</div>';
        rightPanel.appendChild(toolPanel);

        // 属性面板
        _propPanel = document.createElement('div');
        _propPanel.id = 'editorPropPanel';
        _propPanel.style.cssText = 'background:#fff;border-radius:10px;padding:18px;width:220px;box-shadow:0 4px 16px rgba(0,0,0,0.2);display:none;';
        rightPanel.appendChild(_propPanel);

        mainWrap.appendChild(rightPanel);

        // 工具面板事件
        toolPanel.querySelector('#editorUndo').onclick = function() { _undo(); };
        toolPanel.querySelector('#editorRedo').onclick = function() { _redo(); };
        toolPanel.querySelector('#editorImportLogo').onclick = function() { toolPanel.querySelector('#editorLogoInput').click(); };
        toolPanel.querySelector('#editorLogoInput').onchange = function(e) { _importLogo(e.target.files[0]); };
        var logoSourceSel = toolPanel.querySelector('#editorLogoSource');
        _updateLogoSourceSelect(logoSourceSel);
        logoSourceSel.onchange = function() {
            _saveUndoState();
            if (!_positions.logo) _positions.logo = {};
            _positions.logo.source = this.value;
            _renderCanvas();
            _showLogoPreview(toolPanel.querySelector('#editorLogoPreview'));
        };
        toolPanel.querySelector('#editorOpenLogoDir').onclick = function() {
            if (typeof LogoStore !== 'undefined' && LogoStore.openLogoFolder()) {
                if (typeof UI !== 'undefined') UI.toast('已打开 Logo 文件夹，放入图片后重新打开编辑器即可选择', 'info', 2500);
            } else if (typeof UI !== 'undefined') {
                UI.toast('无法打开文件夹', 'warning');
            }
        };
        toolPanel.querySelector('#editorResetLayout').onclick = function() {
            _saveUndoState();
            _positions = _getDefaults();
            _selectedKey = '';
            _hidePropPanel();
            _renderCanvas();
            if (typeof UI !== 'undefined') UI.toast('布局已重置', 'info', 1500);
        };
        toolPanel.querySelector('#editorRemoveLogo').onclick = function() { _removeLogo(); _renderCanvas(); };
        toolPanel.querySelector('#editorExportLayout').onclick = function() { _exportLayout(); };
        toolPanel.querySelector('#editorImportLayout').onclick = function() { toolPanel.querySelector('#editorLayoutInput').click(); };
        toolPanel.querySelector('#editorLayoutInput').onchange = function(e) { _importLayout(e.target.files[0]); };
        toolPanel.querySelector('#editorCancel').onclick = close;
        toolPanel.querySelector('#editorSave').onclick = function() { _saveLayout(); };

        _showLogoPreview(toolPanel.querySelector('#editorLogoPreview'));
    }

    // ========== 属性面板 ==========

    function _showPropPanel(key) {
        _selectedKey = key;
        var pos = _positions[key];
        if (!pos) { _hidePropPanel(); return; }

        var isText = key !== 'logo' && key !== 'qr';
        var isLogo = key === 'logo';
        var isQR = key === 'qr';

        var html = '<div style="font-size:14px;font-weight:700;color:#1a3c6e;margin-bottom:12px;">🎨 元素属性</div>';

        // 精确位置输入（所有元素通用）
        var labelW = APP_CONFIG.labelWidth;
        var labelH = APP_CONFIG.labelHeight;
        html += '<div style="background:#f8f9fa;border-radius:6px;padding:10px;margin-bottom:12px;">' +
            '<div style="font-size:11px;color:#888;margin-bottom:6px;font-weight:600;">📍 位置 (mm)</div>' +
            '<div style="display:flex;gap:8px;">' +
                '<div style="flex:1;">' +
                    '<label style="font-size:10px;color:#999;">X</label>' +
                    '<input type="number" id="propPosX" value="' + (pos.x || 0).toFixed(1) + '" min="0" max="' + labelW + '" step="0.5" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;font-size:12px;box-sizing:border-box;">' +
                '</div>' +
                '<div style="flex:1;">' +
                    '<label style="font-size:10px;color:#999;">Y</label>' +
                    '<input type="number" id="propPosY" value="' + (pos.y || 0).toFixed(1) + '" min="0" max="' + labelH + '" step="0.5" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;font-size:12px;box-sizing:border-box;">' +
                '</div>';
        if (isLogo) {
            html += '<div style="flex:1;">' +
                    '<label style="font-size:10px;color:#999;">宽</label>' +
                    '<input type="number" id="propSizeW" value="' + (pos.width || DEF_LOGO_W).toFixed(1) + '" min="2" max="50" step="0.5" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;font-size:12px;box-sizing:border-box;">' +
                '</div>' +
                '<div style="flex:1;">' +
                    '<label style="font-size:10px;color:#999;">高</label>' +
                    '<input type="number" id="propSizeH" value="' + (pos.height || DEF_LOGO_H).toFixed(1) + '" min="2" max="50" step="0.5" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;font-size:12px;box-sizing:border-box;">' +
                '</div>';
        }
        html += '</div></div>';

        if (isText) {
            html += '<div style="margin-bottom:10px;">' +
                '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
                    '<div style="flex:1;">' +
                        '<label style="display:block;font-size:11px;color:#888;margin-bottom:3px;">字号 (px)</label>' +
                        '<input type="number" id="propFontSize" value="' + (pos.fontSize || DEF_FIELD_FS) + '" min="' + MIN_FONT + '" max="' + MAX_FONT + '" step="1" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;font-size:12px;box-sizing:border-box;">' +
                    '</div>' +
                    '<div style="flex:1;">' +
                        '<label style="display:block;font-size:11px;color:#888;margin-bottom:3px;">字体粗细</label>' +
                        '<select id="propFontWeight" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:4px;font-size:12px;cursor:pointer;box-sizing:border-box;">' +
                            '<option value="400"' + ((pos.fontWeight || '400') === '400' ? ' selected' : '') + '>常规</option>' +
                            '<option value="600"' + ((pos.fontWeight || '400') === '600' ? ' selected' : '') + '>中等粗</option>' +
                            '<option value="700"' + ((pos.fontWeight || '400') === '700' ? ' selected' : '') + '>粗体</option>' +
                            '<option value="900"' + ((pos.fontWeight || '400') === '900' ? ' selected' : '') + '>特粗</option>' +
                        '</select>' +
                    '</div>' +
                '</div>' +
                '<div style="margin-bottom:8px;">' +
                    '<label style="display:block;font-size:11px;color:#888;margin-bottom:3px;">字体</label>' +
                    '<select id="propFontFamily" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:4px;font-size:12px;cursor:pointer;box-sizing:border-box;">';
            for (var fi = 0; fi < APP_CONFIG.fonts.length; fi++) {
                var fn = APP_CONFIG.fonts[fi].name;
                var sel = ((pos.fontFamily || APP_CONFIG.defaultFont) === fn) ? ' selected' : '';
                html += '<option value="' + fn + '"' + sel + '>' + fn + '</option>';
            }
            html += '</select>' +
                '</div>' +
                '</div>';
        }

        if (isLogo) {
            html += '<div style="margin-bottom:10px;">' +
                '<button id="propResetLogoSize" style="width:100%;padding:8px;border:1px solid #17a2b8;border-radius:6px;background:#f0f9fb;cursor:pointer;font-size:12px;color:#17a2b8;">↺ 还原默认尺寸 (' + DEF_LOGO_W + '×' + DEF_LOGO_H + 'mm)</button>' +
                '</div>';
            html += '<div style="font-size:12px;color:#888;line-height:1.6;">' +
                '💡 右下角橙色手柄 → 等比缩放<br>右侧/底部中点手柄 → 横向/竖向拉伸<br>' +
                '右上角 ↺ → 还原默认尺寸；Logo 样式可在左侧工具面板切换' +
                '</div>';
        }

        if (isQR) {
            html += '<div style="font-size:12px;color:#888;line-height:1.6;">' +
                '📐 二维码尺寸：' + APP_CONFIG.qrSize + ' × ' + APP_CONFIG.qrSize + ' mm' +
                '</div>';
        }

        _propPanel.innerHTML = html;
        _propPanel.style.display = 'block';

        // 绑定位置输入事件
        var posX = _propPanel.querySelector('#propPosX');
        var posY = _propPanel.querySelector('#propPosY');
        if (posX) posX.onchange = function() {
            _saveUndoState();
            pos.x = parseFloat(this.value) || 0;
            _renderCanvas();
        };
        if (posY) posY.onchange = function() {
            _saveUndoState();
            pos.y = parseFloat(this.value) || 0;
            _renderCanvas();
        };
        // Logo 尺寸输入
        var sizeW = _propPanel.querySelector('#propSizeW');
        var sizeH = _propPanel.querySelector('#propSizeH');
        if (sizeW) sizeW.onchange = function() {
            _saveUndoState();
            pos.width = parseFloat(this.value) || DEF_LOGO_W;
            _renderCanvas();
        };
        if (sizeH) sizeH.onchange = function() {
            _saveUndoState();
            pos.height = parseFloat(this.value) || DEF_LOGO_H;
            _renderCanvas();
        };
        var resetLogoBtn = _propPanel.querySelector('#propResetLogoSize');
        if (resetLogoBtn) resetLogoBtn.onclick = function() { _resetLogoSize(); };

        if (isText) {
            var fontSizeInput = _propPanel.querySelector('#propFontSize');
            if (fontSizeInput) fontSizeInput.onchange = function() {
                _saveUndoState();
                pos.fontSize = _constrain(parseInt(this.value) || DEF_FIELD_FS, MIN_FONT, MAX_FONT);
                this.value = pos.fontSize;
                _renderCanvas();
            };
            var weightSelect = _propPanel.querySelector('#propFontWeight');
            if (weightSelect) weightSelect.onchange = function() {
                _saveUndoState();
                pos.fontWeight = this.value;
                _renderCanvas();
                _showPropPanel(key);
            };
            var familySelect = _propPanel.querySelector('#propFontFamily');
            if (familySelect) familySelect.onchange = function() {
                _saveUndoState();
                pos.fontFamily = this.value;
                _renderCanvas();
                _showPropPanel(key);
            };
        }
    }

    function _hidePropPanel() {
        _selectedKey = '';
        if (_propPanel) {
            _propPanel.style.display = 'none';
            _propPanel.innerHTML = '';
        }
    }

    // ========== 画布渲染 ==========

    function _renderCanvas() {
        var canvas = document.getElementById('editorCanvas');
        if (!canvas) return;

        var lw = APP_CONFIG.labelWidth;
        var lh = APP_CONFIG.labelHeight;
        var S = SCALE;
        var fields = (typeof Settings !== 'undefined') ? Settings.getVisibleFields() : APP_CONFIG.fields;
        var sampleData = { code: '130015000242', name: '货架', dept: '设计制版实验室', model: '1800*60*30', date: '2024/01/15', person: '赵威' };

        var html = '';

        // 网格
        html += '<svg style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;opacity:0.15;">';
        for (var gx = 10; gx < lw; gx += 10) html += '<line x1="' + (gx * S) + '" y1="0" x2="' + (gx * S) + '" y2="' + (lh * S) + '" stroke="#999" stroke-width="0.5"/>';
        for (var gy = 10; gy < lh; gy += 10) html += '<line x1="0" y1="' + (gy * S) + '" x2="' + (lw * S) + '" y2="' + (gy * S) + '" stroke="#999" stroke-width="0.5"/>';
        html += '</svg>';

        // 对齐辅助线容器
        html += '<svg id="alignGuidesSvg" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;"></svg>';

        // ---- Logo ----
        var logoSrc = _localLogoSource();
        var lp = _positions.logo || { x: 4, y: 3, width: DEF_LOGO_W, height: DEF_LOGO_H };
        var logoWPx = (lp.width || DEF_LOGO_W) * S;
        var logoHPx = (lp.height || DEF_LOGO_H) * S;
        var logoSelected = _selectedKey === 'logo';
        html += '<div class="ed-el" data-key="logo" data-type="logo" style="position:absolute;left:' + (lp.x * S) + 'px;top:' + (lp.y * S) + 'px;' +
            'width:' + logoWPx + 'px;height:' + logoHPx + 'px;cursor:move;' +
            'border:1px dashed ' + (logoSelected ? '#e74c3c' : 'transparent') + ';border-radius:3px;user-select:none;overflow:visible;">' +
            '<img src="' + logoSrc + '" style="width:100%;height:100%;object-fit:fill;display:block;pointer-events:none;" onerror="this.style.visibility=\'hidden\'">' +
            '<div class="logo-reset" title="还原默认尺寸" style="position:absolute;top:-6px;right:-6px;width:14px;height:14px;background:#17a2b8;border:1px solid #fff;border-radius:2px;cursor:pointer;z-index:5;font-size:9px;color:#fff;line-height:13px;text-align:center;">↺</div>' +
            '<div class="logo-resize" title="等比缩放" style="position:absolute;bottom:-5px;right:-5px;width:12px;height:12px;background:#e67e22;border:1px solid #fff;border-radius:2px;cursor:nwse-resize;z-index:5;"></div>' +
            '<div class="logo-resize-x" title="横向拉伸" style="position:absolute;top:50%;right:-5px;margin-top:-6px;width:10px;height:12px;background:#e67e22;border:1px solid #fff;border-radius:2px;cursor:ew-resize;z-index:5;"></div>' +
            '<div class="logo-resize-y" title="竖向拉伸" style="position:absolute;left:50%;bottom:-5px;margin-left:-6px;width:12px;height:10px;background:#e67e22;border:1px solid #fff;border-radius:2px;cursor:ns-resize;z-index:5;"></div>' +
            '</div>';

        // ---- 公司名称 ----
        var cp = _positions.company || { x: 16, y: 3, fontSize: DEF_COMPANY_FS, fontWeight: '700', fontFamily: APP_CONFIG.defaultFont };
        var cfs = cp.fontSize || DEF_COMPANY_FS;
        var cWeight = cp.fontWeight || '700';
        var cFamily = APP_CONFIG.getFontCss(cp.fontFamily);
        var cpSelected = _selectedKey === 'company';
        html += '<div class="ed-el" data-key="company" data-type="text" style="position:absolute;left:' + (cp.x * S) + 'px;top:' + (cp.y * S) + 'px;' +
            'font-family:' + cFamily + ';font-weight:' + cWeight + ';font-size:' + cfs + 'px;color:#000000;white-space:nowrap;cursor:move;' +
            'padding:2px 6px;border:1px dashed ' + (cpSelected ? '#e74c3c' : 'transparent') + ';border-radius:3px;user-select:none;">' +
            _esc(APP_CONFIG.companyName) +
            '<div class="resize-handle" style="position:absolute;bottom:-4px;right:-4px;width:10px;height:10px;background:#4a90d9;border-radius:2px;cursor:ns-resize;opacity:0;transition:opacity 0.15s;"></div>' +
            '</div>';

        // ---- 字段 ----
        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            var fk = 'field_' + f.key;
            var fp = _positions[fk] || { x: 4, y: 12 + i * 5.5, fontSize: DEF_FIELD_FS, fontWeight: '400', fontFamily: APP_CONFIG.defaultFont };
            var ffs = fp.fontSize || DEF_FIELD_FS;
            var fWeight = fp.fontWeight || '400';
            var fFamily = APP_CONFIG.getFontCss(fp.fontFamily);
            var val = sampleData[f.key] || '';
            var fpSelected = _selectedKey === fk;
            html += '<div class="ed-el" data-key="' + fk + '" data-type="text" style="position:absolute;left:' + (fp.x * S) + 'px;top:' + (fp.y * S) + 'px;' +
                'font-family:' + fFamily + ';font-size:' + ffs + 'px;color:#000000;font-weight:' + fWeight + ';white-space:nowrap;cursor:move;padding:1px 4px;' +
                'border:1px dashed ' + (fpSelected ? '#e74c3c' : 'transparent') + ';border-radius:3px;user-select:none;">' +
                '<span style="color:#555;font-weight:600;">' + _esc(f.label) + '：</span>' +
                '<span style="color:inherit;">' + _esc(val) + '</span>' +
                '<div class="resize-handle" style="position:absolute;bottom:-4px;right:-4px;width:10px;height:10px;background:#4a90d9;border-radius:2px;cursor:ns-resize;opacity:0;transition:opacity 0.15s;"></div>' +
                '</div>';
        }

        // ---- 二维码 ----
        var qp = _positions.qr || { x: lw - APP_CONFIG.qrSize - 3, y: lh - APP_CONFIG.qrSize - 5 };
        var qrS = APP_CONFIG.qrSize * S;
        var qrSelected = _selectedKey === 'qr';
        html += '<div class="ed-el" data-key="qr" data-type="qr" style="position:absolute;left:' + (qp.x * S) + 'px;top:' + (qp.y * S) + 'px;' +
            'width:' + qrS + 'px;height:' + qrS + 'px;cursor:move;border:1px dashed ' + (qrSelected ? '#e74c3c' : 'transparent') + ';border-radius:3px;' +
            'background:#f8f8f8;display:flex;align-items:center;justify-content:center;user-select:none;">' +
            '<span style="font-size:10px;color:#aaa;pointer-events:none;">QR</span></div>';

        canvas.innerHTML = html;

        // 绑定事件
        canvas.querySelectorAll('.ed-el').forEach(function(el) {
            var type = el.getAttribute('data-type');
            var key = el.getAttribute('data-key');

            // 点击选中 → 显示属性面板
            el.addEventListener('mousedown', function(e) {
                if (e.target.classList.contains('resize-handle') || e.target.classList.contains('logo-resize') ||
                    e.target.classList.contains('logo-resize-x') || e.target.classList.contains('logo-resize-y') ||
                    e.target.classList.contains('logo-reset')) return;
                _showPropPanel(key);
            });

            // 拖拽
            el.addEventListener('mousedown', _onDragStart);
            el.addEventListener('mouseenter', function() {
                if (_selectedKey !== key) this.style.borderColor = '#4a90d9';
                _showHandles(this, true);
            });
            el.addEventListener('mouseleave', function() {
                if ((_drag.active && _drag.el === this) || _selectedKey === key) return;
                this.style.borderColor = 'transparent';
                _showHandles(this, false);
            });

            var handle = el.querySelector('.resize-handle');
            if (handle) handle.addEventListener('mousedown', _onResizeStart);
            var logoHandle = el.querySelector('.logo-resize');
            if (logoHandle) logoHandle.addEventListener('mousedown', function(e) { _onLogoResizeStart(e, 'both'); });
            var logoHandleX = el.querySelector('.logo-resize-x');
            if (logoHandleX) logoHandleX.addEventListener('mousedown', function(e) { _onLogoResizeStart(e, 'x'); });
            var logoHandleY = el.querySelector('.logo-resize-y');
            if (logoHandleY) logoHandleY.addEventListener('mousedown', function(e) { _onLogoResizeStart(e, 'y'); });
            var logoResetHandle = el.querySelector('.logo-reset');
            if (logoResetHandle) logoResetHandle.addEventListener('mousedown', function(e) {
                if (e.button !== 0) return;
                e.preventDefault(); e.stopPropagation();
                _resetLogoSize();
            });
        });
    }

    function _showHandles(el, show) {
        var handles = el.querySelectorAll('.resize-handle, .logo-resize, .logo-resize-x, .logo-resize-y, .logo-reset');
        handles.forEach(function(h) { h.style.opacity = show ? '0.8' : '0'; });
    }

    // ========== 对齐辅助线计算 ==========

    function _collectEdges(skipKey) {
        var edges = [];
        var S = SCALE;
        var keys = ['logo', 'company', 'qr'];
        var fields = (typeof Settings !== 'undefined') ? Settings.getVisibleFields() : APP_CONFIG.fields;
        for (var i = 0; i < fields.length; i++) keys.push('field_' + fields[i].key);

        for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            if (key === skipKey) continue;
            var p = _positions[key];
            if (!p) continue;
            var el = document.querySelector('[data-key="' + key + '"]');
            if (!el) continue;
            var w = el.offsetWidth / S;
            var h = el.offsetHeight / S;
            edges.push({
                key: key,
                left: p.x, right: p.x + w, cx: p.x + w / 2,
                top: p.y, bottom: p.y + h, cy: p.y + h / 2
            });
        }
        return edges;
    }

    function _calcAlignGuides(dragKey, dragX, dragY, dragW, dragH) {
        var guides = [];
        var edges = _collectEdges(dragKey);
        var curLeft = dragX, curRight = dragX + dragW, curCx = dragX + dragW / 2;
        var curTop = dragY, curBottom = dragY + dragH, curCy = dragY + dragH / 2;
        var T = ALIGN_THRESHOLD / SCALE; // 转换为 mm 阈值
        var snapResult = { x: null, y: null };

        for (var i = 0; i < edges.length; i++) {
            var e = edges[i];
            // 垂直对齐线（x 坐标匹配）
            var vPairs = [
                [curLeft, e.left], [curLeft, e.right], [curLeft, e.cx],
                [curRight, e.left], [curRight, e.right], [curRight, e.cx],
                [curCx, e.left], [curCx, e.right], [curCx, e.cx]
            ];
            for (var vi = 0; vi < vPairs.length; vi++) {
                if (Math.abs(vPairs[vi][0] - vPairs[vi][1]) < T) {
                    guides.push({ type: 'v', pos: vPairs[vi][1] });
                    if (snapResult.x === null) snapResult.x = vPairs[vi][1] - (vPairs[vi][0] - dragX);
                }
            }
            // 水平对齐线（y 坐标匹配）
            var hPairs = [
                [curTop, e.top], [curTop, e.bottom], [curTop, e.cy],
                [curBottom, e.top], [curBottom, e.bottom], [curBottom, e.cy],
                [curCy, e.top], [curCy, e.bottom], [curCy, e.cy]
            ];
            for (var hi = 0; hi < hPairs.length; hi++) {
                if (Math.abs(hPairs[hi][0] - hPairs[hi][1]) < T) {
                    guides.push({ type: 'h', pos: hPairs[hi][1] });
                    if (snapResult.y === null) snapResult.y = hPairs[hi][1] - (hPairs[hi][0] - dragY);
                }
            }
        }
        return { guides: guides, snap: snapResult };
    }

    function _drawGuides(guides) {
        var svg = document.getElementById('alignGuidesSvg');
        if (!svg) return;
        var S = SCALE;
        var lw = APP_CONFIG.labelWidth;
        var lh = APP_CONFIG.labelHeight;
        var html = '';
        // 去重
        var seen = {};
        for (var i = 0; i < guides.length; i++) {
            var g = guides[i];
            var gKey = g.type + '_' + g.pos.toFixed(1);
            if (seen[gKey]) continue;
            seen[gKey] = true;
            if (g.type === 'v') {
                var x = g.pos * S;
                html += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + (lh * S) + '" stroke="#ff4444" stroke-width="1" stroke-dasharray="4,3" opacity="0.7"/>';
            } else {
                var y = g.pos * S;
                html += '<line x1="0" y1="' + y + '" x2="' + (lw * S) + '" y2="' + y + '" stroke="#ff4444" stroke-width="1" stroke-dasharray="4,3" opacity="0.7"/>';
            }
        }
        svg.innerHTML = html;
    }

    function _clearGuides() {
        var svg = document.getElementById('alignGuidesSvg');
        if (svg) svg.innerHTML = '';
    }

    // ========== 拖拽引擎 ==========

    function _onDragStart(e) {
        if (e.target.classList.contains('resize-handle') || e.target.classList.contains('logo-resize') ||
            e.target.classList.contains('logo-resize-x') || e.target.classList.contains('logo-resize-y') ||
            e.target.classList.contains('logo-reset') ||
            e.target.classList.contains('line-resize')) return;
        if (e.button !== 0) return;
        e.preventDefault();
        var el = e.currentTarget;
        _drag.active = true;
        _saveUndoState(); // 拖拽前保存状态
        _drag.el = el;
        _drag.key = el.getAttribute('data-key');
        _drag.startMX = e.clientX;
        _drag.startMY = e.clientY;
        _drag.startEX = parseFloat(el.style.left) || 0;
        _drag.startEY = parseFloat(el.style.top) || 0;
        el.style.borderColor = '#e74c3c';
        el.style.zIndex = '10';
        el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
        document.addEventListener('mousemove', _onDragMove);
        document.addEventListener('mouseup', _onDragEnd);
    }

    function _onDragMove(e) {
        if (!_drag.active) return;
        e.preventDefault();
        var dx = e.clientX - _drag.startMX;
        var dy = e.clientY - _drag.startMY;
        var newX = _drag.startEX + dx;
        var newY = _drag.startEY + dy;

        var elW = _drag.el.offsetWidth / SCALE;
        var elH = _drag.el.offsetHeight / SCALE;
        var xMm = _constrain(newX / SCALE, 0, APP_CONFIG.labelWidth - elW);
        var yMm = _constrain(newY / SCALE, 0, APP_CONFIG.labelHeight - elH);

        // 对齐检测与吸附
        var result = _calcAlignGuides(_drag.key, xMm, yMm, elW, elH);
        if (result.snap.x !== null) xMm = _constrain(result.snap.x, 0, APP_CONFIG.labelWidth - elW);
        if (result.snap.y !== null) yMm = _constrain(result.snap.y, 0, APP_CONFIG.labelHeight - elH);

        _drag.el.style.left = (xMm * SCALE) + 'px';
        _drag.el.style.top = (yMm * SCALE) + 'px';
        _drawGuides(result.guides);

        // 更新位置数据
        var key = _drag.key;
        if (!_positions[key]) _positions[key] = {};
        _positions[key].x = Math.round(xMm * 10) / 10;
        _positions[key].y = Math.round(yMm * 10) / 10;
    }

    function _onDragEnd() {
        if (!_drag.active) return;
        if (_drag.el) {
            _drag.el.style.borderColor = _selectedKey === _drag.key ? '#e74c3c' : 'transparent';
            _drag.el.style.zIndex = '';
            _drag.el.style.boxShadow = '';
        }
        _clearGuides();
        _drag.active = false;
        _drag.el = null;
        document.removeEventListener('mousemove', _onDragMove);
        document.removeEventListener('mouseup', _onDragEnd);
    }

    // ========== 字号调整 ==========

    function _onResizeStart(e) {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        var el = e.target.parentElement;
        _resize.active = true; _resize.el = el; _resize.key = el.getAttribute('data-key');
        _saveUndoState(); // 字号调整前保存状态
        _resize.startMY = e.clientY;
        var pos = _positions[_resize.key] || {};
        _resize.startFS = pos.fontSize || (_resize.key === 'company' ? DEF_COMPANY_FS : DEF_FIELD_FS);
        el.style.borderColor = '#e67e22'; el.style.zIndex = '10';
        document.addEventListener('mousemove', _onResizeMove);
        document.addEventListener('mouseup', _onResizeEnd);
    }

    function _onResizeMove(e) {
        if (!_resize.active) return; e.preventDefault();
        var dy = e.clientY - _resize.startMY;
        var newFS = _constrain(Math.round(_resize.startFS + dy / 3), MIN_FONT, MAX_FONT);
        _resize.el.style.fontSize = newFS + 'px';
        if (!_positions[_resize.key]) _positions[_resize.key] = {};
        _positions[_resize.key].fontSize = newFS;
    }

    function _onResizeEnd() {
        if (!_resize.active) return;
        if (_resize.el) { _resize.el.style.borderColor = _selectedKey === _resize.key ? '#e74c3c' : 'transparent'; _resize.el.style.zIndex = ''; }
        _resize.active = false; _resize.el = null;
        document.removeEventListener('mousemove', _onResizeMove);
        document.removeEventListener('mouseup', _onResizeEnd);
    }

    // ========== Logo 尺寸调整 ==========

    function _onLogoResizeStart(e, mode) {
        if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
        var el = e.target.parentElement;
        _logoResize.active = true; _logoResize.el = el; _logoResize.mode = mode || 'both';
        _saveUndoState(); // Logo 尺寸调整前保存状态
        _logoResize.startMX = e.clientX; _logoResize.startMY = e.clientY;
        var lp = _positions.logo || {};
        _logoResize.startW = lp.width || DEF_LOGO_W; _logoResize.startH = lp.height || DEF_LOGO_H;
        el.style.borderColor = '#e67e22'; el.style.zIndex = '10';
        document.addEventListener('mousemove', _onLogoResizeMove);
        document.addEventListener('mouseup', _onLogoResizeEnd);
    }

    function _onLogoResizeMove(e) {
        if (!_logoResize.active) return; e.preventDefault();
        var dx = e.clientX - _logoResize.startMX;
        var dy = e.clientY - _logoResize.startMY;
        var newW = _logoResize.startW;
        var newH = _logoResize.startH;
        if (_logoResize.mode === 'x') {
            // 仅横向拖拉：只改宽度
            newW = _constrain(Math.round((_logoResize.startW + dx / SCALE) * 10) / 10, 2, APP_CONFIG.labelWidth - 5);
        } else if (_logoResize.mode === 'y') {
            // 仅竖向拖拉：只改高度
            newH = _constrain(Math.round((_logoResize.startH + dy / SCALE) * 10) / 10, 2, APP_CONFIG.labelHeight - 5);
        } else {
            // 等比缩放（右下角手柄）
            var delta = Math.max(dx, dy) / SCALE;
            newW = _constrain(Math.round((_logoResize.startW + delta) * 10) / 10, 3, APP_CONFIG.labelWidth - 5);
            var ratio = _logoResize.startH / _logoResize.startW;
            newH = _constrain(Math.round(newW * ratio * 10) / 10, 2, APP_CONFIG.labelHeight - 5);
        }
        _logoResize.el.style.width = (newW * SCALE) + 'px';
        _logoResize.el.style.height = (newH * SCALE) + 'px';
        _positions.logo.width = newW; _positions.logo.height = newH;
    }

    function _onLogoResizeEnd() {
        if (!_logoResize.active) return;
        if (_logoResize.el) { _logoResize.el.style.borderColor = _selectedKey === 'logo' ? '#e74c3c' : 'transparent'; _logoResize.el.style.zIndex = ''; }
        _logoResize.active = false; _logoResize.el = null;
        document.removeEventListener('mousemove', _onLogoResizeMove);
        document.removeEventListener('mouseup', _onLogoResizeEnd);
    }

    // ========== 全局事件 ==========

    function _bindGlobalEvents() { document.addEventListener('keydown', _onKeyDown); }
    function _onKeyDown(e) {
        if (e.key === 'Escape' && _overlay) { close(); return; }
        if (!_overlay) return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); _undo(); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); _redo(); }
    }

    // ========== 撤销/重做 ==========

    function _saveUndoState() {
        _undoStack.push(JSON.stringify(_positions));
        if (_undoStack.length > MAX_UNDO) _undoStack.shift();
        _redoStack = []; // 新操作清空重做栈
    }

    function _undo() {
        if (_undoStack.length === 0) {
            if (typeof UI !== 'undefined') UI.toast('没有可撤销的操作', 'info', 1200);
            return;
        }
        _redoStack.push(JSON.stringify(_positions));
        _positions = JSON.parse(_undoStack.pop());
        _selectedKey = '';
        _hidePropPanel();
        _renderCanvas();
    }

    function _redo() {
        if (_redoStack.length === 0) {
            if (typeof UI !== 'undefined') UI.toast('没有可重做的操作', 'info', 1200);
            return;
        }
        _undoStack.push(JSON.stringify(_positions));
        _positions = JSON.parse(_redoStack.pop());
        _selectedKey = '';
        _hidePropPanel();
        _renderCanvas();
    }

    // ========== Logo 管理 ==========

    /**
     * 当前 Logo 样式选择：'default' | logo/ 目录内文件名 | 'custom'（旧版 base64）
     * 未显式设置时向后兼容：已上传旧版自定义则用自定义，否则默认
     */
    function _currentLogoChoice() {
        var custom = (typeof Settings !== 'undefined') ? Settings.getCustomLogo() : null;
        var sel = _positions.logo ? _positions.logo.source : null;
        if (sel) {
            if (sel === 'custom') return custom ? 'custom' : 'default'; // 旧版兼容
            return sel; // logo/ 目录文件名（含 logo.png）
        }
        return custom ? 'custom' : 'default';
    }

    /** 编辑中实时 Logo 来源（基于当前 _positions，未保存也能预览） */
    function _localLogoSource() {
        var custom = (typeof Settings !== 'undefined') ? Settings.getCustomLogo() : null;
        var sel = _positions.logo ? _positions.logo.source : null;
        if (!sel && custom) return custom; // 旧布局兼容
        if (typeof LogoStore !== 'undefined') return LogoStore.resolveLogoSource(sel, custom);
        return sel === 'custom' ? (custom || 'logo.png') : 'logo.png';
    }

    /** 同步工具面板 Logo 样式下拉框：动态列出 logo/ 目录中的图片文件 */
    function _updateLogoSourceSelect(sel) {
        if (!sel) return;
        var files = (typeof LogoStore !== 'undefined') ? LogoStore.listLogoFiles() : [];
        var choice = _currentLogoChoice();
        var html = '<option value="default">默认样式（系统默认）</option>';
        for (var i = 0; i < files.length; i++) {
            var f = files[i];
            var label = (f === 'logo.png') ? f + '（内置默认）' : f;
            html += '<option value="' + _escAttr(f) + '">' + _esc(label) + '</option>';
        }
        // 旧版 base64 自定义数据（localStorage）兼容项
        var custom = (typeof Settings !== 'undefined') ? Settings.getCustomLogo() : null;
        if (choice === 'custom' && custom) {
            html += '<option value="custom">自定义 Logo（旧版数据）</option>';
        }
        sel.innerHTML = html;
        sel.value = choice;
        if (sel.selectedIndex < 0) sel.value = 'default'; // 所选文件已不存在时回退
    }

    /** 还原 Logo 默认尺寸 */
    function _resetLogoSize() {
        _saveUndoState();
        if (!_positions.logo) _positions.logo = {};
        _positions.logo.width = DEF_LOGO_W;
        _positions.logo.height = DEF_LOGO_H;
        _renderCanvas();
        if (_selectedKey === 'logo') _showPropPanel('logo');
        if (typeof UI !== 'undefined') UI.toast('Logo 尺寸已还原为默认 ' + DEF_LOGO_W + '×' + DEF_LOGO_H + ' mm', 'success', 1500);
    }

    function _importLogo(file) {
        if (!file) return;
        if (!file.type.startsWith('image/')) { if (typeof UI !== 'undefined') UI.toast('请选择图片文件', 'warning'); return; }
        var reader = new FileReader();
        reader.onload = function(e) {
            var dataUrl = e.target.result;
            // 上传自动保存到 logo/ 子目录
            var savedName = (typeof LogoStore !== 'undefined') ? LogoStore.saveLogoFile(file.name, dataUrl) : null;
            _saveUndoState();
            if (!_positions.logo) _positions.logo = {};
            if (savedName) {
                _positions.logo.source = savedName; // 以文件名作为来源
            } else {
                // 文件系统不可用时回退旧版 base64 存储
                if (typeof Settings !== 'undefined') Settings.setCustomLogo(dataUrl);
                _positions.logo.source = 'custom';
            }
            _showLogoPreview(document.getElementById('editorLogoPreview'));
            _renderCanvas();
            _updateLogoSourceSelect(document.getElementById('editorLogoSource'));
            if (typeof UI !== 'undefined') UI.toast(savedName ? 'Logo 已保存至 logo/' + savedName : 'Logo 已导入', 'success', 2000);
        };
        reader.readAsDataURL(file);
    }

    function _removeLogo() {
        _saveUndoState();
        if (!_positions.logo) _positions.logo = {};
        _positions.logo.source = 'default'; // 切回默认样式，不删除 logo/ 目录文件
        if (typeof Settings !== 'undefined') Settings.setCustomLogo(null); // 清理旧版 base64 数据
        _showLogoPreview(document.getElementById('editorLogoPreview'));
        _renderCanvas();
        _updateLogoSourceSelect(document.getElementById('editorLogoSource'));
        if (typeof UI !== 'undefined') UI.toast('已恢复默认 Logo；如需删除文件请在 logo/ 文件夹中操作', 'info', 2500);
    }

    function _showLogoPreview(container) {
        if (!container) return;
        var src = _localLogoSource();
        var def = (typeof LogoStore !== 'undefined') ? LogoStore.getDefaultLogoPath() : 'logo.png';
        if (src && src !== def) {
            container.innerHTML = '<div style="font-size:11px;color:#888;margin-bottom:4px;">当前 Logo：</div>' +
                '<img src="' + src + '" style="max-width:180px;max-height:50px;border:1px solid #eee;border-radius:4px;">';
        } else {
            container.innerHTML = '<div style="font-size:11px;color:#aaa;">使用默认 Logo (' + def + ')</div>';
        }
    }

    function getLogoSource() {
        // 尊重已保存布局中的 Logo 样式选择（编辑器未打开时也生效）
        var custom = (typeof Settings !== 'undefined') ? Settings.getCustomLogo() : null;
        var layout = (typeof Settings !== 'undefined') ? Settings.getLayout() : null;
        var sel = (layout && layout.logo) ? layout.logo.source : null;
        if (!sel && custom) return custom; // 旧布局兼容
        if (typeof LogoStore !== 'undefined') return LogoStore.resolveLogoSource(sel, custom);
        return sel === 'custom' ? (custom || 'logo.png') : 'logo.png';
    }

    // ========== 布局导入/导出 ==========

    function _exportLayout() {
        try {
            var json = JSON.stringify(_positions, null, 2);
            var blob = new Blob([json], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = '标签布局_' + new Date().toISOString().slice(0, 10) + '.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            if (typeof UI !== 'undefined') UI.toast('布局已导出', 'success', 1500);
        } catch (e) {
            console.error('导出布局失败:', e);
            if (typeof UI !== 'undefined') UI.toast('导出失败：' + e.message, 'error', 3000);
        }
    }

    function _importLayout(file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var data = JSON.parse(e.target.result);
                if (typeof data !== 'object' || data === null) throw new Error('格式错误');
                _saveUndoState();
                _positions = data;
                _selectedKey = '';
                _hidePropPanel();
                _renderCanvas();
                if (typeof UI !== 'undefined') UI.toast('布局已导入', 'success', 1500);
            } catch (err) {
                console.error('导入布局失败:', err);
                if (typeof UI !== 'undefined') UI.toast('导入失败：文件格式不正确', 'error', 3000);
            }
        };
        reader.readAsText(file);
    }

    // ========== 保存 ==========

    function _saveLayout() {
        if (typeof Settings !== 'undefined') Settings.setLayout(_positions);
        close();
        if (_overlay && _overlay._onSave) _overlay._onSave();
        else if (typeof UI !== 'undefined') UI.toast('布局已保存', 'success');
    }

    // ========== 工具函数 ==========

    function _constrain(val, min, max) { return Math.max(min, Math.min(max, val)); }
    function _esc(str) { var d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }
    function _escAttr(str) { return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    return {
        open: open,
        close: close,
        getLogoSource: getLogoSource,
        getDefaultPositions: _getDefaults
    };
})();
