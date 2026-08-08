const fs = require('fs');

const oldArt = `const GiftArtwork: React.FC<{ className: string; large?: boolean }> = ({ className, large }) => (
  <div className={\`gx-gift-artwork \${className} \${large ? 'is-large' : ''}\`}>
    <div className='gx-gift-box' />
  </div>
);`;

const newArt = `const GiftArtwork: React.FC<{ className: string; large?: boolean; emoji?: string }> = ({ className, large, emoji }) => {
  if (emoji) {
    return (
      <div className={\`gx-gift-artwork \${className} \${large ? 'is-large' : ''}\`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: large ? '64px' : '32px', background: 'rgba(255,255,255,0.05)', borderRadius: '16px' }}>
        <img src={\`https://emojik.vercel.app/s/\${emoji}?size=128\`} alt="emoji" style={{ width: large ? '80px' : '40px', height: large ? '80px' : '40px' }} onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement.innerHTML = emoji; }} />
      </div>
    );
  }
  return (
    <div className={\`gx-gift-artwork \${className} \${large ? 'is-large' : ''}\`}>
      <div className='gx-gift-box' />
    </div>
  );
};`;

['src/screens/Capital/CapitalScreen.tsx', 'src/screens/Portfolio/PortfolioScreen.tsx'].forEach(file => {
  let code = fs.readFileSync(file, 'utf8');
  code = code.replace(oldArt, newArt);
  code = code.replace(/<GiftArtwork className=\{gift\.className\} large \/>/g, `<GiftArtwork className={gift.className} large emoji={gift.emoji} />`);
  code = code.replace(/<GiftArtwork className=\{g\.className\} large \/>/g, `<GiftArtwork className={g.className} large emoji={g.emoji} />`);
  fs.writeFileSync(file, code);
});
console.log("Fixed artworks");
