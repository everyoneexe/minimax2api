const fs = require('fs');
const code = fs.readFileSync('mavis_page.js', 'utf8');
const lines = code.split('\n');

for(let i=25965; i<25975; i++) {
   console.log(i + ": " + lines[i]);
}
