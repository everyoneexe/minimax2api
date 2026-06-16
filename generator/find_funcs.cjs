const fs = require('fs');

const code = fs.readFileSync('mavis_page.js', 'utf8');
const functionRegex = /function\s+([a-zA-Z0-9_]+)?\s*\([^)]*\)\s*\{/g;
let match;
let functions = [];

while ((match = functionRegex.exec(code)) !== null) {
  let funcName = match[1] || 'anonymous';
  // Let's find the closing brace.
  let startIndex = match.index;
  let openBraces = 0;
  let inString = false;
  let stringChar = '';
  let inComment = false;
  let inBlockComment = false;
  let i = startIndex;

  while(code[i] !== '{' && i < code.length) i++;
  
  if (i < code.length) {
      openBraces = 1;
      i++;
      let endIndex = -1;
      for (; i < code.length; i++) {
        const char = code[i];
        
        if (inComment) {
            if (char === '\n') inComment = false;
            continue;
        }
        if (inBlockComment) {
            if (char === '*' && code[i+1] === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }
        if (inString) {
            if (char === '\\') { i++; continue; }
            if (char === stringChar) inString = false;
            continue;
        }
        
        if (char === '"' || char === "'" || char === '`') {
            inString = true;
            stringChar = char;
            continue;
        }
        if (char === '/' && code[i+1] === '/') {
            inComment = true;
            i++;
            continue;
        }
        if (char === '/' && code[i+1] === '*') {
            inBlockComment = true;
            i++;
            continue;
        }

        if (char === '{') openBraces++;
        if (char === '}') {
            openBraces--;
            if (openBraces === 0) {
                endIndex = i;
                break;
            }
        }
      }
      
      if (endIndex !== -1) {
          functions.push(code.substring(startIndex, endIndex + 1));
      }
  }
}

fs.writeFileSync('extracted_functions.js', functions.join('\n\n'), 'utf8');
console.log('Extracted ' + functions.length + ' functions to extracted_functions.js');
