# Business R&D Multi-Agent Intelligence System

Production-oriented TypeScript service that accepts only a mandatory website URL and optional social media URLs, then returns a QC-validated structured business intelligence profile.

## Run

```bash
npm install
npm run dev
```

## API

```http
POST /business-intelligence
Content-Type: application/json

{
  "websiteUrl": "https://example.com",
  "socialUrls": ["https://www.linkedin.com/company/example"]
}
```

Only `websiteUrl` and `socialUrls` are accepted. Extra input keys are rejected.

The response includes:

- Business Identity Summary
- Industry Classification
- Offerings Breakdown
- Audience Profile
- Brand Positioning
- Digital Maturity Report
- R&D Insights
- Structured JSON Memory Object

Generated memory objects are stored in `data/memory`.
