import axios from 'axios';

async function testCorsProxy() {
  try {
    const res = await axios.get(`https://corsproxy.io/?https://html.duckduckgo.com/html/?q=test`, { timeout: 5000 });
    console.log(res.status);
  } catch (e) {
    console.error(e.message);
  }
}
testCorsProxy();
