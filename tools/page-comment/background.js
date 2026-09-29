/* 工具栏图标与快捷键都只做一件事：把命令转发给当前标签页的内容脚本。 */

async function send(cmd) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { cmd });
  } catch {
    // 标签页在装插件之前就打开了，内容脚本还没注入过。
    // 这里补注入而不是刷新页面 —— 刷新会丢掉用户在页面上的滚动位置和表单内容。
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      await chrome.tabs.sendMessage(tab.id, { cmd });
    } catch { /* chrome:// 等页面不允许注入，静默忽略 */ }
  }
}

chrome.action.onClicked.addListener(() => send('toggle-panel'));
chrome.commands.onCommand.addListener((c) => send(c));
