const fs = require('fs');
const code = fs.readFileSync('mavis_page.js', 'utf8');

const targetModuleStart = 25958;
const targetModuleEnd = 26200;

const lines = code.split('\n');

for (let i = targetModuleStart; i < targetModuleEnd; i++) {
   if (lines[i].includes('n(') || lines[i].includes('n.n(')) {
       console.log(i + ": " + lines[i]);
   }
}
