import axios from "axios";
import { createLogger } from "./logger.js";

const logger = createLogger("PlacesAPI");

export interface GooglePlace {
  id: string;
  displayName?: { text: string };
  websiteUri?: string;
  formattedAddress?: string;
  primaryType?: string;
  nationalPhoneNumber?: string;
  rating?: number;
}

export interface PlacesSearchResponse {
  places: GooglePlace[];
  nextPageToken?: string;
}

export class PlacesApi {
  private apiKey: string;

  constructor() {
    // Fallback to GOOGLE_API_KEY if GOOGLE_PLACES_API_KEY is not explicitly set
    this.apiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY || "";
    if (!this.apiKey) {
      logger.warn("No Google API Key found in environment variables (GOOGLE_PLACES_API_KEY or GOOGLE_API_KEY). Places API will fail.");
    }
  }

  async searchPlaces(query: string, pageToken?: string, retries = 2): Promise<PlacesSearchResponse> {
    if (!this.apiKey) throw new Error("Missing Google API Key");

    const url = "https://places.googleapis.com/v1/places:searchText";
    
    const payload: any = {
      textQuery: query,
      pageSize: 20,
    };
    if (pageToken) {
      payload.pageToken = pageToken;
    }

    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": this.apiKey,
      // Request exactly the fields we need to avoid massive billing and extra calls
      "X-Goog-FieldMask": "places.id,places.displayName,places.websiteUri,places.formattedAddress,places.primaryType,places.nationalPhoneNumber,places.rating,nextPageToken"
    };

    try {
      logger.debug(`Fetching Google Places for query: "${query}" (PageToken: ${!!pageToken})`);
      const response = await axios.post<PlacesSearchResponse>(url, payload, { headers, timeout: 15000 });
      return response.data;
    } catch (error: any) {
      if (retries > 0) {
        logger.warn(`Google Places API failed (${error.message}). Retrying... (${retries} left)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.searchPlaces(query, pageToken, retries - 1);
      }
      logger.error(`Google Places API completely failed: ${error?.response?.data?.error?.message || error.message}`);
      throw error;
    }
  }

  async fetchAllCompetitors(industry: string, location: string, maxPages = 3): Promise<GooglePlace[]> {
    const allPlaces: GooglePlace[] = [];
    let pageToken: string | undefined = undefined;
    let pagesFetched = 0;

    // Use a precise query tailored for manufacturers / businesses
    const query = `${industry} in ${location}`;

    try {
      while (pagesFetched < maxPages) {
        const response = await this.searchPlaces(query, pageToken);
        if (response.places && response.places.length > 0) {
          allPlaces.push(...response.places);
        }

        pageToken = response.nextPageToken;
        pagesFetched++;

        if (!pageToken) {
          break; // No more pages
        }

        // Add a small delay between pagination requests to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (e: any) {
      logger.error(`Error during fetchAllCompetitors: ${e.message}`);
    }

    return allPlaces;
  }
}
