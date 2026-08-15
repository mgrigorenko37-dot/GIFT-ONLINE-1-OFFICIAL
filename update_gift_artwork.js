const fs = require('fs');
let code = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const artworkOld = `function GiftArtwork({ className, small }: { className: string; small?: boolean }) {
  return (
    <div className={\`gx-gift-artwork \${className} \${small ? 'is-small' : ''}\`}>
      <div className='gx-gift-box' />
    </div>
  );
}`;

const artworkNew = `function GiftArtwork({ className, small, emoji }: { className: string; small?: boolean; emoji?: string }) {
  if (emoji) {
    return (
      <div className={\`gx-gift-artwork \${className} \${small ? 'is-small' : ''}\`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: small ? '24px' : '48px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
        <img src={\`https://emojik.vercel.app/s/\${emoji}\`} alt="emoji" style={{ width: small ? '24px' : '48px', height: small ? '24px' : '48px' }} onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.parentElement!.innerHTML = emoji; }} />
      </div>
    );
  }
  return (
    <div className={\`gx-gift-artwork \${className} \${small ? 'is-small' : ''}\`}>
      <div className='gx-gift-box' />
    </div>
  );
}`;

code = code.replace(artworkOld, artworkNew);

// Also need to pass emoji to GiftArtwork
code = code.replace(
  /<GiftArtwork className=\{activeGift\?\.className \|\| ''\} \/>/,
  `<GiftArtwork className={activeGift?.className || ''} emoji={activeGift?.emoji} />`
);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', code);
console.log('Updated GiftArtwork');
