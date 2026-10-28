---
name: verify-deployment-api-endpoints
description: Verify API endpoints for competitor tracking and feed generation
metadata:
  type: reference
---

## Deployment Verification Checklist

### 1. API Endpoints to Test

The following endpoints should be available at `https://business-rd-agent.onrender.com/`:

```
- POST /api/analyze/stream?url=... (New Analysis)
- POST /api/competitors/discover (Find Competitors)
- POST /api/competitors/analyze (Competitor Analysis)
- POST /api/competitors/re-crawl (Re-crawl Deeply)
- POST /api/competitors/tracker (Run Competitor Tracker)
- GET /api/competitors/feed (Competitor Feed)
- GET /api/social/feed (Company Social Feed)
```

### 2. Manual Testing Instructions

Since direct browser automation isn't possible here, here's how you can verify this manually:

#### For Competitor Re-crawl:
1. Log in to the dashboard with credentials: `username: demo`, `password: demo1234`
2. Navigate to a project
3. Go to the **Competitors** tab
4. Click **Find Competitors** to discover initial competitors
5. Click **Re-crawl Deeply** to trigger deep competitor crawling

#### For Competitor Feed:
1. After re-crawling, click **Run Competitor Tracker Now**
2. Verify that:
   - All competitors have at least 2 social accounts
   - Social posts are populated with previews
   - Clicking a post opens a lightbox with:
     * Left side: Image/video preview
     * Right side: Full caption and metadata

### 3. Code Review Checklist

Check these files for implementation:
- `src/server.ts` - Competitor API endpoints
- `src/agents/socialExtractorAgent.ts` - Social media extraction logic
- `src/agents/smmAgent.ts` - Social media tracking logic
- `src/static/index.html` - Competitor feed UI components
- `src/static/app.js` - Feed rendering logic

### 4. API Testing Script

Here's a curl script you can run to test the competitor tracking API:

```bash
curl -X POST "https://business-rd-agent.onrender.com/api/competitors/re-crawl" -H "Content-Type: application/json" -d '{"projectId": "YOUR_PROJECT_ID"}'
curl -X POST "https://business-rd-agent.onrender.com/api/competitors/tracker" -H "Content-Type: application/json" -d '{"projectId": "YOUR_PROJECT_ID"}'
```

### 5. Next Steps

I'll:
1. Review the codebase for these features
2. Provide a script you can run locally to verify functionality
3. Confirm the implementation matches your requirements

Please let me know if you'd like me to:
- Create a Playwright script for local testing
- Review specific code sections
- Provide detailed instructions for manual verification