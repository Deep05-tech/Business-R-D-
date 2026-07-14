import * as https from 'https';
import * as cheerio from 'cheerio';
import { createLogger } from './logger.js';

const logger = createLogger('FreeSearchEngine');

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export class FreeSearchEngine {
  private maxResults: number;

  constructor(config: { maxResults?: number } = {}) {
    this.maxResults = config.maxResults || 5;
  }

  async invoke({ query }: { query: string }, retries = 3): Promise<string> {
    logger.info(`Searching free DDG HTML engine for: ${query}`);
    
    // Base delay to prevent rapid-fire blocks during loops
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 2000));
    
    try {
      const htmlData = await this.httpsPost('html.duckduckgo.com', '/html/', `q=${encodeURIComponent(query)}`);
      const $ = cheerio.load(htmlData);
      const results: SearchResult[] = [];
      
      $('.result__body').each((i, el) => {
        if (results.length >= this.maxResults) return;
        
        const title = $(el).find('.result__title a').text().trim();
        const rawUrl = $(el).find('.result__url').attr('href') || $(el).find('.result__snippet').attr('href') || '';
        const snippet = $(el).find('.result__snippet').text().trim();
        const visibleUrl = $(el).find('.result__url').text().trim();
        
        let finalUrl = visibleUrl || rawUrl;
        if (finalUrl && finalUrl.startsWith('//')) {
            finalUrl = 'https:' + finalUrl;
        } else if (finalUrl && !finalUrl.startsWith('http')) {
            finalUrl = 'https://' + finalUrl;
        }
        
        if (title && snippet && finalUrl) {
          results.push({ title, url: finalUrl, content: snippet });
        }
      });
      
      return JSON.stringify(results);
    } catch (e: any) {
      if (e.message.includes('403') && retries > 0) {
        logger.warn(`Rate limit hit (403). Waiting ${6 - retries} seconds before retrying...`);
        await new Promise(resolve => setTimeout(resolve, (4 - retries) * 5000));
        return this.invoke({ query }, retries - 1);
      }
      logger.error(`Free search failed: ${e.message}`);
      return JSON.stringify([]);
    }
  }

  private httpsPost(hostname: string, path: string, body: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Content-Length': Buffer.byteLength(body)
        }
      };

      const req = https.request(options, (res) => {
        if (res.statusCode === 403) {
           return reject(new Error('403 Forbidden - TLS/IP Blocked'));
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });

      req.on('error', e => reject(e));
      req.write(body);
      req.end();
    });
  }
}
