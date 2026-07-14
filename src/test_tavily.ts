import { TavilySearch } from "@langchain/tavily";
import dotenv from "dotenv";

dotenv.config();

async function runTest() {
  const searchTool = new TavilySearch({ maxResults: 5 });
  const queries = [
    "manufacturers in Rajkot agricultural inputs seeds",
    "seed suppliers in Rajkot Gujarat",
    "Rajkot seed companies IndiaMart",
  ];

  for (const query of queries) {
    console.log(`\n\n--- Query: ${query} ---`);
    try {
      const resultRaw = await searchTool.invoke({ query });
      const parsed = typeof resultRaw === "string" ? JSON.parse(resultRaw) : resultRaw;
      for (const item of parsed) {
        console.log(`Title: ${item.title}`);
        console.log(`URL: ${item.url}`);
        console.log(`Content: ${item.content.substring(0, 100)}...`);
      }
    } catch (e: any) {
      console.error(e.message);
    }
  }
}

runTest();
