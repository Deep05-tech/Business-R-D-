/**
 * Strict Social Verification Utility
 * 
 * Ensures agents only discover authentic competitor accounts and only accept
 * social posts authored directly by the competitor. Rejects third-party posts,
 * Facebook groups, personal profiles, unrelated vendors, and foreign entities.
 */

export interface DistinctiveTokens {
    primaryTokens: string[];
    genericTokens: string[];
    coreBrandKey: string;
}

const LEGAL_STOPWORDS = new Set([
    'pvt', 'ltd', 'private', 'limited', 'inc', 'incorporated', 'llc', 'corp', 'corporation',
    'co', 'company', 'gmbh', 'sro', 'sa', 'nv', 'ag', 'plc', 'holding', 'holdings', 'group',
    'the', 'and', 'of', 'for', 'in', 'at', 'by', 'to', 'from', 'with', 'a', 'an'
]);

const GENERIC_INDUSTRY_WORDS = new Set([
    'cast', 'casts', 'casting', 'castings', 'die', 'dies', 'foundry', 'foundries', 'forge', 'forging', 'forgings',
    'steel', 'steels', 'iron', 'metal', 'metals', 'alloy', 'alloys', 'precision',
    'industries', 'industry', 'industrial', 'engineering', 'engineers', 'services',
    'solutions', 'tech', 'techno', 'technology', 'enterprises', 'international',
    'global', 'products', 'components', 'manufacturing', 'mfg', 'machine', 'machining',
    'stamping', 'stampings', 'extrusion', 'extrusions',
    'works', 'enterprise', 'commercial', 'corporate', 'official', 'india', 'usa',
    'germany', 'china', 'uk', 'europe'
]);

const DISQUALIFIED_ROUTE_SEGMENTS = new Set([
    'p', 'reel', 'reels', 'tv', 'explore', 'direct', 'accounts', 'stories', 'share',
    'sharer', 'login', 'about', 'help', 'policies', 'settings', 'dialog', 'events',
    'photo', 'photos', 'story', 'permalink', 'watch', 'videos', 'popular', 'tags',
    'locations', 'wix', 'intent', 'cws', 'profile.php', 'recover', 'hashtag'
]);

const DISQUALIFIED_SUBSTRINGS = [
    '/groups/',
    '/community/',
    'castingcalls',
    'castingagency',
    'auditions',
    'audition',
    'actor',
    'actress',
    'model',
    'cityof',
    'tourism',
    'police',
    'indiamart.com',
    'merriam-webster.com',
    'dictionary.com',
    'thesaurus.com',
    'wikipedia.org',
    'wiktionary.org'
];

/**
 * Extracts distinctive brand tokens vs generic industry terms from a competitor name.
 */
