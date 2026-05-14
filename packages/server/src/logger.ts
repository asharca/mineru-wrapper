type LogData = Record<string, unknown>;

function log(level: "info" | "warn" | "error", msg: string, data?: LogData): void {
  const entry = JSON.stringify({ level, msg, ...data, ts: new Date().toISOString() });
  if (level === "error") {
    process.stderr.write(`${entry}\n`);
  } else {
    process.stdout.write(`${entry}\n`);
  }
}

export const logger = {
  info: (msg: string, data?: LogData) => log("info", msg, data),
  warn: (msg: string, data?: LogData) => log("warn", msg, data),
  error: (msg: string, data?: LogData) => log("error", msg, data),
};
