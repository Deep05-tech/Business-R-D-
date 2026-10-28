#!/usr/bin/env python3
"""
API Verification Script for Business R&D Agent on Render
Tests competitor tracking and feed endpoints directly
"""

import requests
import json
import time
import sys
from pathlib import Path

# Try to import sseclient, fall back to non-streaming if not available
try:
    import sseclient
    HAS_SSE = True
except ImportError:
    print("⚠️ sseclient not available, using non-streaming endpoint with longer timeout")
    HAS_SSE = False

BASE_URL = "https://business-rd-agent.onrender.com"
USERNAME = "demo"
PASSWORD = "demo1234"

def login():
    """Login and get auth token"""
    print("🔐 Logging in...")
    response = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": USERNAME, "password": PASSWORD},
        timeout=30
    )
    if response.status_code != 200:
        print(f"❌ Login failed: {response.status_code} - {response.text}")
        return None

    data = response.json()
    token = data.get("token") or data.get("accessToken")
    if not token:
        print(f"❌ No token in response: {data}")
        return None

    print(f"✅ Got token: {token[:20]}...")
    return token

def get_projects(token):
    """Get list of projects"""
    print("\n📋 Fetching projects...")
    response = requests.get(
        f"{BASE_URL}/api/sites",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30
    )
    if response.status_code != 200:
        print(f"❌ Failed to get projects: {response.status_code}")
        return []

    projects = response.json()
    print(f"Found {len(projects)} projects")
    return projects

def get_competitors(token, project_url):
    """Get competitors for a project"""
    response = requests.get(
        f"{BASE_URL}/api/competitors",
        params={"url": project_url},
        headers={"Authorization": f"Bearer {token}"},
        timeout=60
    )
    if response.status_code != 200:
        print(f"❌ Failed to get competitors: {response.status_code} - {response.text}")
        return []
    return response.json().get("competitors", [])

def trigger_competitor_discovery(token, project_url, force=True):
    """Trigger competitor discovery (streaming if available, otherwise non-streaming)"""
    if HAS_SSE:
        return _trigger_competitor_discovery_stream(token, project_url, force)
    else:
        return _trigger_competitor_discovery_nonstream(token, project_url, force)


def _trigger_competitor_discovery_stream(token, project_url, force=True):
    """Trigger competitor discovery via SSE stream"""
    print("🔄 Triggering competitor discovery (streaming)...")
    import sseclient

    url = f"{BASE_URL}/api/competitors-stream"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream"
    }
    data = {"websiteUrl": project_url, "scope": "all", "force": force}

    try:
        response = requests.post(url, json=data, headers=headers, stream=True, timeout=300)
        if response.status_code != 200:
            print(f"❌ Discovery failed: {response.status_code} - {response.text}")
            return False

        client = sseclient.SSEClient(response)
        competitor_count = 0
        for event in client.events():
            if event.event == 'competitor':
                competitor_count += 1
                comp_data = json.loads(event.data)
                print(f"   📍 Found competitor: {comp_data.get('competitor', {}).get('name', 'Unknown')}")
            elif event.event == 'progress':
                progress_data = json.loads(event.data)
                print(f"   📈 {progress_data.get('status', '')}")
            elif event.event == 'complete':
                complete_data = json.loads(event.data)
                competitors = complete_data.get('competitors', [])
                print(f"✅ Discovery completed: {len(competitors)} competitors found")
                return True
            elif event.event == 'error':
                error_data = json.loads(event.data)
                print(f"❌ Discovery error: {error_data.get('error', 'Unknown error')}")
                return False
    except Exception as e:
        print(f"❌ Streaming error: {e}")
        return False

    return False


def _trigger_competitor_discovery_nonstream(token, project_url, force=True):
    """Trigger competitor discovery via non-streaming endpoint (longer timeout)"""
    print("🔄 Triggering competitor discovery (non-streaming, may take 2-5 minutes)...")
    response = requests.post(
        f"{BASE_URL}/api/competitors",
        json={"websiteUrl": project_url, "scope": "all"},
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=300  # 5 minutes
    )
    if response.status_code != 200:
        print(f"❌ Discovery failed: {response.status_code} - {response.text}")
        return False
    data = response.json()
    print(f"✅ Discovery completed: {len(data.get('competitors', []))} competitors found")
    return True

