/**
 * UI 组件模块
 * 提供 Toast 提示、Modal 确认框、表格渲染等 UI 功能
 * 替代原生 alert/confirm，提升用户体验
 */
var UI = (function() {
    'use strict';

    // ========== Toast 提示 ==========

    var toastContainer = null;

    function _ensureContainer() {
        if (toastContainer) return;
        toastContainer = document.createElement('div');
        toastContainer.id = 'toastContainer';
        toastContainer.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;';
        document.body.appendChild(toastContainer);
    }

    /**
     * 显示 Toast 提示
     * @param {string} message - 提示内容
     * @param {string} [type='info'] - 类型: success/error/warning/info
     * @param {number} [duration=3000] - 显示时长（ms），0 表示不自动关闭
     */
    function toast(message, type, duration) {
        _ensureContainer();
        type = type || 'info';
        duration = duration !== undefined ? duration : 3000;

        var colors = {
            success: { bg: '#d4edda', border: '#28a745', text: '#155724', icon: '✅' },
            error:   { bg: '#f8d7da', border: '#dc3545', text: '#721c24', icon: '❌' },
            warning: { bg: '#fff3cd', border: '#ffc107', text: '#856404', icon: '⚠️' },
            info:    { bg: '#d1ecf1', border: '#17a2b8', text: '#0c5460', icon: 'ℹ️' }
        };
        var c = colors[type] || colors.info;

        var el = document.createElement('div');
        el.style.cssText = 'padding:12px 18px;border-radius:8px;border-left:4px solid ' + c.border +
            ';background:' + c.bg + ';color:' + c.text + ';font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.15);' +
            'transform:translateX(120%);transition:transform 0.3s ease;max-width:360px;word-break:break-all;';
        el.innerHTML = '<span style="margin-right:6px;">' + c.icon + '</span>' + message;

        toastContainer.appendChild(el);
        // 触发动画
        requestAnimationFrame(function() {
            el.style.transform = 'translateX(0)';
        });

        if (duration > 0) {
            setTimeout(function() {
                el.style.transform = 'translateX(120%)';
                setTimeout(function() { el.remove(); }, 300);
            }, duration);
        }

        return el;
    }

    // ========== Modal 确认框 ==========

    /**
     * 显示确认对话框
     * @param {string} title - 标题
     * @param {string} message - 内容
     * @param {Function} onConfirm - 确认回调
     * @param {Function} [onCancel] - 取消回调
     */
    function confirm(title, message, onConfirm, onCancel) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:99998;display:flex;align-items:center;justify-content:center;';

        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:12px;padding:28px 32px;min-width:320px;max-width:480px;box-shadow:0 12px 40px rgba(0,0,0,0.2);';
        box.innerHTML =
            '<div style="font-size:18px;font-weight:700;color:#1a3c6e;margin-bottom:12px;">' + title + '</div>' +
            '<div style="font-size:14px;color:#555;line-height:1.6;margin-bottom:24px;">' + message + '</div>' +
            '<div style="display:flex;justify-content:flex-end;gap:10px;">' +
                '<button class="modal-cancel" style="padding:8px 20px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">取消</button>' +
                '<button class="modal-confirm" style="padding:8px 20px;border:none;border-radius:6px;background:#1a3c6e;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">确认</button>' +
            '</div>';

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close() { overlay.remove(); }

        box.querySelector('.modal-cancel').onclick = function() { close(); if (onCancel) onCancel(); };
        box.querySelector('.modal-confirm').onclick = function() { close(); onConfirm(); };
        overlay.onclick = function(e) { if (e.target === overlay) { close(); if (onCancel) onCancel(); } };
    }

    // ========== 数据表格渲染 ==========

    /**
     * 渲染数据表格（支持排序、复选框）
     * @param {Array} items - 数据项数组
     * @param {Object} validation - 校验结果 {errors, warnings}
     * @param {Object} callbacks - 回调函数 {onEdit, onDelete, onSort, onSelect, onSelectAll}
     * @param {Object} [sortState] - 排序状态 {key, dir}
     * @param {Object} [selectedIndexes] - 选中索引 {idx: true}
     */
    function renderTable(items, validation, callbacks, sortState, selectedIndexes) {
        var tableWrap = document.getElementById('dataTableWrap');
        if (!tableWrap) return;

        sortState = sortState || { key: null, dir: 0 };
        selectedIndexes = selectedIndexes || {};

        if (items.length === 0) {
            tableWrap.innerHTML = '<div style="text-align:center;color:#999;padding:30px;">暂无数据，请录入或导入数据</div>';
            return;
        }

        var errorMap = {};
        var warnMap = {};
        if (validation) {
            (validation.errors || []).forEach(function(e) {
                if (!errorMap[e.index]) errorMap[e.index] = [];
                errorMap[e.index].push(e.message);
            });
            (validation.warnings || []).forEach(function(w) {
                if (!warnMap[w.index]) warnMap[w.index] = [];
                warnMap[w.index].push(w.message);
            });
        }

        var html = '<table class="data-table" id="dataTable">';
        html += '<thead><tr>';
        html += '<th style="width:36px;text-align:center;"><input type="checkbox" id="tblSelectAll" style="cursor:pointer;"></th>';
        html += '<th style="width:40px;">#</th>';
        APP_CONFIG.fieldOrder.forEach(function(f, fi) {
            var key = APP_CONFIG.fieldKeys[fi];
            var arrow = ' <span style="color:#ccc;font-size:10px;">⇅</span>';
            if (sortState.key === key) {
                arrow = sortState.dir === 1 ? ' <span style="color:#1a3c6e;font-size:10px;">▲</span>' : ' <span style="color:#1a3c6e;font-size:10px;">▼</span>';
            }
            html += '<th class="tbl-sort" data-sort="' + key + '" style="cursor:pointer;user-select:none;">' + f + arrow + '</th>';
        });
        html += '<th style="width:80px;">操作</th>';
        html += '</tr></thead><tbody>';

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var origIdx = item._idx !== undefined ? item._idx : i;
            var rowClass = errorMap[origIdx] ? ' class="row-error"' : (warnMap[origIdx] ? ' class="row-warn"' : '');
            var title = '';
            if (errorMap[origIdx]) title = ' title="' + errorMap[origIdx].join('\n') + '"';
            else if (warnMap[origIdx]) title = ' title="' + warnMap[origIdx].join('\n') + '"';
            var checked = selectedIndexes[origIdx] ? ' checked' : '';

            html += '<tr' + rowClass + title + ' data-index="' + origIdx + '">';
            html += '<td style="text-align:center;"><input type="checkbox" class="tbl-row-cb" data-index="' + origIdx + '"' + checked + ' style="cursor:pointer;"></td>';
            html += '<td>' + (origIdx + 1) + '</td>';
            APP_CONFIG.fieldKeys.forEach(function(key) {
                var val = item[key] || '';
                var cellClass = '';
                if (errorMap[origIdx] && errorMap[origIdx].some(function(m) { return m.indexOf(APP_CONFIG.fieldOrder[APP_CONFIG.fieldKeys.indexOf(key)]) > -1; })) {
                    cellClass = ' class="cell-error"';
                }
                html += '<td' + cellClass + ' data-field="' + key + '">' + _escapeHtml(val) + '</td>';
            });
            html += '<td>';
            html += '<button class="btn-tbl btn-tbl-edit" data-index="' + origIdx + '" title="编辑">✏️</button>';
            html += '<button class="btn-tbl btn-tbl-del" data-index="' + origIdx + '" title="删除">🗑️</button>';
            html += '</td>';
            html += '</tr>';
        }

        html += '</tbody></table>';
        tableWrap.innerHTML = html;

        // 绑定事件
        tableWrap.querySelectorAll('.btn-tbl-edit').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var idx = parseInt(this.getAttribute('data-index'));
                if (callbacks && callbacks.onEdit) callbacks.onEdit(idx);
            });
        });
        tableWrap.querySelectorAll('.btn-tbl-del').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var idx = parseInt(this.getAttribute('data-index'));
                if (callbacks && callbacks.onDelete) callbacks.onDelete(idx);
            });
        });

        // 双击编辑
        tableWrap.querySelectorAll('td[data-field]').forEach(function(td) {
            td.addEventListener('dblclick', function() {
                var tr = this.closest('tr');
                var idx = parseInt(tr.getAttribute('data-index'));
                if (callbacks && callbacks.onEdit) callbacks.onEdit(idx);
            });
        });

        // 排序点击
        tableWrap.querySelectorAll('.tbl-sort').forEach(function(th) {
            th.addEventListener('click', function() {
                var key = this.getAttribute('data-sort');
                if (callbacks && callbacks.onSort) callbacks.onSort(key);
            });
        });

        // 全选
        var selectAllCb = tableWrap.querySelector('#tblSelectAll');
        if (selectAllCb) {
            selectAllCb.addEventListener('change', function() {
                if (callbacks && callbacks.onSelectAll) callbacks.onSelectAll(this.checked);
            });
        }

        // 单行选择
        tableWrap.querySelectorAll('.tbl-row-cb').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var idx = parseInt(this.getAttribute('data-index'));
                if (callbacks && callbacks.onSelect) callbacks.onSelect(idx, this.checked);
            });
        });
    }

    /**
     * 显示行内编辑弹窗
     * @param {Object} item - 当前数据项
     * @param {number} index - 行索引
     * @param {Function} onSave - 保存回调
     */
    function showEditDialog(item, index, onSave) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:99998;display:flex;align-items:center;justify-content:center;';

        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:12px;padding:28px 32px;width:480px;max-width:92%;box-shadow:0 12px 40px rgba(0,0,0,0.2);';

        var fieldsHtml = '';
        APP_CONFIG.fieldOrder.forEach(function(label, fi) {
            var key = APP_CONFIG.fieldKeys[fi];
            var val = item[key] || '';
            fieldsHtml += '<div style="margin-bottom:12px;">' +
                '<label style="display:block;font-size:13px;font-weight:600;color:#555;margin-bottom:4px;">' + label + '</label>' +
                '<input type="text" class="edit-field" data-key="' + key + '" value="' + _escapeHtml(val) + '" ' +
                'style="width:100%;padding:8px 12px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;">' +
                '</div>';
        });

        box.innerHTML =
            '<div style="font-size:18px;font-weight:700;color:#1a3c6e;margin-bottom:16px;">编辑数据 <span style="font-size:13px;color:#999;font-weight:400;">第 ' + (index + 1) + ' 行</span></div>' +
            fieldsHtml +
            '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">' +
                '<button class="edit-cancel" style="padding:8px 20px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">取消</button>' +
                '<button class="edit-save" style="padding:8px 20px;border:none;border-radius:6px;background:#1a3c6e;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">保存</button>' +
            '</div>';

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close() { overlay.remove(); }

        box.querySelector('.edit-cancel').onclick = close;
        overlay.onclick = function(e) { if (e.target === overlay) close(); };
        box.querySelector('.edit-save').onclick = function() {
            var newItem = {};
            box.querySelectorAll('.edit-field').forEach(function(input) {
                newItem[input.getAttribute('data-key')] = input.value.trim();
            });
            newItem.date = Parser.formatDate(newItem.date);
            close();
            onSave(newItem);
        };

        // 聚焦第一个输入框
        var firstInput = box.querySelector('.edit-field');
        if (firstInput) setTimeout(function() { firstInput.focus(); }, 100);
    }

    // ========== 工具函数 ==========

    function _escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        toast: toast,
        confirm: confirm,
        renderTable: renderTable,
        showEditDialog: showEditDialog
    };
})();
