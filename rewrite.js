const fs = require('fs');
let code = fs.readFileSync('src/server.ts', 'utf8');
const start = code.indexOf('app.get("/", (_request, response) => {');
const endStr = '});\n\n// ---------------------------------------------------------------------------';
const end = code.indexOf(endStr, start);
if (start !== -1 && end !== -1) {
  const replacement = `app.get("/", (_request, response) => {\n  response.sendFile(join(staticPath, 'index.html'));\n});\n\n// ---------------------------------------------------------------------------`;
  code = code.substring(0, start) + replacement + code.substring(end + endStr.length);
  fs.writeFileSync('src/server.ts', code);
  console.log('Success');
} else {
  console.log('Failed to find boundaries');
}