export function extractDistinctiveBrandTokens(brandName: string): DistinctiveTokens {
    if (!brandName || typeof brandName !== 'string') {
        return { primaryTokens: [], genericTokens: [], coreBrandKey: '' };
    }

    const clean = brandName
        .toLowerCase()
        .replace(/^m\/s\.?\s+/i, '')
        .split(/[-–—|(/]/)[0]
        .replace(/[^\w\s.]/g, ' ')
        .trim();

    // Check for acronyms / initials like "A.V.", "J.K.", "S.S.", "J S"
    const acronymMatch = clean.match(/^([a-z])\.?\s*([a-z])\.?\s+/i);
    const acronym = acronymMatch ? `${acronymMatch[1]}${acronymMatch[2]}`.toLowerCase() : '';

    const words = clean.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
    const primaryTokens: string[] = [];
    const genericTokens: string[] = [];

    if (acronym) {
        primaryTokens.push(acronym);
    }

    for (const w of words) {
        if (LEGAL_STOPWORDS.has(w)) continue;
        if (GENERIC_INDUSTRY_WORDS.has(w)) {
            genericTokens.push(w);
        } else if (w.length >= 3) {
            primaryTokens.push(w);
        }
    }

    // If initials exist and there is a next word, combine them (e.g. "av" + "steel" -> "avsteel")
    if (acronym && words.length > 0) {
        const firstMeaningfulWord = words.find(w => !LEGAL_STOPWORDS.has(w) && w !== acronym);
        if (firstMeaningfulWord) {
            primaryTokens.push(`${acronym}${firstMeaningfulWord}`);
        }
    }

    // If all words were considered generic (e.g. "Fine Cast" or "Star Foundry"), 
    // promote the first token as the primary identifier.
    if (primaryTokens.length === 0 && words.length > 0) {
        const nonStop = words.filter(w => !LEGAL_STOPWORDS.has(w));
        if (nonStop.length > 0) {
            primaryTokens.push(nonStop[0]);
        }
    }

    const coreBrandKey = primaryTokens.filter(t => t.length >= 3).join('') || primaryTokens[0] || words.filter(w => !LEGAL_STOPWORDS.has(w)).join('');

    return { primaryTokens, genericTokens, coreBrandKey };
}

/**
 * Extracts the candidate profile handle/slug from a social URL.
 */
export function extractProfileHandle(url: string, platform: string): string {
    if (!url || typeof url !== 'string') return '';
    try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        const segments = parsed.pathname.split('/').filter(Boolean);
        if (segments.length === 0) return '';

        const plat = platform.toLowerCase();
        if (plat.includes('instagram')) {
            if (segments[0].toLowerCase() === 'p' || segments[0].toLowerCase() === 'reel') return '';
            return segments[0].toLowerCase();
        }
        if (plat.includes('facebook')) {
            if (segments[0].toLowerCase() === 'groups') return '';
            if (segments[0].toLowerCase() === 'p' && segments[1]) return segments[1].toLowerCase();
            if (segments[0].toLowerCase() === 'people' && segments[1]) return segments[1].toLowerCase();
            if (segments[0].toLowerCase() === 'pages' && segments.length > 1) {
                return segments[segments.length - 1].toLowerCase();
            }
            if (segments[0].toLowerCase() === 'profile.php') {
                const idParam = parsed.searchParams.get('id');
                if (idParam) return `id_${idParam}`;
            }
            return segments[0].toLowerCase();
        }
        if (plat.includes('linkedin')) {
            if (segments[0].toLowerCase() === 'company' && segments[1]) return segments[1].toLowerCase();
            if (segments[0].toLowerCase() === 'in' && segments[1]) return segments[1].toLowerCase();
            return segments[0].toLowerCase();
        }
        if (plat.includes('youtube')) {
            if (segments[0].startsWith('@')) return segments[0].slice(1).toLowerCase();
            if ((segments[0] === 'c' || segments[0] === 'channel' || segments[0] === 'user') && segments[1]) {
                return segments[1].toLowerCase();
            }
            return segments[0].toLowerCase();
        }
        return segments[0].toLowerCase();
    } catch {
        return '';
    }
}

/**
 * Validates whether a candidate social profile URL belongs to the competitor.
 */
