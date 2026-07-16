import google from 'googlethis';

async function run() {
  const options = {
    page: 0, 
    safe: false, // Safe Search
    parse_ads: false, // If set to true sponsored results will be parsed
    additional_params: {
      hl: 'en' 
    }
  }
  
  const response = await google.search('manufacturers in Rajkot', options);
  console.log(response.results);
}
run().catch(console.error);
