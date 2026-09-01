/**
 * 应用配置 - 集中管理所有可定制参数
 * 修改此文件即可调整标签样式、字段、尺寸等
 */
var APP_CONFIG = {
    // 公司信息
    companyName: '湖北华工图像技术开发有限公司',

    // 标签尺寸（毫米）
    labelWidth: 105,
    labelHeight: 70,

    // 二维码配置
    qrSize: 16,           // 二维码尺寸（mm）
    qrErrorLevel: 'M',    // 纠错级别: L/M/Q/H
    qrModuleGap: 0,       // 模块间隙比例 (0-0.5),0=紧贴,打印机渗墨时建议 0.15-0.25
    qrQuietZone: 1,       // 静默区(模块数,QR标准要求 4,默认 1 折中)

    // 字段定义（顺序决定标签上的显示顺序）
    fieldOrder: ['资产编码', '资产名称', '规格型号', '使用部门', '开始使用日期', '责任人'],
    fieldKeys: ['code', 'name', 'dept', 'model', 'date', 'person'],

    // 字段配置（可由设置面板覆盖）
    fields: [
        { key: 'code', label: '资产编码', visible: true },
        { key: 'name', label: '资产名称', visible: true },
        { key: 'dept', label: '使用部门', visible: true },
        { key: 'model', label: '规格型号', visible: true },
        { key: 'date', label: '开始使用日期', visible: true },
        { key: 'person', label: '责任人', visible: true }
    ],

    // 必填字段（用于数据校验）
    requiredFields: ['code', 'name'],

    // 数据验证规则
    validation: {
        codePattern: null,       // 资产编码正则，null 表示不限制
        maxCodeLength: 30,
        maxNameLength: 50,
        maxDeptLength: 50,
        maxModelLength: 50,
        maxPersonLength: 20
    },

    // 可选字体清单（名称 → CSS font-family 字符串,可同时用于 CSS 与 Canvas）
    fonts: [
        { name: '微软雅黑', css: '"Microsoft YaHei", "微软雅黑", sans-serif' },
        { name: '黑体',     css: '"SimHei", "黑体", sans-serif' },
        { name: '宋体',     css: '"SimSun", "宋体", serif' }
    ],
    defaultFont: '微软雅黑',

    // PDF 生成配置
    pdf: {
        quality: 0.92,           // JPEG 压缩质量
        chunkSize: 15,           // 分批处理大小
        canvasScale: 2,          // Canvas 缩放倍率
        pxPerMm: 3.779528,       // mm 转 px 系数
        warnThreshold: 500       // 超过此数量弹出确认提示
    },

    // 存储键名
    storageKeys: {
        data: 'asset_label_data',
        settings: 'asset_label_settings'
    }
};

/**
 * 按字体名称返回 CSS font-family 字符串
 * 未匹配时回退到 defaultFont。可同时用于 CSS 和 Canvas ctx.font
 * @param {string} [name] - 字体名称（如 '微软雅黑'）
 * @returns {string}
 */
APP_CONFIG.getFontCss = function(name) {
    var key = name || APP_CONFIG.defaultFont;
    for (var i = 0; i < APP_CONFIG.fonts.length; i++) {
        if (APP_CONFIG.fonts[i].name === key) return APP_CONFIG.fonts[i].css;
    }
    return APP_CONFIG.fonts[0].css;
};
