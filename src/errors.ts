import type { QcReport } from "./types.js";

export class QcFailureError extends Error {
  constructor(
    message: string,
    readonly qc: QcReport,
  ) {
    super(message);
    this.name = "QcFailureError";
  }
}
