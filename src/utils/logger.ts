export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SUCCESS = 4,
}

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

export class Logger {
  public static globalLogBuffer: string[] = [];

  constructor(private context: string) {}

  public static getLogs(): string {
    return Logger.globalLogBuffer.join("\n");
  }

  public static clearLogs(): void {
    Logger.globalLogBuffer = [];
  }

  private formatMessage(level: string, color: string, message: string): string {
    const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
    const plainText = `[${timestamp}] [${level}] [${this.context}] ${message}`;
    Logger.globalLogBuffer.push(plainText);
    
    return `${colors.dim}[${timestamp}]${colors.reset} ${color}[${level}]${colors.reset} ${colors.cyan}[${this.context}]${colors.reset} ${message}`;
  }

  debug(message: string, ...args: any[]) {
    console.debug(this.formatMessage("DEBUG", colors.dim, message), ...args);
  }

  info(message: string, ...args: any[]) {
    console.info(this.formatMessage("INFO", colors.blue, message), ...args);
  }

  success(message: string, ...args: any[]) {
    console.log(this.formatMessage("SUCCESS", colors.green, message), ...args);
  }

  warn(message: string, ...args: any[]) {
    console.warn(this.formatMessage("WARN", colors.yellow, message), ...args);
  }

  error(message: string, ...args: any[]) {
    console.error(this.formatMessage("ERROR", colors.red, message), ...args);
  }
}

export const createLogger = (context: string) => new Logger(context);
