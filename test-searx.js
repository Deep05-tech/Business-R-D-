import axios from 'axios';

async function searchSearx(query) {
  try {
    const res = await axios.get(`https://searx.be/search?q=${encodeURIComponent(query)}&format=json`, {
      timeout: 5000
    });
    console.log("Success:", res.data.results.length);
    console.log(res.data.results.slice(0, 2).map(r => r.url));
  } catch (e) {
    console.error(e.message);
  }
}
searchSearx("manufacturers in Rajkot");
