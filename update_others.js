const fs = require('fs');

const updateFile = (path, replaceGiftsImport, hookAddition) => {
  if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // Replace import
    code = code.replace(
      /import\s+\{([^}]*?)gifts([^}]*?)\}\s+from\s+['"]\.\.\/\.\.\/data\/gifts['"];/g,
      (match, p1, p2) => {
        let newImport = `import {${p1}${p2}} from '../../data/gifts';\nimport { useGifts } from '../../context/GiftsContext';`;
        newImport = newImport
          .replace(/,\s*,/g, ',')
          .replace(/\{\s*,/g, '{')
          .replace(/,\s*\}/g, '}');
        return newImport;
      }
    );

    // Add hook
    code = code.replace(
      /const ([A-Za-z0-9_]+Screen): React.FC = \(\) => \{/,
      'const $1: React.FC = () => {\n  const { gifts, loading } = useGifts();'
    );

    // If it doesn't have React.FC typing in the declaration (like GXTerminalScreen):
    code = code.replace(
      /export default function ([A-Za-z0-9_]+Screen)\(\) \{/,
      'export default function $1() {\n  const { gifts, loading } = useGifts();'
    );
    code = code.replace(
      /const ([A-Za-z0-9_]+Screen) = \(\) => \{/,
      'const $1 = () => {\n  const { gifts, loading } = useGifts();'
    );

    fs.writeFileSync(path, code);
  }
};

updateFile('src/screens/Transactions/TransactionsScreen.tsx');
updateFile('src/screens/GXTerminal/GXTerminalScreen.tsx');
updateFile('src/screens/Portfolio/PortfolioScreen.tsx');