def run_tracker(token, project_url):
    """Run competitor tracker"""
    print("🚀 Starting competitor tracker...")
    response = requests.post(
        f"{BASE_URL}/api/cron/run",
        params={"url": project_url},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30
    )
    if response.status_code != 200:
        print(f"❌ Tracker start failed: {response.status_code} - {response.text}")
        return False
    data = response.json()
    print(f"✅ Tracker started: {data.get('message', 'OK')}")
    return True

def get_tracker_status(token, project_url):
    """Get tracker status"""
    response = requests.get(
        f"{BASE_URL}/api/tracker/status",
        params={"url": project_url},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30
    )
    if response.status_code != 200:
        return None
    return response.json()

def get_social_feed(token, project_url):
    """Get competitor social feed"""
    response = requests.get(
        f"{BASE_URL}/api/social-feed",
        params={"url": project_url},
        headers={"Authorization": f"Bearer {token}"},
        timeout=60
    )
    if response.status_code != 200:
        print(f"❌ Failed to get feed: {response.status_code} - {response.text}")
        return None
    return response.json()

def verify_competitor_socials(competitors):
    """Verify all competitors have >= 2 social accounts"""
    print("\n🔍 Verifying competitor social accounts...")
    all_passed = True
    for comp in competitors:
        socials = comp.get("socials", {})
        count = sum(1 for v in socials.values() if v and isinstance(v, str) and v.strip())
        name = comp.get("name", "Unknown")
        status = "✅" if count >= 2 else "❌"
        if count < 2:
            all_passed = False
        print(f"   {status} {name}: {count} social accounts ({list(socials.keys())})")
    return all_passed

def verify_feed_posts(feed_data):
    """Verify feed posts have previews and proper structure"""
    print("\n🔍 Verifying feed posts...")
    feed = feed_data.get("feed", []) if feed_data else []
    print(f"   Total posts in feed: {len(feed)}")

    # Group by platform
    platforms = {}
    for post in feed:
        platform = post.get("platform", "Unknown")
        platforms[platform] = platforms.get(platform, 0) + 1

    for platform, count in sorted(platforms.items()):
        print(f"   {platform}: {count} posts")

    # Check for media previews in first 10 posts
    posts_with_media = 0
    posts_with_caption = 0
    for post in feed[:10]:
        has_media = False
        for field in ["thumbnail", "thumbnail_url", "media_url", "video_url", "mediaUrl", "mediaUrls", "shortcode"]:
            if post.get(field):
                has_media = True
                break
        if has_media:
            posts_with_media += 1

        caption = post.get("caption", "") or post.get("content", "")
        if caption and caption.strip() and caption not in ["No caption", "No caption."]:
            posts_with_caption += 1

    print(f"   Posts with media (first 10): {posts_with_media}/10")
    print(f"   Posts with captions (first 10): {posts_with_caption}/10")

    return {
        "total_posts": len(feed),
        "platforms": platforms,
        "posts_with_media": posts_with_media,
        "posts_with_caption": posts_with_caption
    }

def wait_for_tracker(token, project_url, max_wait=600):
    """Wait for tracker to complete"""
    print("⏳ Waiting for tracker to complete...")
    start = time.time()
    while time.time() - start < max_wait:
        status = get_tracker_status(token, project_url)
        if not status:
            print("   ⚠️ Could not get status")
            time.sleep(10)
            continue

        running = status.get("running", False)
        progress = status.get("progress", "")
        feed_count = status.get("feedCount", 0)
        elapsed = status.get("elapsedSec", 0)

        print(f"   [{elapsed}s] Running: {running} | {progress} | Feed: {feed_count}")

        if not running:
            print("✅ Tracker completed!")
            return True

        time.sleep(10)

    print("⚠️ Tracker timeout")
    return False

