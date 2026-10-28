#!/bin/bash

# API Verification Script for Business R&D Agent
# Tests the competitor tracking and feed endpoints directly

BASE_URL="https://business-rd-agent.onrender.com"
USERNAME="demo"
PASSWORD="demo1234"

echo "🔐 Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")

echo "Login response: $LOGIN_RESPONSE"

# Extract token from response
TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
if [ -z "$TOKEN" ]; then
  # Try alternative token field
  TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
fi

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to extract token from login response"
  exit 1
fi

echo "✅ Got token: ${TOKEN:0:20}..."

# Get list of projects
echo ""
echo "📋 Fetching projects..."
PROJECTS=$(curl -s -X GET "${BASE_URL}/api/sites" \
  -H "Authorization: Bearer $TOKEN")

echo "Projects: $PROJECTS"

# Extract project URLs (this will need adjustment based on actual response format)
# For now, we'll use a sample project URL - replace with actual ones
# PROJECT_URLS=$(echo "$PROJECTS" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)

# Manual project URLs - replace with your actual project URLs
PROJECT_URLS=(
  "https://example.com"
  # Add more project URLs here
)

for PROJECT_URL in "${PROJECT_URLS[@]}"; do
  echo ""
  echo "═══════════════════════════════════════"
  echo "📊 Testing project: $PROJECT_URL"
  echo "═══════════════════════════════════════"

  # 1. Get current competitors
  echo ""
  echo "1️⃣ Getting current competitors..."
  COMPETITORS=$(curl -s -X GET "${BASE_URL}/api/competitors?url=${PROJECT_URL}" \
    -H "Authorization: Bearer $TOKEN")
  echo "Competitors: $COMPETITORS"

  # 2. Trigger re-crawl (SSE stream - we'll use the non-streaming endpoint)
  echo ""
  echo "2️⃣ Triggering competitor re-crawl (force=true)..."
  RECRAWL=$(curl -s -X POST "${BASE_URL}/api/competitors" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"websiteUrl\":\"${PROJECT_URL}\",\"scope\":\"all\"}")
  echo "Re-crawl response: $RECRAWL"

  # 3. Wait a bit for re-crawl to complete (in reality, you'd poll the SSE stream)
  echo "   Waiting 30 seconds for re-crawl..."
  sleep 30

  # 4. Get updated competitors
  echo ""
  echo "3️⃣ Getting updated competitors after re-crawl..."
  COMPETITORS_AFTER=$(curl -s -X GET "${BASE_URL}/api/competitors?url=${PROJECT_URL}" \
    -H "Authorization: Bearer $TOKEN")
  echo "Competitors after re-crawl: $COMPETITORS_AFTER"

  # 5. Check competitor social accounts count
  echo ""
  echo "4️⃣ Verifying competitor social accounts..."
  # This would need jq to parse properly
  echo "$COMPETITORS_AFTER" | python3 -c "
import sys, json
data = json.load(sys.stdin)
comps = data.get('competitors', [])
for c in comps:
    socials = c.get('socials', {})
    count = sum(1 for v in socials.values() if v and isinstance(v, str) and v.strip())
    name = c.get('name', 'Unknown')
    status = '✅' if count >= 2 else '❌'
    print(f'   {status} {name}: {count} social accounts')
"

  # 6. Run competitor tracker
  echo ""
  echo "5️⃣ Running competitor tracker..."
  TRACKER=$(curl -s -X POST "${BASE_URL}/api/cron/run?url=${PROJECT_URL}" \
    -H "Authorization: Bearer $TOKEN")
  echo "Tracker start response: $TRACKER"

  # 7. Poll tracker status
  echo "   Polling tracker status..."
  for i in {1..60}; do
    STATUS=$(curl -s -X GET "${BASE_URL}/api/tracker/status?url=${PROJECT_URL}" \
      -H "Authorization: Bearer $TOKEN")
    RUNNING=$(echo "$STATUS" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('running', False))")
    PROGRESS=$(echo "$STATUS" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('progress', ''))")
    FEED_COUNT=$(echo "$STATUS" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('feedCount', 0))")

    echo "   [$i] Running: $RUNNING | Progress: $PROGRESS | Feed count: $FEED_COUNT"

    if [ "$RUNNING" = "False" ] || [ "$RUNNING" = "false" ]; then
      echo "   ✅ Tracker completed!"
      break
    fi
    sleep 10
  done

  # 8. Get competitor feed
  echo ""
  echo "6️⃣ Fetching competitor feed..."
  FEED=$(curl -s -X GET "${BASE_URL}/api/social-feed?url=${PROJECT_URL}" \
    -H "Authorization: Bearer $TOKEN")
  echo "Feed response: $FEED"

  # 9. Verify feed posts
  echo ""
  echo "7️⃣ Verifying feed posts..."
  echo "$FEED" | python3 -c "
import sys, json
data = json.load(sys.stdin)
feed = data.get('feed', [])
print(f'   Total posts: {len(feed)}')

# Group by platform
platforms = {}
for post in feed:
    platform = post.get('platform', 'Unknown')
    if platform not in platforms:
        platforms[platform] = 0
    platforms[platform] += 1

for platform, count in platforms.items():
    print(f'   {platform}: {count} posts')

# Check for media previews
posts_with_media = 0
for post in feed[:10]:  # Check first 10
    has_media = False
    for field in ['thumbnail', 'thumbnail_url', 'media_url', 'video_url', 'mediaUrl', 'mediaUrls']:
        if post.get(field):
            has_media = True
            break
    if has_media:
        posts_with_media += 1

print(f'   Posts with media (first 10): {posts_with_media}/10')
"

done

echo ""
echo "✅ API verification complete!"