const fs = require('fs');
const { execSync } = require('child_process');
const Tesseract = require('tesseract.js');

async function testOCR() {
  const pdfPath = '/home/uday/Downloads/2026-06-25.pdf'; // Check if this path exists!
  const tmpImgPrefix = '/tmp/brochure_test';
  
  try {
    execSync(`pdftoppm -jpeg "${pdfPath}" ${tmpImgPrefix}`);
    const files = fs.readdirSync('/tmp').filter(f => f.startsWith('brochure_test-') && f.endsWith('.jpg')).sort();
    
    console.log(`Found ${files.length} images.`);
    if (files.length > 0) {
      console.log("Running Tesseract on page 1...");
      const { data: { text } } = await Tesseract.recognize(`/tmp/${files[0]}`, 'eng');
      console.log("--- TESSERACT OUTPUT ---");
      console.log(text);
    }
  } catch (e) {
    console.error(e);
  }
}
testOCR();
