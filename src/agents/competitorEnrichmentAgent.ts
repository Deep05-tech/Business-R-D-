import axios from "axios";
import * as cheerio from "cheerio";
import { createLogger } from "../utils/logger.js";
import type { CompetitorProfile } from "../types.js";

const logger = createLogger("CompetitorEnrichmentAgent");

export class CompetitorEnrichmentAgent {
  async enrichCompetitor(comp: CompetitorProfile): Promise<CompetitorProfile | null> {
    const socials: CompetitorProfile["socials"] = { linkedin: null, instagram: null, facebook: null, youtube: null };
    
    try {
      logger.debug(`Scraping ${comp.url}...`);
      let res = await axios.get(comp.url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } });
      let $ = cheerio.load(res.data);
      
      // Handle simple JS redirects (e.g., Amtek Auto returning <script>window.location.href="/lander"</script>)
      if ($('a[href]').length === 0) {
        const match = res.data.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]/i);
        if (match && match[1]) {
          const redirectUrl = new URL(match[1], comp.url).toString();
          logger.debug(`Following JS redirect to ${redirectUrl}...`);
          res = await axios.get(redirectUrl, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' } });
          $ = cheerio.load(res.data);
        }
      }
      
      let verifiedProductLinks: Array<{title: string, url: string}> = [];

      $('a[href]').each((_, el) => {
        let rawHref = $(el).attr('href') || "";
        let text = $(el).text().trim().replace(/\s+/g, ' ');
        if (!rawHref || rawHref.startsWith('javascript') || rawHref.startsWith('tel:') || rawHref.startsWith('mailto:') || rawHref === '#') return;
        
        let href = rawHref;
        try {
          if (!href.startsWith('http')) {
            href = new URL(href, comp.url).toString();
          }
        } catch { return; }
        
        const hrefLower = href.toLowerCase();
        
        if (hrefLower.includes('linkedin.com/')) socials.linkedin = hrefLower;
        if (hrefLower.includes('instagram.com/') && !hrefLower.includes('/explore/')) socials.instagram = hrefLower;
        if (hrefLower.includes('facebook.com/') && !hrefLower.includes('sharer')) socials.facebook = hrefLower;
        if (hrefLower.includes('youtube.com/') && !hrefLower.includes('/watch')) socials.youtube = hrefLower;

        // Auto-extract real, verified product pages directly from the competitor's DOM
        let linkHostname = "";
        try { linkHostname = new URL(href).hostname.replace(/^www\./, ''); } catch { }
        let compHostname = "";
        try { compHostname = new URL(comp.url).hostname.replace(/^www\./, ''); } catch { }
        
        const linkRoot = linkHostname.split('.')[0];
        const compRoot = compHostname.split('.')[0];

        if (text.length > 3 && text.length < 70 && linkRoot === compRoot && linkRoot !== "" && linkRoot !== undefined) {
          const textLower = text.toLowerCase();
          
          let urlPathname = "";
          try { urlPathname = new URL(href).pathname.toLowerCase(); } 
          catch { urlPathname = hrefLower; }
          
          const isRejected = /(blog|news|article|press|event|career|job|about|contact|privacy|terms|login|register|media|investor|\.pdf|\.jpg|\.png)/i.test(urlPathname) || 
                             /^(home|about us|contact us|read more|learn more|click here|view all|more|login|sign in|previous|next)$/i.test(textLower) ||
                             hrefLower.includes('#');
          
          if (!isRejected && urlPathname.length > 1) {
             // Broad collection: If it's internal and not rejected, it's a candidate
             if (!verifiedProductLinks.some(l => l.url === href || l.title.toLowerCase() === textLower)) {
                 verifiedProductLinks.push({ title: text, url: href });
             }
          }
        }
      });
      
      // Pass up to 30 verified links to the QC LLM to let it intelligently select the best 5 product pages
      if (verifiedProductLinks.length > 0) {
        comp.evidenceUrls = verifiedProductLinks.slice(0, 30);
      } else {
        comp.evidenceUrls = [{ title: "Homepage", url: comp.url }];
      }
    } catch (err: any) {
      logger.warn(`Website ${comp.url} could not be reached or returned an error: ${err.message}. Strictly discarding competitor as requested.`);
      return null;
    }

    if (!socials.instagram && !socials.youtube && !socials.linkedin && !socials.facebook) {
      logger.warn(`Website ${comp.url} has NO social media links in its DOM/footer. Strictly discarding competitor as requested.`);
      return null;
    }

    comp.socials = socials;
    if (!comp.evidenceUrls || comp.evidenceUrls.length === 0) {
      comp.evidenceUrls = [{ title: "Homepage", url: comp.url }];
    }

    return comp;
  }
}
