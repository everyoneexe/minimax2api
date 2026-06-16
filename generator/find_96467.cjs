const fs = require('fs');
const code = fs.readFileSync('mavis_page.js', 'utf8');

const match = code.match(/96467\s*:\s*(?:function|e\s*=>)/);
if(match) {
    console.log("Found 96467 with regex: " + match[0]);
}

// Let's just find "96467" and the few characters after it
let parts = code.split('96467');
for(let i=1; i<parts.length; i++) {
    console.log("Match " + i + ": " + parts[i].substring(0, 50));
}

