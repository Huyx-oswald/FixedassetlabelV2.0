/**
 * PDF 生成模块
 * 使用 Canvas 2D 直绘标签，替代 html2canvas，性能提升 50-100 倍
 */
var PDFGenerator = (function() {
    'use strict';

    // Logo 图片缓存（每次生成时重新检测，以支持自定义 Logo 切换）
    var _logoImg = null;
    var _logoSrc = '';

    function getLogoImg(callback) {
        // 确定 Logo 来源（支持自定义 Logo）
        var src = (typeof LabelEditor !== 'undefined') ? LabelEditor.getLogoSource() :
            ((typeof LogoStore !== 'undefined') ? LogoStore.getDefaultLogoPath() : 'logo/logo.png');
        if (_logoImg !== null && _logoSrc === src) { callback(_logoImg); return; }
        // 来源变化，重新加载
        _logoImg = null;
        _logoSrc = src;
        _loadLogo(src, callback);
    }

    function _loadLogo(src, callback) {
        var img = new Image();
        img.onload = function() {
            // SVG 无固有尺寸时 Canvas 无法渲染，注入 width/height 后重新加载
            if (!img.naturalWidth && src.indexOf('data:image/svg+xml') === 0) {
                _normalizeSvg(src, function(normSrc) {
                    if (normSrc === src) { _logoImg = false; callback(false); return; }
                    var img2 = new Image();
                    img2.onload = function() { _logoImg = img2; callback(img2); };
                    img2.onerror = function() { _logoImg = false; callback(false); };
                    img2.src = normSrc;
                });
                return;
            }
            _logoImg = img; callback(img);
        };
        img.onerror = function() { _logoImg = false; callback(false); };
        img.src = src;
    }

    /**
     * SVG 归一化：为缺少 width/height 的 SVG 注入尺寸（基于 viewBox），
     * 保证 Canvas drawImage 能正确渲染矢量 Logo
     */
    function _normalizeSvg(src, callback) {
        try {
            var base64 = src.split(',')[1];
            var svgText = decodeURIComponent(escape(atob(base64)));
            if (/\swidth=["'][\d.]/.test(svgText) && /\sheight=["'][\d.]/.test(svgText)) {
                callback(src); return;
            }
            var vb = svgText.match(/viewBox=["']\s*([\d.eE\-]+)[\s,]+([\d.eE\-]+)[\s,]+([\d.eE\-]+)[\s,]+([\d.eE\-]+)/);
            var w = vb ? parseFloat(vb[3]) : 100;
            var h = vb ? parseFloat(vb[4]) : 100;
            svgText = svgText.replace(/<svg/i, '<svg width="' + w + '" height="' + h + '"');
            callback('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText))));
        } catch (e) {
            callback(src);
        }
    }

    // ---------- Logo 内容边界检测（自动裁边对齐） ----------

    var _logoBoundsCache = {};

    /**
     * 扫描图片像素，找出实际可见内容的边界（排除透明/白色边距）
     * 返回归一化坐标 {l,t,r,b}（0-1），检测失败时返回整图范围
     */
    function _getLogoContentBounds(img) {
        var src = img.src || '';
        if (_logoBoundsCache[src]) return _logoBoundsCache[src];
        var full = { l: 0, t: 0, r: 1, b: 1 };
        var nw = img.naturalWidth, nh = img.naturalHeight;
        if (!nw || !nh) { _logoBoundsCache[src] = full; return full; }
        try {
            // 降采样到最大 200px 扫描，控制性能
            var scale = Math.min(1, 200 / Math.max(nw, nh));
            var cw = Math.max(1, Math.round(nw * scale));
            var ch = Math.max(1, Math.round(nh * scale));
            var cv = document.createElement('canvas');
            cv.width = cw; cv.height = ch;
            var c = cv.getContext('2d');
            c.drawImage(img, 0, 0, cw, ch);
            var data = c.getImageData(0, 0, cw, ch).data;
            var minX = cw, minY = ch, maxX = -1, maxY = -1;
            for (var y = 0; y < ch; y++) {
                for (var x = 0; x < cw; x++) {
                    var idx = (y * cw + x) * 4;
                    // 非透明且非近白色的像素视为内容
                    if (data[idx + 3] > 20 && !(data[idx] > 248 && data[idx + 1] > 248 && data[idx + 2] > 248)) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            var bounds = (maxX < 0) ? full : {
                l: minX / cw, t: minY / ch,
                r: (maxX + 1) / cw, b: (maxY + 1) / ch
            };
            _logoBoundsCache[src] = bounds;
            return bounds;
        } catch (e) {
            _logoBoundsCache[src] = full;
            return full;
        }
    }

    /**
     * 截断文本以适应宽度（二分查找优化）
     */
    function truncateText(ctx, text, maxWidth) {
        if (!text || ctx.measureText(text).width <= maxWidth) return text;
        var lo = 0, hi = text.length;
        while (lo < hi) {
            var mid = (lo + hi + 1) >> 1;
            if (ctx.measureText(text.slice(0, mid) + '…').width <= maxWidth) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return lo > 0 ? text.slice(0, lo) + '…' : text.slice(0, 1);
    }

    /**
     * 二分查找合适的字号，使文本宽度不超过 maxWidth（单行）
     * 仅缩小右侧值文本，左侧标签不受影响
     * @param {CanvasRenderingContext2D} ctx
     * @param {string} text - 值文本
     * @param {number} maxW - 可用最大宽度
     * @param {number} baseFs - 原始字号
     * @param {string} weight - 字体粗细
     * @param {number} [minFs] - 最小字号（默认原始的 60%）
     * @param {string} [fontFamily] - 字体 CSS 字符串（如 '"SimHei", "黑体", sans-serif'）
     * @returns {{ text: string, fontSize: number }}
     */
    function fitTextSize(ctx, text, maxW, baseFs, weight, minFs, fontFamily) {
        if (!text) return { text: '', fontSize: baseFs };
        minFs = minFs || baseFs * 0.6;
        var ff = fontFamily || '"Microsoft YaHei", "SimSun", "PingFang SC", sans-serif';
        ctx.font = weight + ' ' + baseFs + 'px ' + ff;
        if (ctx.measureText(text).width <= maxW) return { text: text, fontSize: baseFs };
        var lo = minFs, hi = baseFs, best = minFs;
        while (lo <= hi) {
            var mid = (lo + hi) / 2;
            ctx.font = weight + ' ' + mid.toFixed(1) + 'px ' + ff;
            if (ctx.measureText(text).width <= maxW) {
                best = mid;
                lo = mid + 0.2;
            } else {
                hi = mid - 0.2;
            }
        }
        // 最小字号仍溢出，截断加…
        ctx.font = weight + ' ' + minFs.toFixed(1) + 'px ' + ff;
        if (ctx.measureText(text).width > maxW) {
            text = truncateText(ctx, text, maxW);
        }
        return { text: text, fontSize: best };
    }

    /**
     * 在 Canvas 上绘制单个标签
     * 支持自定义布局（从 Settings.getLayout() 读取）和默认自动布局
     */
    function drawLabelOnCanvas(canvas, item, qrImages, logoImg) {
        var ctx = canvas.getContext('2d');
        var W = canvas.width;
        var H = canvas.height;
        var MM = W / APP_CONFIG.labelWidth;  // px per mm
        var PX = APP_CONFIG.pdf.canvasScale;

        // 白色背景
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);

        // 边框
        var bw = 1.5 * PX;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = bw;
        ctx.strokeRect(bw / 2, bw / 2, W - bw, H - bw);

        // 检查是否有自定义布局
        var customLayout = (typeof Settings !== 'undefined') ? Settings.getLayout() : null;

        if (customLayout) {
            _drawCustomLabel(ctx, canvas, item, qrImages, logoImg, customLayout, MM, PX);
        } else {
            _drawAutoLayout(ctx, canvas, item, qrImages, logoImg, MM, PX);
        }
    }

    /**
     * 默认自动布局（原有逻辑）
     */
    function _drawAutoLayout(ctx, canvas, item, qrImages, logoImg, MM, PX) {
        var W = canvas.width;
        var H = canvas.height;
        var padX = 4 * MM;
        var padY = 3 * MM;
        var companyFsPx = 16 * PX;
        var companyPb = 2 * PX;
        var companyMb = 3 * PX;
        var companyBorderW = 2 * PX;

        var visibleFields = (typeof Settings !== 'undefined' && Settings.getVisibleFields)
            ? Settings.getVisibleFields()
            : APP_CONFIG.fieldKeys.map(function(key, i) {
                return { key: key, label: APP_CONFIG.fieldOrder[i], visible: true };
            });
        var fields = visibleFields.map(function(f) {
            return { tag: f.label + '：', value: item[f.key] || '', key: f.key };
        });
        var fieldLineH = 13 * PX * 1.7;

        var companyH = companyFsPx + companyPb + companyBorderW + companyMb;
        var fieldsH = fields.length * fieldLineH;
        var contentH = companyH + fieldsH;
        var availH = H - 2 * padY - (1.5 * PX);
        var startY = padY + (availH - contentH) / 2;
        if (startY < padY) startY = padY;

        // 公司名称
        ctx.font = '700 ' + companyFsPx + 'px "Microsoft YaHei", "SimSun", "PingFang SC", sans-serif';
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        var companyText = APP_CONFIG.companyName;
        var textW = ctx.measureText(companyText).width;

        if (logoImg && logoImg.naturalWidth && logoImg.naturalHeight) {
            var logoH = 18 * PX;
            var logoW = logoH * (logoImg.naturalWidth / logoImg.naturalHeight);
            // 自动裁边：检测 Logo 实际可见内容边界，用内容中心对齐文字视觉中心
            var lb = _getLogoContentBounds(logoImg);
            var contentW = (lb.r - lb.l) * logoW;
            var contentH = (lb.b - lb.t) * logoH;
            var textCenterY = startY + companyFsPx * 0.5;
            var totalW = contentW + 6 * PX + textW;
            var contentX = (W - totalW) / 2;
            // 由内容目标位置反推绘制位置
            var drawX = contentX - lb.l * logoW;
            var drawY = textCenterY - contentH / 2 - lb.t * logoH;
            ctx.drawImage(logoImg, drawX, drawY, logoW, logoH);
            ctx.textAlign = 'left';
            ctx.fillText(companyText, contentX + contentW + 6 * PX, startY);
        } else {
            ctx.fillText(companyText, W / 2, startY);
        }

        var borderY = startY + companyFsPx + companyPb;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = companyBorderW;
        ctx.beginPath();
        ctx.moveTo(padX, borderY);
        ctx.lineTo(W - padX, borderY);
        ctx.stroke();

        // 字段
        var fieldY = borderY + companyBorderW + companyMb;
        ctx.textAlign = 'left';
        var qrText = QRCodeGen.buildQRText(item);
        var hasQR = qrImages[qrText];
        var qrSize = APP_CONFIG.qrSize * MM;
        var fsPx = 13 * PX;
        // 二维码位于右下角，计算其垂直范围
        var qrTopY = H - 5 * MM - qrSize;

        for (var i = 0; i < fields.length; i++) {
            var f = fields[i];
            ctx.font = '600 ' + fsPx + 'px "Microsoft YaHei", "SimSun", "PingFang SC", sans-serif';
            ctx.fillStyle = '#555555';
            ctx.fillText(f.tag, padX, fieldY);
            var tagW = ctx.measureText(f.tag).width;
            var valX = padX + tagW + 1 * PX;
            var maxValW = W - valX - 2 * MM; // 右侧留约 2mm
            // 仅当字段与二维码垂直重叠时才限制宽度
            if (hasQR && fieldY + fsPx > qrTopY) {
                maxValW = W - 3 * MM - qrSize - valX;
            }
            // 只缩小右侧值的字号，左侧标签保持原大小
            var fitted = fitTextSize(ctx, f.value, maxValW, fsPx, '400');
            ctx.font = '400 ' + fitted.fontSize.toFixed(1) + 'px "Microsoft YaHei", "SimSun", "PingFang SC", sans-serif';
            ctx.fillStyle = '#000000';
            ctx.fillText(fitted.text, valX, fieldY);
            fieldY += fieldLineH;
        }

        // 二维码
        if (hasQR) {
            var qrImg = qrImages[qrText];
            if (qrImg.complete && qrImg.naturalWidth > 0) {
                ctx.drawImage(qrImg, W - 3 * MM - qrSize, H - 5 * MM - qrSize, qrSize, qrSize);
            }
        }
    }

    /**
     * 自定义布局渲染 v4
     * logo 用 width/height(mm)，company/fields 用 fontSize(编辑器px)
     */
    function _drawCustomLabel(ctx, canvas, item, qrImages, logoImg, layout, MM, PX) {
        var W = canvas.width;
        var H = canvas.height;
        var FS_SCALE = MM / 4;  // 编辑器 px → PDF px

        var visibleFields = (typeof Settings !== 'undefined' && Settings.getVisibleFields)
            ? Settings.getVisibleFields()
            : APP_CONFIG.fieldKeys.map(function(key, i) {
                return { key: key, label: APP_CONFIG.fieldOrder[i], visible: true };
            });

        // ---- 绘制 Logo（使用 width/height mm 精确尺寸） ----
        var lp = layout.logo;
        if (logoImg && logoImg.naturalWidth && lp) {
            var logoWmm = lp.width || 10;
            var logoHmm = lp.height || 8;
            ctx.drawImage(logoImg, lp.x * MM, lp.y * MM, logoWmm * MM, logoHmm * MM);
        }

        // ---- 绘制公司名称（自定义粗细/字体） ----
        var cp = layout.company || { x: 16, y: 3, fontSize: 14, fontWeight: '700', fontFamily: APP_CONFIG.defaultFont };
        var companyFsPx = (cp.fontSize || 14) * FS_SCALE;
        var companyWeight = cp.fontWeight || '700';
        var companyFamily = APP_CONFIG.getFontCss(cp.fontFamily);
        ctx.font = companyWeight + ' ' + companyFsPx + 'px ' + companyFamily;
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(APP_CONFIG.companyName, cp.x * MM, cp.y * MM);

        // ---- 绘制字段 ----
        ctx.textAlign = 'left';
        var qrText = QRCodeGen.buildQRText(item);
        var hasQR = qrImages[qrText];
        var qrSize = APP_CONFIG.qrSize * MM;
        // 二维码位置（用于判断垂直重叠）
        var qrPos = layout.qr || { x: APP_CONFIG.labelWidth - APP_CONFIG.qrSize - 3, y: APP_CONFIG.labelHeight - APP_CONFIG.qrSize - 5 };
        var qrTopY = qrPos.y * MM;

        for (var i = 0; i < visibleFields.length; i++) {
            var f = visibleFields[i];
            var fk = 'field_' + f.key;
            var fp = layout[fk] || { x: 4, y: 12 + i * 5.5, fontSize: 11, fontWeight: '400', fontFamily: APP_CONFIG.defaultFont };
            var fxPx = fp.x * MM;
            var fyPx = fp.y * MM;
            var fsPx = (fp.fontSize || 11) * FS_SCALE;
            var fieldWeight = fp.fontWeight || '400';
            var fieldFamily = APP_CONFIG.getFontCss(fp.fontFamily);
            var tag = f.label + '：';
            var val = item[f.key] || '';

            ctx.font = '600 ' + fsPx + 'px ' + fieldFamily;
            ctx.fillStyle = '#555555';
            ctx.fillText(tag, fxPx, fyPx);

            var tagW = ctx.measureText(tag).width;
            var valX = fxPx + tagW + 1 * PX;
            var maxValW = W - valX - 2 * MM; // 右侧留约 2mm
            // 仅当字段与二维码垂直重叠时才限制宽度
            if (hasQR && fyPx + fsPx > qrTopY) {
                maxValW = Math.min(maxValW, qrPos.x * MM - valX - 1 * MM);
            }

            ctx.font = fieldWeight + ' ' + fsPx + 'px ' + fieldFamily;
            ctx.fillStyle = '#000000';
            // 只缩小右侧值的字号，左侧标签保持原大小
            var fitted = fitTextSize(ctx, val, maxValW, fsPx, fieldWeight, null, fieldFamily);
            ctx.font = fieldWeight + ' ' + fitted.fontSize.toFixed(1) + 'px ' + fieldFamily;
            ctx.fillText(fitted.text, valX, fyPx);
        }

        // ---- 绘制二维码 ----
        if (hasQR) {
            var qp = layout.qr || { x: APP_CONFIG.labelWidth - APP_CONFIG.qrSize - 3, y: APP_CONFIG.labelHeight - APP_CONFIG.qrSize - 5 };
            var qrImg = qrImages[qrText];
            if (qrImg.complete && qrImg.naturalWidth > 0) {
                ctx.drawImage(qrImg, qp.x * MM, qp.y * MM, qrSize, qrSize);
            }
        }
    }

    /**
     * 生成 PDF 文件
     * @param {Array} items - 数据项数组
     * @param {Object} callbacks - 回调 {onProgress, onComplete, onError}
     */
    function generate(items, callbacks) {
        if (items.length === 0) {
            if (callbacks.onError) callbacks.onError('没有数据');
            return;
        }

        if (typeof window.jspdf === 'undefined') {
            if (callbacks.onError) callbacks.onError('PDF 库未加载，请检查 libs/jspdf.umd.min.js');
            return;
        }

        var total = items.length;
        var LW = APP_CONFIG.labelWidth;
        var LH = APP_CONFIG.labelHeight;
        var scale = APP_CONFIG.pdf.pxPerMm * APP_CONFIG.pdf.canvasScale;

        // 创建离屏 Canvas
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(LW * scale);
        canvas.height = Math.round(LH * scale);

        // 预加载资源
        var qrImages = {};
        var uniqueQRTexts = [];
        for (var i = 0; i < items.length; i++) {
            var qrText = QRCodeGen.buildQRText(items[i]);
            if (qrText && !qrImages[qrText]) {
                qrImages[qrText] = null;
                uniqueQRTexts.push(qrText);
            }
        }

        var loaded = 0;
        var toLoad = uniqueQRTexts.length + 1; // +1 for logo

        function onResLoad() {
            loaded++;
            if (callbacks.onProgress) {
                callbacks.onProgress(Math.round((loaded / toLoad) * 30), '加载资源...');
            }
            if (loaded >= toLoad) {
                _renderPDF();
            }
        }

        // 预加载 Logo
        getLogoImg(function() { onResLoad(); });

        // 预加载 QR 码图片
        for (var j = 0; j < uniqueQRTexts.length; j++) {
            (function(qrText) {
                var img = new Image();
                img.onload = function() { qrImages[qrText] = img; onResLoad(); };
                img.onerror = function() { onResLoad(); };
                img.src = QRCodeGen.generate(qrText, 120);
            })(uniqueQRTexts[j]);
        }

        // 渲染 PDF
        function _renderPDF() {
            try {
                var pdf = new window.jspdf.jsPDF('l', 'mm', [LW, LH]);
                var logoImg = (_logoImg && _logoImg !== false) ? _logoImg : null;
                var CHUNK = APP_CONFIG.pdf.chunkSize;
                var index = 0;

                function processChunk() {
                    var end = Math.min(index + CHUNK, total);
                    var skipCount = 0;
                    for (var i = index; i < end; i++) {
                        try {
                            drawLabelOnCanvas(canvas, items[i], qrImages, logoImg);
                            var imgData = canvas.toDataURL('image/jpeg', APP_CONFIG.pdf.quality);
                            if (i > 0) pdf.addPage([LW, LH]);
                            pdf.addImage(imgData, 'JPEG', 0, 0, LW, LH);
                        } catch (labelErr) {
                            // 单标签错误隔离：跳过失败的标签继续处理
                            skipCount++;
                            console.warn('[PDFGenerator] 第 ' + (i + 1) + ' 个标签绘制失败，已跳过:', labelErr.message);
                        }
                    }

                    var percent = 30 + Math.round(((end) / total) * 70);
                    if (callbacks.onProgress) {
                        callbacks.onProgress(percent, end + '/' + total + ' 标签');
                    }

                    index = end;
                    if (index < total) {
                        setTimeout(processChunk, 0);
                    } else {
                        var filename = '资产标签_' + new Date().toISOString().slice(0, 10) + '.pdf';
                        pdf.save(filename);
                        if (skipCount > 0 && typeof UI !== 'undefined') {
                            UI.toast('有 ' + skipCount + ' 个标签绘制失败已跳过', 'warning', 4000);
                        }
                        if (callbacks.onComplete) callbacks.onComplete(filename);
                    }
                }

                processChunk();
            } catch (err) {
                console.error('[PDFGenerator] 生成失败:', err);
                if (callbacks.onError) callbacks.onError(err.message);
            }
        }
    }

    return {
        generate: generate,
        drawLabelOnCanvas: drawLabelOnCanvas
    };
})();
