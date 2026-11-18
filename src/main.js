/* ============================================================
 * src/main.js — GEO Desk：客户端注册
 * 与 panel.js 共用一个工厂作用域（React、h 由外层提供），无 import/export。
 * ============================================================ */

const inject = ['slots'];

/**
 * 注册整页面板与侧栏入口。
 * @param {object} ctx 客户端根上下文
 * @returns {void}
 */
function panelApply(ctx) {
  ctx.slots.inject('main', function () {
    return ctx.slots.register(
      { name: 'main', key: 'geo-desk' },
      GeoPanel
    );
  });
  ctx.effect(function () {
    return ctx.slots.inject('sidebar.panellist', function () {
      return ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: 'geo-desk',
          order: 8,
          label: function () { return 'GEO 工作台'; },
        },
        GeoIcon
      );
    });
  }, 'geo-desk: sidebar entry');
}
