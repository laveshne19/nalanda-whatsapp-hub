'use strict';

/** Send a note to the staff chat. Never throws. Returns true if it went out. */
async function notifyStaff(deps, text) {
  const { openwa, config, state } = deps;
  const log = deps.log || (() => {});
  if (!config.staffChat) return false;
  try {
    // note the words first: WhatsApp can report our own message before this call returns
    state.rememberBotText(config.staffChat, text, deps.now ? deps.now() : Date.now());
    const r = await openwa.sendText(config.staffChat, text);
    if (r && r.messageId) state.rememberBotMessage(r.messageId);
    return true;
  } catch (e) {
    log(`[staff] notify failed: ${e.message}`);
    state.bump('send_failed', deps.now ? deps.now() : Date.now());
    return false;
  }
}

/** Send to a specific chat without counting against the customer reply budget. Never throws. */
async function sendDirect(deps, chatId, text) {
  try {
    deps.state.rememberBotText(chatId, text, deps.now ? deps.now() : Date.now());
    const r = await deps.openwa.sendText(chatId, text);
    if (r && r.messageId) deps.state.rememberBotMessage(r.messageId);
    return true;
  } catch (e) {
    (deps.log || (() => {}))(`[send] failed: ${e.message}`);
    return false;
  }
}

module.exports = { notifyStaff, sendDirect };
