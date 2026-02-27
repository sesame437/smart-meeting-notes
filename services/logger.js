/**
 * 结构化日志模块
 * 每条日志输出 JSON：{ timestamp, level, module, event, ...meta }
 */
const SERVICE = process.env.SERVICE_NAME || "meeting-minutes";

function fmt(level, module, event, meta = {}) {
  return JSON.stringify({ timestamp: new Date().toISOString(), level, service: SERVICE, module, event, ...meta });
}

const logger = {
  info:  (module, event, meta) => console.log(fmt("info",  module, event, meta)),
  warn:  (module, event, meta) => console.warn(fmt("warn",  module, event, meta)),
  error: (module, event, meta, err) => console.error(fmt("error", module, event,
    { ...meta, ...(err ? { error: err.message, stack: err.stack } : {}) }
  )),
};

module.exports = logger;
