import { ChatOpenAI } from "@langchain/openai";
import { createLogger } from "../utils/logger.js";
import fs from "fs";
import path from "path";

const logger = createLogger("DiagnosticAgent");

export class DiagnosticAgent {
  readonly name = "diagnostic-agent";
  readonly version = "1.0.0";

  async run(logs: string): Promise<string> {
    logger.info("Analyzing execution logs for issues...");

    if (!logs || logs.trim().length === 0) {
      logger.warn("No logs provided to analyze.");
      return "No logs provided.";
    }

    const llm = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0.1,
    });

    const prompt = `You are a DevOps and AI System Diagnostic Agent.
Your job is to read the raw runtime logs of an AI Agent pipeline, figure out what worked, what failed, and provide an actionable diagnostic report.

RAW LOGS:
${logs.slice(-50000)} // Truncating to last 50k chars to fit context

Analyze the logs and output a Markdown-formatted report with the following structure:
# Execution Diagnostic Report
## Status
(Success, Partial Failure, Total Failure)

## Component Summary
(List which agents/tools successfully completed their tasks)

## Issues Detected
(List any errors, warnings, 403 rate limits, exceptions, JSON parsing errors, or missing data anomalies)

## Remediation Plan
(Actionable steps or code fixes to resolve the issues detected. If no issues, state "System is stable.")

OUTPUT ONLY THE MARKDOWN REPORT.`;

    try {
      const response = await llm.invoke(prompt);
      const report = response.content.toString();
      
      const outPath = path.join(process.cwd(), "diagnostic_report.md");
      fs.writeFileSync(outPath, report, "utf8");
      
      logger.success(`Diagnostic report saved to ${outPath}`);
      return report;
    } catch (e) {
      logger.error(`Failed to run diagnostics: ${e}`);
      return "Diagnostic execution failed.";
    }
  }
}
