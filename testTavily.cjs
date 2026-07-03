const { TavilySearch } = require("@langchain/tavily");
const dotenv = require("dotenv");
dotenv.config();

async function run() {
  const tavily = new TavilySearch({ maxResults: 1 });
  const res = await tavily.invoke({ query: "iraeta" });
  console.log(typeof res, res);
}
run().catch(console.error);
