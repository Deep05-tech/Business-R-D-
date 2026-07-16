import { DuckDuckGoSearch } from "@langchain/community/tools/duckduckgo_search";

async function run() {
  const tool = new DuckDuckGoSearch({ maxResults: 5 });
  const results = await tool.invoke("manufacturers in Rajkot");
  console.log(results);
}
run().catch(console.error);