def main():
    print("=" * 60)
    print("🚀 Business R&D Agent - Deployment Verification")
    print(f"🌐 Target: {BASE_URL}")
    print("=" * 60)

    # Login
    token = login()
    if not token:
        sys.exit(1)

    # Get projects
    projects = get_projects(token)
    if not projects:
        print("❌ No projects found")
        sys.exit(1)

    # Print project list
    print("\n📋 Available Projects:")
    for i, p in enumerate(projects):
        print(f"   {i+1}. {p.get('name', 'Unknown')} - {p.get('url', 'Unknown')}")

    # Test each project
    all_results = []
    for project in projects:
        project_url = project.get("url")
        project_name = project.get("name", project_url)

        print("\n" + "=" * 60)
        print(f"📊 TESTING PROJECT: {project_name}")
        print(f"   URL: {project_url}")
        print("=" * 60)

        result = {
            "project": project_name,
            "url": project_url,
            "competitor_discovery": False,
            "competitor_socials": False,
            "tracker_completion": False,
            "feed_verification": None
        }

        # 1. Get current competitors
        print("\n1️⃣ Getting current competitors...")
        competitors_before = get_competitors(token, project_url)
        print(f"   Found {len(competitors_before)} competitors")

        # 2. Trigger re-crawl (force)
        result["competitor_discovery"] = trigger_competitor_discovery(token, project_url, force=True)

        if not result["competitor_discovery"]:
            all_results.append(result)
            continue

        # 3. Get updated competitors
        print("\n2️⃣ Getting competitors after re-crawl...")
        competitors_after = get_competitors(token, project_url)
        print(f"   Found {len(competitors_after)} competitors")

        # 4. Verify social accounts
        result["competitor_socials"] = verify_competitor_socials(competitors_after)

        # 5. Run tracker
        print("\n3️⃣ Running competitor tracker...")
        if run_tracker(token, project_url):
            # 6. Wait for completion
            result["tracker_completion"] = wait_for_tracker(token, project_url)

            # 7. Get and verify feed
            if result["tracker_completion"]:
                print("\n4️⃣ Fetching competitor feed...")
                feed_data = get_social_feed(token, project_url)
                if feed_data:
                    result["feed_verification"] = verify_feed_posts(feed_data)
                else:
                    print("❌ No feed data returned")
        else:
            print("❌ Failed to start tracker")

        all_results.append(result)

        # Brief pause between projects
        time.sleep(3)

    # Summary
    print("\n" + "=" * 60)
    print("📊 VERIFICATION SUMMARY")
    print("=" * 60)

    for result in all_results:
        print(f"\n📁 {result['project']}")
        print(f"   Competitor Discovery:  {'✅ PASS' if result['competitor_discovery'] else '❌ FAIL'}")
        print(f"   Social Accounts (≥2):  {'✅ PASS' if result['competitor_socials'] else '❌ FAIL'}")
        print(f"   Tracker Completion:    {'✅ PASS' if result['tracker_completion'] else '❌ FAIL'}")
        if result["feed_verification"]:
            fv = result["feed_verification"]
            print(f"   Feed Posts:            {fv['total_posts']} total")
            print(f"   Posts with Media:      {fv['posts_with_media']}/10")
            print(f"   Posts with Captions:   {fv['posts_with_caption']}/10")

    # Overall
    all_passed = all(
        r["competitor_discovery"] and
        r["competitor_socials"] and
        r["tracker_completion"] and
        r["feed_verification"] is not None
        for r in all_results
    )

    print("\n" + "=" * 60)
    if all_passed:
        print("🎉 ALL VERIFICATIONS PASSED!")
    else:
        print("⚠️ SOME VERIFICATIONS FAILED")
    print("=" * 60)

    # Save results
    with open("verification-results.json", "w") as f:
        json.dump(all_results, f, indent=2)
    print("\n📄 Detailed results saved to verification-results.json")

if __name__ == "__main__":
    main()