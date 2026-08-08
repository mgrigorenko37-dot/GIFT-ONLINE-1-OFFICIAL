const fs = require('fs');
let css = fs.readFileSync('src/styles/site.css', 'utf8');

css = css.replace(/\/\* Hide old columns \*\/[\s\S]*?display: none !important;\s*\}/g, '');
css = css.replace(/\.gx-sidebar\s*\{\s*display: none !important;\s*\}/g, '');

fs.writeFileSync('src/styles/site.css', css);

let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// The layout section was changed from gx-terminal gx-terminal-grid to just layout
tsx = tsx.replace(/<section className='layout'>/, "<section className='gx-terminal gx-terminal-grid'>");
tsx = tsx.replace(/<div className='col' style=\{\{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' \}\}>/, "<div className='gx-left-column' style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>");

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
