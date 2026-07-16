const https = require('https');

const options = {
  hostname: 'html.duckduckgo.com',
  path: '/html/',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
};

const req = https.request(options, (res) => {
  console.log('statusCode:', res.statusCode);
  res.on('data', (d) => {
    // console.log(d.toString().substring(0, 50));
  });
});

req.on('error', (e) => {
  console.error(e);
});

req.write('q=manufacturers+in+Rajkot');
req.end();
