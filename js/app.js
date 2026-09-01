/**
 * 主应用逻辑 - 协调各模块完成业务流程
 * 职责：登录流程、数据管理、事件绑定、视图切换
 */
var App = (function() {
    'use strict';

    // 当前数据项
    var currentItems = [];

    // 选中项索引（用于部分选择）
    var selectedIndexes = {};

    // 自动保存函数
    var autoSave = null;

    // 授权状态
    var _isVerified = false;

    // 排序和搜索状态
    var _sortKey = null;
    var _sortDir = 0;  // 0=none, 1=asc, -1=desc
    var _searchQuery = '';
    var _displayItems = [];
    var _eventsBound = false;
    var _searchTimer = null; // 搜索防抖定时器

    // 虚拟滚动参数
    var VS = {
        cardW: 115,   // 卡片宽 + gap
        cardH: 80,    // 卡片高 + gap
        cols: 8,
        renderBuffer: 3  // 额外渲染的行数
    };

    // ========== 登录/退出 ==========

    function verify() {
        var input = document.getElementById('pwdInput').value.trim();
        var error = document.getElementById('errorMsg');

        if (Auth.verify(input)) {
            _isVerified = true;
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('mainApp').style.display = 'block';
            _restoreData();
            setTimeout(function() { _refreshAll(); }, 100);
        } else {
            error.style.display = 'block';
            document.getElementById('pwdInput').value = '';
            document.getElementById('pwdInput').focus();
            setTimeout(function() { error.style.display = 'none'; }, 3000);
        }
    }

    function logout() {
        UI.confirm('退出确认', '确认退出当前账号？', function() {
            _isVerified = false;
            document.getElementById('mainApp').style.display = 'none';
            document.getElementById('loginPage').style.display = 'flex';
            document.getElementById('pwdInput').value = '';
            document.getElementById('errorMsg').style.display = 'none';
            document.getElementById('pwdInput').focus();
        });
    }

    // ========== 管理员取码 ==========

    /**
     * 通过管理员密钥取回当日授权码并展示在登录页
     */
    function fetchCode() {
        var keyEl = document.getElementById('adminKeyInput');
        var resultEl = document.getElementById('adminResult');
        if (!keyEl || !resultEl) return;

        var key = keyEl.value.trim();
        if (!key) {
            resultEl.className = 'admin-result fail';
            resultEl.textContent = '❌ 请输入管理员密钥';
            keyEl.focus();
            return;
        }

        // 调用 Auth 模块取码
        var code = Auth.get(key);
        if (code) {
            resultEl.className = 'admin-result success';
            resultEl.innerHTML =
                '<span>当日授权码：<code>' + _esc(code) + '</code></span>' +
                '<button class="copy-btn" onclick="App._copyCode(\'' + code + '\')">复制并填入</button>';
            keyEl.value = ''; // 用完即清,避免泄露
        } else {
            resultEl.className = 'admin-result fail';
            resultEl.textContent = '❌ 管理员密钥错误';
        }
    }

    /**
     * 复制授权码并自动填入登录框
     */
    function _copyCode(code) {
        var pwd = document.getElementById('pwdInput');
        if (pwd) {
            pwd.value = code;
            pwd.focus();
        }
        try { localStorage.setItem('clipboard_temp', code); } catch (e) {}
        UI.toast('已填入授权码', 'success', 1500);
    }

    // ========== 数据管理 ==========

    function _getDataText() {
        var el = document.getElementById('dataInput');
        return el ? el.value : '';
    }

    function _setDataText(text) {
        var el = document.getElementById('dataInput');
        if (el) el.value = text;
    }

    function _restoreData() {
        var saved = Storage.load(APP_CONFIG.storageKeys.data);
        if (saved && typeof saved === 'string') {
            _setDataText(saved);
        }
    }

    function _saveCurrentData() {
        Storage.save(APP_CONFIG.storageKeys.data, _getDataText());
    }

    /**
     * 从 textarea 解析数据并刷新所有视图
     */
    function _refreshAll() {
        var text = _getDataText();
        currentItems = Parser.parseText(text);
        _rebuildDisplay();
        _updateTable();
        _updatePreview();
        _updateStats();
        _updateBatchToolbar();
    }

    /**
     * 从 currentItems 同步回 textarea 并刷新视图
     */
    function _syncFromItems() {
        _setDataText(Parser.itemsToText(currentItems));
        _saveCurrentData();
        selectedIndexes = {};  // 数据变更后清空选择
        _rebuildDisplay();
        _updateTable();
        _updatePreview();
        _updateStats();
        _updateBatchToolbar();
    }

    // ========== 表格视图 ==========

    /**
     * 根据搜索和排序状态重建 _displayItems
     */
    function _rebuildDisplay() {
        var items = [];
        for (var i = 0; i < currentItems.length; i++) {
            var item = Object.assign({}, currentItems[i]);
            item._idx = i;
            if (_searchQuery) {
                var q = _searchQuery.toLowerCase();
                var match = false;
                for (var k = 0; k < APP_CONFIG.fieldKeys.length; k++) {
                    if ((item[APP_CONFIG.fieldKeys[k]] || '').toLowerCase().indexOf(q) > -1) {
                        match = true;
                        break;
                    }
                }
                if (!match) continue;
            }
            items.push(item);
        }
        if (_sortKey && _sortDir !== 0) {
            items.sort(function(a, b) {
                var va = a[_sortKey] || '';
                var vb = b[_sortKey] || '';
                var n = va.localeCompare(vb, 'zh-CN', { numeric: true });
                return n * _sortDir;
            });
        }
        _displayItems = items;
    }

    function _updateTable() {
        var validation = Parser.validate(currentItems);
        UI.renderTable(_displayItems, validation, {
            onEdit: _editItem,
            onDelete: _deleteItem,
            onSort: _onSort,
            onSelect: _onSelect,
            onSelectAll: _onSelectAll
        }, { key: _sortKey, dir: _sortDir }, selectedIndexes);
        // 更新搜索计数
        var sc = document.getElementById('searchCount');
        if (sc) {
            if (_searchQuery) {
                sc.textContent = '找到 ' + _displayItems.length + ' / ' + currentItems.length + ' 条';
            } else {
                sc.textContent = '';
            }
        }
    }

    function _onSort(key) {
        if (_sortKey === key) {
            _sortDir = _sortDir === 1 ? -1 : (_sortDir === -1 ? 0 : 1);
            if (_sortDir === 0) _sortKey = null;
        } else {
            _sortKey = key;
            _sortDir = 1;
        }
        _rebuildDisplay();
        _updateTable();
    }

    function _onSelect(index, checked) {
        if (checked) {
            selectedIndexes[index] = true;
        } else {
            delete selectedIndexes[index];
        }
        _updateSelectionCount();
        _updateBatchToolbar();
    }

    function _onSelectAll(checked) {
        for (var i = 0; i < _displayItems.length; i++) {
            var idx = _displayItems[i]._idx;
            if (checked) {
                selectedIndexes[idx] = true;
            } else {
                delete selectedIndexes[idx];
            }
        }
        _updateSelectionCount();
        _updateBatchToolbar();
        _updateTable();
    }

    function _updateBatchToolbar() {
        var count = Object.keys(selectedIndexes).length;
        var bar = document.getElementById('batchToolbar');
        if (bar) {
            bar.style.display = count > 0 ? 'flex' : 'none';
        }
        var bc = document.getElementById('batchCount');
        if (bc) bc.textContent = count;
        // 搜索栏显示
        var sb = document.getElementById('searchBar');
        if (sb) sb.style.display = currentItems.length > 0 ? 'block' : 'none';
    }

    function _editItem(index) {
        if (index < 0 || index >= currentItems.length) return;
        var item = currentItems[index];
        UI.showEditDialog(item, index, function(newItem) {
            currentItems[index] = newItem;
            _syncFromItems();
            UI.toast('已更新第 ' + (index + 1) + ' 行', 'success');
        });
    }

    function _deleteItem(index) {
        if (index < 0 || index >= currentItems.length) return;
        UI.confirm('删除确认', '确认删除第 ' + (index + 1) + ' 行数据？', function() {
            currentItems.splice(index, 1);
            _syncFromItems();
            UI.toast('已删除', 'success');
        });
    }

    // ========== 搜索 ==========

    function _onSearchInput() {
        var input = document.getElementById('searchInput');
        var clearBtn = document.getElementById('searchClear');
        _searchQuery = input ? input.value.trim() : '';
        if (clearBtn) clearBtn.style.display = _searchQuery ? 'block' : 'none';
        // 防抖 250ms
        if (_searchTimer) clearTimeout(_searchTimer);
        _searchTimer = setTimeout(function() {
            _rebuildDisplay();
            _updateTable();
        }, 250);
    }

    function _onSearchClear() {
        var input = document.getElementById('searchInput');
        if (input) input.value = '';
        _searchQuery = '';
        var clearBtn = document.getElementById('searchClear');
        if (clearBtn) clearBtn.style.display = 'none';
        _rebuildDisplay();
        _updateTable();
    }

    // ========== 批量操作 ==========

    function _batchDelete() {
        var keys = Object.keys(selectedIndexes);
        if (keys.length === 0) return;
        UI.confirm('批量删除', '确认删除已选中的 ' + keys.length + ' 条数据？', function() {
            var idxSet = {};
            keys.forEach(function(k) { idxSet[parseInt(k)] = true; });
            var newItems = [];
            for (var i = 0; i < currentItems.length; i++) {
                if (!idxSet[i]) newItems.push(currentItems[i]);
            }
            currentItems = newItems;
            selectedIndexes = {};
            _syncFromItems();
            UI.toast('已删除 ' + keys.length + ' 条', 'success');
        });
    }

    function _batchEdit() {
        var keys = Object.keys(selectedIndexes);
        if (keys.length === 0) return;

        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:99998;display:flex;align-items:center;justify-content:center;';
        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:12px;padding:28px 32px;width:480px;max-width:92%;box-shadow:0 12px 40px rgba(0,0,0,0.2);';

        var fieldsHtml = '';
        APP_CONFIG.fieldOrder.forEach(function(label, fi) {
            var key = APP_CONFIG.fieldKeys[fi];
            fieldsHtml += '<div style="margin-bottom:12px;">' +
                '<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#555;margin-bottom:4px;">' +
                    '<input type="checkbox" class="batch-check" data-key="' + key + '" style="cursor:pointer;"> ' + label +
                '</label>' +
                '<input type="text" class="batch-field" data-key="' + key + '" placeholder="留空则不修改" disabled style="width:100%;padding:8px 12px;border:1px solid #d0d7de;border-radius:6px;font-size:14px;background:#f5f5f5;">' +
                '</div>';
        });

        box.innerHTML =
            '<div style="font-size:18px;font-weight:700;color:#1a3c6e;margin-bottom:6px;">批量编辑</div>' +
            '<div style="font-size:13px;color:#888;margin-bottom:16px;">勾选要修改的字段，填写新值，将应用到 ' + keys.length + ' 条选中数据</div>' +
            fieldsHtml +
            '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">' +
                '<button class="batch-cancel" style="padding:8px 20px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">取消</button>' +
                '<button class="batch-apply" style="padding:8px 20px;border:none;border-radius:6px;background:#6f42c1;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">✅ 应用</button>' +
            '</div>';

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close() { overlay.remove(); }

        // 勾选启用输入
        box.querySelectorAll('.batch-check').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var key = this.getAttribute('data-key');
                var input = box.querySelector('.batch-field[data-key="' + key + '"]');
                if (input) {
                    input.disabled = !this.checked;
                    input.style.background = this.checked ? '#fff' : '#f5f5f5';
                    if (this.checked) input.focus();
                }
            });
        });

        box.querySelector('.batch-cancel').onclick = close;
        overlay.onclick = function(e) { if (e.target === overlay) close(); };
        box.querySelector('.batch-apply').onclick = function() {
            var changes = {};
            box.querySelectorAll('.batch-check').forEach(function(cb) {
                if (cb.checked) {
                    var key = cb.getAttribute('data-key');
                    var input = box.querySelector('.batch-field[data-key="' + key + '"]');
                    if (input) changes[key] = input.value.trim();
                }
            });
            if (Object.keys(changes).length === 0) {
                UI.toast('请至少勾选一个字段', 'warning');
                return;
            }
            // 应用到所有选中项
            keys.forEach(function(k) {
                var idx = parseInt(k);
                if (idx >= 0 && idx < currentItems.length) {
                    for (var ck in changes) {
                        if (changes.hasOwnProperty(ck)) {
                            currentItems[idx][ck] = changes[ck];
                        }
                    }
                }
            });
            selectedIndexes = {};
            close();
            _syncFromItems();
            UI.toast('已批量修改 ' + keys.length + ' 条数据', 'success');
        };
    }

    // ========== 虚拟滚动预览 ==========

    function _updatePreview() {
        var container = document.getElementById('labelPreview');
        var content = document.getElementById('vsContent');
        if (!container || !content) return;

        if (currentItems.length === 0) {
            content.innerHTML = '<div style="color:#999;padding:40px;text-align:center;width:100%;">📭 暂无数据</div>';
            container.scrollTop = 0;
            // 移除滚动监听
            container.onscroll = null;
            return;
        }

        // 计算列数
        var containerW = container.clientWidth - 20;
        VS.cols = Math.max(1, Math.floor(containerW / VS.cardW));
        var totalRows = Math.ceil(currentItems.length / VS.cols);

        // 设置虚拟滚动监听
        container.onscroll = function() { _renderVisible(); };

        _renderVisible();
    }

    function _renderVisible() {
        var container = document.getElementById('labelPreview');
        var content = document.getElementById('vsContent');
        if (!container || !content) return;
        if (currentItems.length === 0) return;

        var totalRows = Math.ceil(currentItems.length / VS.cols);
        var scrollTop = container.scrollTop;
        var viewH = container.clientHeight;

        var startRow = Math.max(0, Math.floor(scrollTop / VS.cardH) - VS.renderBuffer);
        var endRow = Math.min(totalRows - 1, Math.ceil((scrollTop + viewH) / VS.cardH) + VS.renderBuffer);

        var startIdx = startRow * VS.cols;
        var endIdx = Math.min(currentItems.length, (endRow + 1) * VS.cols);

        var html = '';

        // 顶部占位
        var topH = startRow * VS.cardH;
        if (topH > 0) {
            html += '<div style="width:100%;height:' + topH + 'px;flex-shrink:0;"></div>';
        }

        // 检查是否有自定义布局
        var customLayout = (typeof Settings !== 'undefined') ? Settings.getLayout() : null;
        var logoSrc = (typeof LabelEditor !== 'undefined') ? LabelEditor.getLogoSource() :
            ((typeof LogoStore !== 'undefined') ? LogoStore.getDefaultLogoPath() : 'logo/logo.png');
        // 编辑器内部坐标：x/y/width/height 为 mm，fontSize 为编辑器像素(1mm=4px)
        // 预览卡片 105px=105mm (1:1)，所以 x/y 直接用，fontSize 需要 ÷4
        var EDITOR_SCALE = 4;

        // 渲染可见卡片
        for (var i = startIdx; i < endIdx; i++) {
            var item = currentItems[i];
            var checked = selectedIndexes[i] ? ' checked' : '';
            var qrDataUrl = QRCodeGen.generate(QRCodeGen.buildQRText(item), 40);

            // 动态构建字段行（根据设置的可见字段）
            var fieldsHtml = '';
            var visibleFields = Settings.getVisibleFields();
            for (var fi = 0; fi < visibleFields.length; fi++) {
                var vf = visibleFields[fi];
                var val = item[vf.key] || '';
                if (customLayout) {
                    // 自定义布局：字段使用自定义位置/粗细/字体
                    var fk = 'field_' + vf.key;
                    var fp = customLayout[fk] || { x: 4, y: 13 + fi * 5.5, fontSize: 11, fontWeight: '400', fontFamily: APP_CONFIG.defaultFont };
                    var ffs = fp.fontSize ? Math.max(2, fp.fontSize / EDITOR_SCALE) : 2.75;
                    var fWeight = fp.fontWeight || '400';
                    var fFamily = APP_CONFIG.getFontCss(fp.fontFamily);
                    fieldsHtml += '<div style="position:absolute;left:' + fp.x.toFixed(1) + 'px;top:' + fp.y.toFixed(1) + 'px;right:2px;font-family:' + fFamily + ';font-size:' + ffs.toFixed(1) + 'px;color:#000000;font-weight:' + fWeight + ';" title="' + _esc(vf.label + '：' + val) + '">' +
                        '<span style="color:#555;font-weight:600;white-space:nowrap;">' + _esc(vf.label) + '：</span><span data-fit-text style="white-space:nowrap;overflow:hidden;display:inline-block;max-width:calc(100% - 60px);">' + _esc(val) + '</span></div>';
                } else {
                    fieldsHtml += '<div class="field" title="' + _esc(vf.label + '：' + val) + '"><span class="tag">' + _esc(vf.label) + '：</span><span class="value" data-fit-text style="overflow:hidden;text-overflow:ellipsis;">' + _esc(val) + '</span></div>';
                }
            }

            // 卡片头部：Logo + 公司名称
            var headerHtml = '';
            if (customLayout) {
                // 自定义布局：Logo 和公司名称独立定位
                var lp = customLayout.logo;
                var cp = customLayout.company || { x: 16, y: 3, fontSize: 14, fontWeight: '700', fontFamily: APP_CONFIG.defaultFont };
                var cfs = cp.fontSize ? Math.max(3, cp.fontSize / EDITOR_SCALE) : 3.5;
                var cWeight = cp.fontWeight || '700';
                var cFamily = APP_CONFIG.getFontCss(cp.fontFamily);
                if (lp) {
                    // Logo 位置 x/y 是 mm 直接用，宽高也是 mm
                    var logoWpx = lp.width || 10;
                    var logoHpx = lp.height || 8;
                    headerHtml += '<img src="' + logoSrc + '" style="position:absolute;left:' + lp.x.toFixed(1) + 'px;top:' + lp.y.toFixed(1) + 'px;width:' + logoWpx + 'px;height:' + logoHpx + 'px;object-fit:fill;" onerror="this.style.display=\'none\'">';
                }
                headerHtml += '<span style="position:absolute;left:' + cp.x.toFixed(1) + 'px;top:' + cp.y.toFixed(1) + 'px;font-family:' + cFamily + ';font-weight:' + cWeight + ';font-size:' + cfs.toFixed(1) + 'px;color:#000000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px;">' + _esc(APP_CONFIG.companyName) + '</span>';
            } else {
                headerHtml = '<div class="company">' +
                    '<img src="' + logoSrc + '" alt="" style="height:12px;" onerror="this.style.display=\'none\'">' +
                    '<span class="company-name">' + _esc(APP_CONFIG.companyName) + '</span>' +
                    '</div>';
            }

            // 二维码位置
            var qrHtml = '';
            if (qrDataUrl) {
                if (customLayout && customLayout.qr) {
                    var qp = customLayout.qr;
                    qrHtml = '<img src="' + qrDataUrl + '" style="position:absolute;left:' + qp.x.toFixed(1) + 'px;top:' + qp.y.toFixed(1) + 'px;width:16px;height:16px;">';
                } else {
                    qrHtml = '<div class="qr-code"><img src="' + qrDataUrl + '" width="18" height="18" style="display:block;width:18px;height:18px;"></div>';
                }
            }

            html += '<div class="preview-card" style="position:relative;' + (customLayout ? 'overflow:hidden;' : '') + '">' +
                '<label style="position:absolute;top:1px;left:1px;z-index:2;cursor:pointer;">' +
                    '<input type="checkbox" class="sel-cb" data-index="' + i + '"' + checked + ' style="width:11px;height:11px;cursor:pointer;margin:0;">' +
                '</label>' +
                headerHtml +
                fieldsHtml +
                qrHtml +
                '</div>';
        }

        // 底部占位
        var bottomH = (totalRows - endRow - 1) * VS.cardH;
        if (bottomH > 0) {
            html += '<div style="width:100%;height:' + bottomH + 'px;flex-shrink:0;"></div>';
        }

        content.innerHTML = html;

        // 超长字段值自动缩小字号（保持单行）
        _shrinkOverflowText(content);

        // 绑定复选框事件
        content.querySelectorAll('.sel-cb').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var idx = parseInt(this.getAttribute('data-index'));
                if (this.checked) {
                    selectedIndexes[idx] = true;
                } else {
                    delete selectedIndexes[idx];
                }
                _updateSelectionCount();
            });
        });
    }

    function _updateSelectionCount() {
        var count = Object.keys(selectedIndexes).length;
        var el = document.getElementById('statsCount');
        if (el) {
            if (count > 0 && count < currentItems.length) {
                el.textContent = '已选 ' + count + ' / ' + currentItems.length + ' 条';
            } else {
                el.textContent = '共 ' + currentItems.length + ' 条';
            }
        }
    }

    /**
     * 检测超长字段值并自动缩小字号（保持单行不换行）
     * 最小缩放到 3.5px，低于此值截断加…
     */
    function _shrinkOverflowText(container) {
        var els = container.querySelectorAll('[data-fit-text]');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (el.scrollWidth <= el.clientWidth + 1) continue;
            var curSize = parseFloat(getComputedStyle(el).fontSize) || 5.5;
            var minSize = 3.5;
            // 二分查找合适的字号
            var lo = minSize, hi = curSize, best = minSize;
            while (lo <= hi) {
                var mid = (lo + hi) / 2;
                el.style.fontSize = mid.toFixed(1) + 'px';
                if (el.scrollWidth <= el.clientWidth + 1) {
                    best = mid;
                    lo = mid + 0.1;
                } else {
                    hi = mid - 0.1;
                }
            }
            el.style.fontSize = best.toFixed(1) + 'px';
            // 字号已最小仍溢出，截断加…
            if (best <= minSize && el.scrollWidth > el.clientWidth + 1) {
                var txt = el.textContent;
                while (txt.length > 1) {
                    txt = txt.slice(0, -1);
                    el.textContent = txt + '…';
                    if (el.scrollWidth <= el.clientWidth + 1) break;
                }
            }
        }
    }

    /**
     * 获取用于 PDF 导出的数据（选中项或全部）
     */
    function _getExportItems() {
        var selCount = Object.keys(selectedIndexes).length;
        if (selCount > 0 && selCount < currentItems.length) {
            var items = [];
            for (var i = 0; i < currentItems.length; i++) {
                if (selectedIndexes[i]) items.push(currentItems[i]);
            }
            return items;
        }
        return currentItems;
    }

    function _updateStats() {
        var el = document.getElementById('statsCount');
        if (el) el.textContent = '共 ' + currentItems.length + ' 条';

        var validation = Parser.validate(currentItems);
        var errEl = document.getElementById('validationStatus');
        if (errEl) {
            if (validation.errors.length === 0) {
                errEl.innerHTML = '<span style="color:#28a745;">✅ 数据校验通过</span>';
            } else {
                errEl.innerHTML = '<span style="color:#dc3545;">❌ ' + validation.errors.length + ' 个错误</span>' +
                    (validation.warnings.length > 0 ? ' <span style="color:#ffc107;">⚠️ ' + validation.warnings.length + ' 个警告</span>' : '');
                errEl.title = validation.errors.map(function(e) { return e.message; }).join('\n');
            }
        }
    }

    // ========== 生成预览 ==========

    function generatePreview() {
        _refreshAll();
        _saveCurrentData();
        if (currentItems.length > 0) {
            UI.toast('已生成 ' + currentItems.length + ' 条预览', 'success', 2000);
        }
    }

    // ========== PDF 生成 ==========

    function generatePDF() {
        var items = _getExportItems();
        if (items.length === 0) {
            UI.toast('没有数据，请先录入数据并点击「生成预览」', 'warning');
            return;
        }

        // 数据校验
        var validation = Parser.validate(items);
        if (!validation.valid) {
            var errMsg = validation.errors.slice(0, 5).map(function(e) { return e.message; }).join('\n');
            if (validation.errors.length > 5) errMsg += '\n... 还有 ' + (validation.errors.length - 5) + ' 个错误';
            UI.toast('数据校验失败：\n' + errMsg, 'error', 5000);
            return;
        }

        var total = items.length;
        var selCount = Object.keys(selectedIndexes).length;
        var msg = total < currentItems.length
            ? '将为选中的 ' + total + ' 条数据生成 PDF'
            : '当前共 ' + total + ' 条数据';

        if (total > APP_CONFIG.pdf.warnThreshold) {
            UI.confirm('生成 PDF', msg + '，生成可能需要数秒，是否继续？', function() {
                _doGeneratePDF(items);
            });
        } else {
            _doGeneratePDF(items);
        }
    }

    function _doGeneratePDF(items) {
        var progressWrap = document.getElementById('progressWrap');
        var progressBar = document.getElementById('progressBar');
        var progressText = document.getElementById('progressText');
        var tip = document.getElementById('progressTip');
        var btn = document.getElementById('btnGeneratePDF');

        progressWrap.className = 'progress-bar-wrap show';
        progressBar.style.width = '0%';
        progressText.textContent = '准备中...';
        tip.className = 'progress-tip show';
        btn.disabled = true;
        btn.style.opacity = '0.6';
        btn.textContent = '⏳ 生成中...';

        PDFGenerator.generate(items, {
            onProgress: function(percent, detail) {
                progressBar.style.width = percent + '%';
                progressText.textContent = percent + '% (' + detail + ')';
            },
            onComplete: function(filename) {
                progressBar.style.width = '100%';
                progressText.textContent = '✅ 完成！';
                tip.className = 'progress-tip';
                progressWrap.className = 'progress-bar-wrap';
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.textContent = '📄 下载 PDF';
                UI.toast('PDF 已生成：' + filename, 'success');
            },
            onError: function(errMsg) {
                tip.className = 'progress-tip';
                progressWrap.className = 'progress-bar-wrap';
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.textContent = '📄 下载 PDF';
                UI.toast('生成失败：' + errMsg, 'error');
            }
        });
    }

    // ========== 文件导入 ==========

    // Excel 字段映射关键词自动匹配表
    var _FIELD_KEYWORDS = {
        code:   ['资产编码', '编码', '编号', '资产号', 'code', 'id'],
        name:   ['资产名称', '名称', '资产名', 'name'],
        dept:   ['使用部门', '部门', '所属部门', 'dept', 'department'],
        model:  ['规格型号', '型号', '规格', 'model'],
        date:   ['开始使用日期', '使用日期', '日期', '启用日期', 'date'],
        person: ['责任人', '负责人', '保管人', '使用人', 'person']
    };

    /**
     * 自动检测列与字段的映射关系
     */
    function _autoMapColumns(headers) {
        var mapping = {};
        var fieldKeys = APP_CONFIG.fieldKeys;
        for (var fi = 0; fi < fieldKeys.length; fi++) {
            var key = fieldKeys[fi];
            var keywords = _FIELD_KEYWORDS[key] || [];
            for (var ci = 0; ci < headers.length; ci++) {
                var h = (headers[ci] || '').toString().trim().toLowerCase();
                for (var ki = 0; ki < keywords.length; ki++) {
                    if (h.indexOf(keywords[ki].toLowerCase()) > -1) {
                        mapping[key] = ci;
                        break;
                    }
                }
                if (mapping[key] !== undefined) break;
            }
        }
        return mapping;
    }

    /**
     * 显示 Excel 字段映射对话框
     */
    function _showColumnMapping(headers, jsonData, onConfirm) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.45);z-index:99998;display:flex;align-items:center;justify-content:center;';

        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:12px;padding:28px 32px;width:560px;max-width:94%;max-height:88vh;overflow:auto;box-shadow:0 12px 40px rgba(0,0,0,0.2);';

        var autoMap = _autoMapColumns(headers);

        var fieldsHtml = '';
        APP_CONFIG.fieldOrder.forEach(function(label, fi) {
            var key = APP_CONFIG.fieldKeys[fi];
            var selectedCol = autoMap[key] !== undefined ? autoMap[key] : -1;
            fieldsHtml += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">' +
                '<label style="width:90px;font-size:13px;font-weight:600;color:#333;flex-shrink:0;">' + label + '</label>' +
                '<select class="map-select" data-key="' + key + '" style="flex:1;padding:7px 10px;border:1px solid #d0d7de;border-radius:6px;font-size:13px;">' +
                '<option value="-1">-- 不导入 --</option>';
            for (var ci = 0; ci < headers.length; ci++) {
                var hText = (headers[ci] || '列 ' + (ci + 1)).toString().replace(/</g, '&lt;');
                var sel = ci === selectedCol ? ' selected' : '';
                fieldsHtml += '<option value="' + ci + '"' + sel + '>列 ' + (ci + 1) + ': ' + hText + '</option>';
            }
            fieldsHtml += '</select></div>';
        });

        box.innerHTML =
            '<div style="font-size:18px;font-weight:700;color:#1a3c6e;margin-bottom:6px;">📋 Excel 字段映射</div>' +
            '<div style="font-size:13px;color:#888;margin-bottom:16px;">已自动检测表头匹配关系，请确认或调整列映射</div>' +
            '<div style="background:#f8f9fa;border-radius:6px;padding:14px;margin-bottom:16px;">' +
                '<div style="font-size:12px;color:#666;margin-bottom:6px;">检测到的表头：</div>' +
                '<div style="font-size:12px;color:#333;line-height:1.8;">' + headers.map(function(h, i) { return '列' + (i+1) + ': <strong>' + ((h||'').toString().replace(/</g,'&lt;') || '(空)') + '</strong>'; }).join(' &nbsp;|&nbsp; ') + '</div>' +
            '</div>' +
            fieldsHtml +
            '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">' +
                '<button class="map-cancel" style="padding:8px 20px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:14px;">取消</button>' +
                '<button class="map-confirm" style="padding:8px 20px;border:none;border-radius:6px;background:#1a3c6e;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">✅ 确认导入</button>' +
            '</div>';

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close() { overlay.remove(); }

        box.querySelector('.map-cancel').onclick = close;
        overlay.onclick = function(e) { if (e.target === overlay) close(); };
        box.querySelector('.map-confirm').onclick = function() {
            var colMap = {};
            box.querySelectorAll('.map-select').forEach(function(sel) {
                var key = sel.getAttribute('data-key');
                var colIdx = parseInt(sel.value);
                if (colIdx >= 0) colMap[key] = colIdx;
            });
            close();
            onConfirm(colMap);
        };
    }

    function importFile(event) {
        var file = event.target.files[0];
        if (!file) return;

        document.getElementById('fileName').textContent = file.name;
        var ext = file.name.split('.').pop().toLowerCase();

        if (typeof XLSX === 'undefined') {
            UI.toast('XLSX 库未加载，请检查 libs/xlsx.full.min.js', 'error');
            return;
        }

        var reader = new FileReader();

        if (ext === 'xlsx' || ext === 'xls') {
            reader.onload = function(e) {
                try {
                    var data = new Uint8Array(e.target.result);
                    var workbook = XLSX.read(data, { type: 'array' });

                    var sheetName = workbook.SheetNames[0];
                    if (workbook.SheetNames.length > 1) {
                        sheetName = workbook.SheetNames[0];
                    }

                    var firstSheet = workbook.Sheets[sheetName];
                    var jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

                    if (!jsonData || jsonData.length < 2) {
                        UI.toast('未在 Excel 中找到有效数据', 'warning');
                        return;
                    }

                    // 检测表头行（前 3 行）
                    var headerRowIdx = -1;
                    for (var r = 0; r < jsonData.length && r < 3; r++) {
                        var row = jsonData[r];
                        if (!row || row.length === 0) continue;
                        var rowStr = row.join(',').toLowerCase();
                        if (rowStr.indexOf('资产编码') > -1 || rowStr.indexOf('资产名称') > -1 ||
                            rowStr.indexOf('编码') > -1 || rowStr.indexOf('名称') > -1) {
                            headerRowIdx = r;
                            break;
                        }
                    }

                    if (headerRowIdx >= 0) {
                        // 有表头行，显示映射对话框
                        var headers = jsonData[headerRowIdx];
                        var dataRows = jsonData.slice(headerRowIdx + 1);
                        _showColumnMapping(headers, dataRows, function(colMap) {
                            var items = _parseWithMapping(dataRows, colMap);
                            if (items.length === 0) {
                                UI.toast('未解析到有效数据', 'warning');
                                return;
                            }
                            currentItems = items;
                            _syncFromItems();
                            UI.toast('导入成功！共 ' + items.length + ' 条数据', 'success');
                        });
                    } else {
                        // 无表头，按默认顺序解析
                        var items = Parser.parseExcelData(jsonData);
                        if (items.length === 0) {
                            UI.toast('未在 Excel 中找到有效数据', 'warning');
                            return;
                        }
                        currentItems = items;
                        _syncFromItems();
                        UI.toast('导入成功！共 ' + items.length + ' 条数据', 'success');
                    }
                } catch (err) {
                    UI.toast('读取失败：' + err.message, 'error');
                    console.error(err);
                }
            };
            reader.readAsArrayBuffer(file);
        } else if (ext === 'csv' || ext === 'txt') {
            reader.onload = function(e) {
                var content = e.target.result;
                if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);  // 去 BOM
                _setDataText(content);
                _refreshAll();
                _saveCurrentData();
                UI.toast('导入成功！', 'success');
            };
            reader.readAsText(file, 'UTF-8');
        } else {
            UI.toast('不支持的文件格式：.' + ext, 'error');
        }

        event.target.value = '';  // 允许重复选择同一文件
    }

    /**
     * 根据列映射解析数据行
     */
    function _parseWithMapping(dataRows, colMap) {
        var items = [];
        for (var r = 0; r < dataRows.length; r++) {
            var row = dataRows[r];
            if (!row || row.length === 0) continue;

            var hasData = false;
            for (var c = 0; c < row.length; c++) {
                if (row[c] !== undefined && row[c] !== null && row[c] !== '') {
                    hasData = true; break;
                }
            }
            if (!hasData) continue;

            var item = {};
            for (var key in colMap) {
                if (colMap.hasOwnProperty(key)) {
                    var ci = colMap[key];
                    var cell = (ci < row.length) ? row[ci] : '';
                    if (cell === undefined || cell === null) cell = '';
                    if (cell instanceof Date && !isNaN(cell)) {
                        cell = cell.getFullYear() + '/' + String(cell.getMonth() + 1).padStart(2, '0') + '/' + String(cell.getDate()).padStart(2, '0');
                    } else if (key === 'date') {
                        cell = Parser.formatDate(cell);
                    } else {
                        cell = String(cell).trim();
                    }
                    item[key] = cell;
                }
            }
            if (!item.code && !item.name) continue;
            // 补齐缺失字段
            APP_CONFIG.fieldKeys.forEach(function(k) { if (!item[k]) item[k] = ''; });
            items.push(item);
        }
        return items;
    }

    // ========== 数据导出 ==========

    function exportCSV() {
        if (currentItems.length === 0) {
            UI.toast('没有数据可导出', 'warning');
            return;
        }

        var csv = Parser.toCSV(currentItems);
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = '资产数据_' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(url);
        UI.toast('已导出 ' + currentItems.length + ' 条数据', 'success');
    }

    // ========== 清空 / 示例 ==========

    function clearAll() {
        UI.confirm('清空确认', '确认清空所有数据？此操作不可恢复。', function() {
            currentItems = [];
            selectedIndexes = {};
            _setDataText('');
            document.getElementById('fileName').textContent = '未选择文件';
            Storage.remove(APP_CONFIG.storageKeys.data);
            _updateTable();
            _updatePreview();
            _updateStats();
            UI.toast('已清空', 'success');
        });
    }

    function loadSample() {
        _setDataText(
            '130015000242, 货架, 设计制版钟祥实验室, , 46585, 赵威\n' +
            '130015000243, 电脑, 仓库, , 46178, 杨亚军\n' +
            '130015000244, 办公桌, 财务部, 1800*60*30, 41279, 赵晶晶'
        );
        _refreshAll();
        _saveCurrentData();
        UI.toast('已加载示例数据', 'info', 2000);
    }

    // ========== 设置 ==========

    function openSettings() {
        Settings.openPanel(function() {
            QRCodeGen.clearCache();
            _updatePreview();
        });
    }

    // ========== 标签编辑器 ==========

    function openLabelEditor() {
        LabelEditor.open(function() {
            // 布局保存后刷新预览和清除 QR 缓存
            QRCodeGen.clearCache();
            _updatePreview();
            UI.toast('标签布局已更新', 'success');
        });
    }

    // ========== 工具函数 ==========

    function _esc(str) {
        var div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    // ========== 初始化 ==========

    function init() {
        // 环境守卫:非 NW.js 环境下直接退出,避免初始化副作用
        if (window.__ENV_GUARDED__) return;

        // 统一检查第三方库是否加载
        var missingLibs = [];
        if (typeof qrcode === 'undefined') missingLibs.push('qrcode.js');
        if (typeof window.jspdf === 'undefined') missingLibs.push('jspdf.umd.min.js');
        if (typeof XLSX === 'undefined') missingLibs.push('xlsx.full.min.js');
        if (missingLibs.length > 0) {
            console.error('[App] 以下库未加载: ' + missingLibs.join(', '));
            // 不阻塞启动，在用到时再报错
        }

        // 加载用户设置（覆盖默认配置）
        Settings.load();

        // 创建自动保存
        autoSave = Storage.createAutoSaver(_getDataText, APP_CONFIG.storageKeys.data);

        // 绑定事件
        document.getElementById('pwdInput').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') verify();
        });

        // 管理员密钥输入框回车直接取码
        var adminKeyEl = document.getElementById('adminKeyInput');
        if (adminKeyEl) {
            adminKeyEl.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') { e.preventDefault(); fetchCode(); }
            });
        }

        document.getElementById('dataInput').addEventListener('input', function() {
            autoSave();
        });

        document.getElementById('dataInput').addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                generatePreview();
            }
        });

        // 窗口大小变化时重新渲染虚拟列表
        var resizeTimer = null;
        window.addEventListener('resize', function() {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function() { _updatePreview(); }, 200);
        });

        // 搜索框事件
        var searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', function() { _onSearchInput(); });
        }
        var searchClear = document.getElementById('searchClear');
        if (searchClear) {
            searchClear.addEventListener('click', function() { _onSearchClear(); });
        }

        // 批量操作按钮事件
        var btnBatchEdit = document.getElementById('btnBatchEdit');
        if (btnBatchEdit) btnBatchEdit.addEventListener('click', function() { _batchEdit(); });
        var btnBatchDelete = document.getElementById('btnBatchDelete');
        if (btnBatchDelete) btnBatchDelete.addEventListener('click', function() { _batchDelete(); });
        var btnSelectAll = document.getElementById('btnSelectAll');
        if (btnSelectAll) btnSelectAll.addEventListener('click', function() { _onSelectAll(true); });
        var btnDeselectAll = document.getElementById('btnDeselectAll');
        if (btnDeselectAll) btnDeselectAll.addEventListener('click', function() { _onSelectAll(false); });

        // 聚焦密码框
        document.getElementById('pwdInput').focus();

        // 悬停放大
        _initMagnifier();
        // 全局快捷键
        _initShortcuts();
        // 初始化 section-body 的 max-height
        _initSectionHeights();
    }

    // ========== 界面折叠 ==========

    function _initSectionHeights() {
        var bodies = document.querySelectorAll('.section-body');
        bodies.forEach(function(el) {
            el.style.maxHeight = el.scrollHeight + 2000 + 'px';
        });
    }

    function toggleSection(sectionId) {
        var sec = document.getElementById(sectionId);
        if (!sec) return;
        var body = sec.querySelector('.section-body');
        if (!body) return;
        if (sec.classList.contains('section-collapsed')) {
            sec.classList.remove('section-collapsed');
            body.style.maxHeight = body.scrollHeight + 2000 + 'px';
        } else {
            body.style.maxHeight = body.scrollHeight + 'px';
            requestAnimationFrame(function() {
                sec.classList.add('section-collapsed');
            });
        }
    }

    // ========== 预览缩放 ==========

    var _zoomLevel = 100;

    function setZoom(val) {
        _zoomLevel = parseInt(val);
        var slider = document.getElementById('zoomSlider');
        var label = document.getElementById('zoomLabel');
        if (slider) slider.value = _zoomLevel;
        if (label) label.textContent = _zoomLevel + '%';
        var content = document.getElementById('vsContent');
        if (content) {
            content.style.transform = 'scale(' + (_zoomLevel / 100) + ')';
            content.style.transformOrigin = 'top center';
        }
    }

    // ========== 悬停放大 ==========

    function _initMagnifier() {
        var preview = document.getElementById('labelPreview');
        var mag = document.getElementById('previewMagnifier');
        if (!preview || !mag) return;

        var MAG_SCALE = 2.5;

        preview.addEventListener('mouseover', function(e) {
            var card = e.target.closest('.preview-card');
            if (!card) return;
            mag.innerHTML = '';
            // 用 transform: scale 整体缩放，保持比例
            var wrapper = document.createElement('div');
            wrapper.style.cssText = 'transform: scale(' + MAG_SCALE + '); transform-origin: top left; width: 105px; height: 70px;';
            var clone = card.cloneNode(true);
            clone.style.transform = 'none';
            clone.style.position = 'relative';
            wrapper.appendChild(clone);
            mag.appendChild(wrapper);
            mag.style.display = 'block';
            mag.style.width = Math.round(105 * MAG_SCALE + 4) + 'px';
            mag.style.height = Math.round(70 * MAG_SCALE + 4) + 'px';
        });

        preview.addEventListener('mousemove', function(e) {
            var card = e.target.closest('.preview-card');
            if (!card) { mag.style.display = 'none'; return; }
            var magW = parseInt(mag.style.width) || 280;
            var magH = parseInt(mag.style.height) || 190;
            var x = e.clientX + 15;
            var y = e.clientY + 15;
            if (x + magW > window.innerWidth) x = e.clientX - magW - 10;
            if (y + magH > window.innerHeight) y = e.clientY - magH - 10;
            mag.style.left = x + 'px';
            mag.style.top = y + 'px';
        });

        preview.addEventListener('mouseout', function(e) {
            var card = e.target.closest('.preview-card');
            if (!card) return;
            var related = e.relatedTarget;
            if (related && card.contains(related)) return;
            mag.style.display = 'none';
        });
    }

    // ========== 全局快捷键 ==========

    function _initShortcuts() {
        document.addEventListener('keydown', function(e) {
            // Ctrl+S → 下载 PDF
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                if (_isVerified && currentItems.length > 0) generatePDF();
            }
            // Ctrl+O → 导入文件
            if (e.ctrlKey && e.key === 'o') {
                e.preventDefault();
                if (_isVerified) document.getElementById('fileInput').click();
            }
            // Ctrl+E → 导出 CSV
            if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                if (_isVerified && currentItems.length > 0) exportCSV();
            }
        });
    }

    // ========== Excel 模板下载 ==========

    function downloadTemplate() {
        try {
            if (typeof XLSX === 'undefined') {
                if (typeof UI !== 'undefined') UI.toast('XLSX 库未加载', 'error');
                else alert('XLSX 库未加载，请检查 libs/xlsx.full.min.js');
                return;
            }
            var headers = APP_CONFIG.fields.map(function(f) { return f.label; });
            var ws = XLSX.utils.aoa_to_sheet([headers]);
            // 设置列宽
            ws['!cols'] = headers.map(function(h) {
                return { wch: Math.max(h.length * 2, 15) };
            });
            var wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '资产数据');
            XLSX.writeFile(wb, '资产标签模板.xlsx');
            if (typeof UI !== 'undefined') UI.toast('模板已下载', 'success', 1500);
        } catch (e) {
            console.error('模板下载失败:', e);
            if (typeof UI !== 'undefined') UI.toast('模板下载失败：' + e.message, 'error', 3000);
            else alert('模板下载失败：' + e.message);
        }
    }

    // ========== 公开接口 ==========

    return {
        init: init,
        verify: verify,
        logout: logout,
        fetchCode: fetchCode,
        _copyCode: _copyCode,
        generatePreview: generatePreview,
        generatePDF: generatePDF,
        importFile: importFile,
        exportCSV: exportCSV,
        clearAll: clearAll,
        loadSample: loadSample,
        openSettings: openSettings,
        openLabelEditor: openLabelEditor,
        toggleSection: toggleSection,
        setZoom: setZoom,
        downloadTemplate: downloadTemplate
    };
})();

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    App.init();
});
