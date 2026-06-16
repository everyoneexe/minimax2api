const fs = require('fs');
const code = fs.readFileSync('mavis_page.js', 'utf8');

// The file looks like a webpack bundle.
// The modules might be defined like: "96467": function(...) or 96467: (e, t, n) => { ... }
// Let's list all module IDs in the file.
const regex = /\b(\d+)\s*:\s*(?:function\s*\([^)]*\)|[a-zA-Z0-9_]+\s*=>)\s*\{/g;
let match;
let count = 0;
while((match = regex.exec(code)) !== null) {
    if (match[1] === '96467') {
        console.log("Found 96467: " + match[0]);
    }
    count++;
}
console.log("Total modules found: " + count);

// If not found, let's search for "96467:" or something similar.
let m = code.match(/['"]?96467['"]?\s*:/);
if(m) {
    console.log("Found string match: " + m[0]);
}

