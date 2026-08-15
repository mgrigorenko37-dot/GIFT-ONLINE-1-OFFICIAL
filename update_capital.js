const fs = require('fs');
let code = fs.readFileSync('src/screens/Capital/CapitalScreen.tsx', 'utf8');

code = code.replace(
  "import { gifts, formatGX, type Gift } from '../../data/gifts';",
  "import { formatGX, type Gift } from '../../data/gifts';\nimport { useGifts } from '../../context/GiftsContext';"
);

code = code.replace(
  'const CapitalScreen: React.FC = () => {',
  'const CapitalScreen: React.FC = () => {\n  const { gifts, loading } = useGifts();'
);

fs.writeFileSync('src/screens/Capital/CapitalScreen.tsx', code);