export function isAuthenticCompetitorProfile(
    url: string,
    platform: string,
    competitorName: string,
    pageTitle?: string
): boolean {
    if (!url || typeof url !== 'string' || !competitorName) return false;
    const lowerUrl = url.toLowerCase().trim();

    // 1. Strict platform domain validation
    const platLower = (platform || '').toLowerCase();
    if (platLower.includes('instagram') && !lowerUrl.includes('instagram.com/')) return false;
    if (platLower.includes('facebook') && !lowerUrl.includes('facebook.com/')) return false;
    if (platLower.includes('linkedin') && !lowerUrl.includes('linkedin.com/')) return false;
    if (platLower.includes('youtube') && !lowerUrl.includes('youtube.com/') && !lowerUrl.includes('youtu.be/')) return false;

    // 2. Immediate disqualifiers
    for (const bad of DISQUALIFIED_SUBSTRINGS) {
        if (lowerUrl.includes(bad)) return false;
    }

    // Reject generic domain roots (e.g. facebook.com, instagram.com, facebook.com/facebook)
    if (
        lowerUrl === 'https://facebook.com' || lowerUrl === 'https://www.facebook.com' ||
        lowerUrl === 'https://instagram.com' || lowerUrl === 'https://www.instagram.com' ||
        lowerUrl === 'https://youtube.com' || lowerUrl === 'https://www.youtube.com' ||
        lowerUrl === 'https://linkedin.com' || lowerUrl === 'https://www.linkedin.com' ||
        lowerUrl.includes('facebook.com/facebook') || lowerUrl.includes('instagram.com/instagram')
    ) {
        return false;
    }

    const handle = extractProfileHandle(url, platform);
    if (!handle || DISQUALIFIED_ROUTE_SEGMENTS.has(handle)) {
        return false;
    }

    const { primaryTokens, coreBrandKey } = extractDistinctiveBrandTokens(competitorName);
    const cleanHandle = handle.replace(/[^a-z0-9]/g, '');
    const cleanTitle = (pageTitle || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

    // 2. High-confidence direct match
    if (coreBrandKey.length >= 4 && (cleanHandle.includes(coreBrandKey) || coreBrandKey.includes(cleanHandle))) {
        return true;
    }

    // 3. Primary distinctive token match
    // At least one primary brand token (length >= 3) must be in the handle or page title
    let hasPrimaryMatch = false;
    for (const token of primaryTokens) {
        if (token.length >= 3) {
            if (cleanHandle.includes(token)) {
                hasPrimaryMatch = true;
                break;
            }
            if (cleanTitle && cleanTitle.includes(token)) {
                hasPrimaryMatch = true;
                break;
            }
        }
    }

    if (!hasPrimaryMatch) {
        return false;
    }

    // 4. Foreign entity conflict guard:
    // If the competitor has a lead primary token (e.g. "metalix", "decatur", "acme", "seneca", "samarth", "kotecha"),
    // but the handle is clearly prefixed with a conflicting distinctive name (e.g. "inverseferrocast", "luxuryvending", "cityofdecatural"),
    // reject the mismatch.
    if (primaryTokens.length >= 2) {
        const leadToken = primaryTokens[0];
        // If the handle doesn't contain the lead token, and has an unrelated prefix
        if (!cleanHandle.includes(leadToken)) {
            // Check if page title contains the lead token
            if (!cleanTitle.includes(leadToken)) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Validates whether a scraped social post was authored by the competitor.
 */
export function verifyPostAuthor(
    platform: string,
    postDetails: {
        authorHandle?: string;
        authorName?: string;
        postUrl: string;
        ogTitle?: string;
        ogDesc?: string;
        caption?: string;
    },
    competitorName: string,
    verifiedProfileUrl?: string | null
): boolean {
    if (!competitorName || typeof competitorName !== 'string' || competitorName.trim().length === 0) {
        return false;
    }

    const lowerUrl = (postDetails.postUrl || '').toLowerCase();

    // 1. Universal disqualifiers
    if (lowerUrl.includes('/groups/') || lowerUrl.includes('/community/') || lowerUrl.includes('castingcalls')) {
        return false; // Group and casting agency posts are never official company posts
    }

    if ((platform || '').toLowerCase().includes('instagram') && isInstagramBundleHash(lowerUrl)) {
        return false; // Discard Instagram static JS bundle chunk paths
    }

    const { primaryTokens, coreBrandKey } = extractDistinctiveBrandTokens(competitorName);
    if (primaryTokens.length === 0 && coreBrandKey.length === 0) {
        return false;
    }

    // 2. High-confidence: If a verified profile URL is known and matches the post, author is guaranteed authentic
    const isProfileAuthentic = verifiedProfileUrl ? isAuthenticCompetitorProfile(verifiedProfileUrl, platform, competitorName) : false;
    const effectiveProfileUrl = isProfileAuthentic ? verifiedProfileUrl : null;

    if (effectiveProfileUrl) {
        const verifiedHandle = extractProfileHandle(effectiveProfileUrl, platform);
        if (verifiedHandle) {
            const cleanVerified = verifiedHandle.replace(/[^a-z0-9]/g, '');

            // For Instagram: check extracted author handle
            if (platform.toLowerCase().includes('instagram') && postDetails.authorHandle) {
                const cleanAuthor = postDetails.authorHandle.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (cleanAuthor === cleanVerified) return true;
                if (cleanAuthor.length >= 4 && (cleanAuthor.includes(cleanVerified) || cleanVerified.includes(cleanAuthor))) {
                    return true;
                }
            }

            // For Facebook: check URL slug or numerical page ID
            if (platform.toLowerCase().includes('facebook')) {
                const urlHandle = extractProfileHandle(lowerUrl, 'Facebook');
                if (urlHandle) {
                    const cleanUrlHandle = urlHandle.replace(/[^a-z0-9]/g, '');
                    if (cleanUrlHandle === cleanVerified) return true;
                }
                const profileIdMatch = effectiveProfileUrl.match(/(?:\/people\/[^\/]+\/|\/pages\/[^\/]+\/|\bprofile\.php\?id=|\/)(\d{10,25})/);
                const postProfileIdMatch = lowerUrl.match(/(?:[?&]id=|\/posts\/|\/photos\/|\bset=a\.)(\d{10,25})/);
                if (profileIdMatch && postProfileIdMatch && profileIdMatch[1] === postProfileIdMatch[1]) {
                    return true;
                }
            }

            // For LinkedIn: check company slug in URL
            if (platform.toLowerCase().includes('linkedin')) {
                const verifiedLiHandle = extractProfileHandle(effectiveProfileUrl, 'LinkedIn');
                const postLiHandle = extractProfileHandle(lowerUrl, 'LinkedIn');
                if (verifiedLiHandle && postLiHandle && verifiedLiHandle.toLowerCase() === postLiHandle.toLowerCase()) {
                    return true;
                }
            }
        }
    }

    // 3. Content checking for non-verified or secondary discovery posts
    const fullText = [
        postDetails.ogTitle || '',
        postDetails.ogDesc || '',
        postDetails.caption || '',
        postDetails.authorName || '',
        postDetails.authorHandle || ''
    ].join(' ').toLowerCase();

    // Foreign vertical blacklist in post content (only specific non-commercial / actor audition noise)
    const FOREIGN_POST_MARKERS = [
        'casting call', 'casting calls', 'audition for actor', 'acting auditions', 'acting workshop',
        'perfume vending', 'vending machine', 'fragrancecollection', 'pradaparadoxe',
        'visiting card design', 'visitingcard', 'brandingwala',
        'asbury church', 'nationallottery', 'heritagefund'
    ];

    for (const marker of FOREIGN_POST_MARKERS) {
        if (fullText.includes(marker)) {
            return false;
        }
    }

    // 4. Instagram Author Matching
    if (platform.toLowerCase().includes('instagram')) {
        const authorHandle = (postDetails.authorHandle || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const authorName = (postDetails.authorName || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

        if (authorHandle) {
            if (coreBrandKey.length >= 4 && (authorHandle.includes(coreBrandKey) || coreBrandKey.includes(authorHandle))) {
                return true;
            }
            for (const t of primaryTokens) {
                if (t.length >= 3 && authorHandle.includes(t)) {
                    if (primaryTokens.length >= 2 && !authorHandle.includes(primaryTokens[0])) {
                        continue;
                    }
                    return true;
                }
            }
        }

        if (authorName) {
            for (const t of primaryTokens) {
                if (t.length >= 3 && authorName.includes(t)) {
                    return true;
                }
            }
        }

        // If author handle or name was extracted and mismatched, reject
        if (authorHandle || authorName) {
            return false;
        }
    }

    // 5. Facebook Author Matching
    if (platform.toLowerCase().includes('facebook')) {
        let extractedAuthor = postDetails.authorName || '';

        if (!extractedAuthor && postDetails.ogTitle) {
            const ogT = postDetails.ogTitle.trim();
            const reelMatch = ogT.match(/^(.*?)\s+on Reels/i);
            const pipeMatch = ogT.match(/\|\s*([^|]+)$/);
            const dashMatch = ogT.match(/^(.*?)\s*-\s*/);
            if (reelMatch && reelMatch[1]) {
                extractedAuthor = reelMatch[1].trim();
            } else if (pipeMatch && pipeMatch[1]) {
                extractedAuthor = pipeMatch[1].trim();
            } else if (dashMatch && dashMatch[1]) {
                extractedAuthor = dashMatch[1].trim();
            }
        }

        const cleanAuthor = extractedAuthor.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
        const urlHandle = extractProfileHandle(lowerUrl, 'Facebook').replace(/[^a-z0-9]/g, '');

        if (cleanAuthor && !cleanAuthor.includes('facebook') && !cleanAuthor.includes('video') && cleanAuthor.length > 3) {
            let authorMatches = false;
            for (const t of primaryTokens) {
                if (t.length >= 3 && cleanAuthor.includes(t)) {
                    authorMatches = true;
                    break;
                }
            }
            if (coreBrandKey.length >= 4 && cleanAuthor.includes(coreBrandKey)) {
                authorMatches = true;
            }
            if (!authorMatches) {
                return false;
            }
            return true;
        }

        if (urlHandle) {
            for (const t of primaryTokens) {
                if (t.length >= 3 && urlHandle.includes(t)) {
                    return true;
                }
            }
        }
    }

    // 6. YouTube Matching
    if (platform.toLowerCase().includes('youtube')) {
        const authorName = (postDetails.authorName || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
        if (authorName && authorName.length >= 3) {
            if (primaryTokens.length >= 2) {
                const leadToken = primaryTokens[0];
                if (!authorName.includes(leadToken)) {
                    return false;
                }
            }
            for (const t of primaryTokens) {
                if (t.length >= 3 && authorName.includes(t)) return true;
            }
            return false;
        }
    }

    // 7. Core Brand Containment Requirement
    // A post must have at least one primary brand token in its URL, author, or content
    const cleanUrl = lowerUrl.replace(/[^a-z0-9]/g, '');
    const cleanContent = fullText.replace(/[^a-z0-9\s]/g, ' ');

    // For multi-word brands with distinctive lead tokens (e.g. "Metalix Ferrocast", "Gokul" != "Metalix"):
    // The lead token MUST be present if primaryTokens has >= 2 tokens!
    if (primaryTokens.length >= 2) {
        const leadToken = primaryTokens[0];
        if (leadToken.length >= 3 && !cleanUrl.includes(leadToken) && !cleanContent.includes(leadToken)) {
            return false;
        }
    }

    let hasBrandMention = false;
    if (coreBrandKey.length >= 4 && (cleanUrl.includes(coreBrandKey) || cleanContent.includes(coreBrandKey))) {
        hasBrandMention = true;
    } else {
        for (const t of primaryTokens) {
            if (t.length >= 3 && (cleanUrl.includes(t) || cleanContent.includes(t))) {
                hasBrandMention = true;
                break;
            }
        }
    }

    return hasBrandMention;
}

const KNOWN_BUNDLE_PREFIXES = ['yv5pcb', 'qtfxdj', 'kj4gsf', 'rpztim'];

/**
 * Checks whether an Instagram URL or shortcode originates from Instagram's static compiled JS bundles.
 */
export function isInstagramBundleHash(str: string): boolean {
    if (!str || typeof str !== 'string') return false;
    const l = str.toLowerCase();
    return KNOWN_BUNDLE_PREFIXES.some(p => l.includes(p));
}
