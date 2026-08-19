const fs = require('fs');
let code = fs.readFileSync('src/screens/Capital/CapitalScreen.tsx', 'utf8');

const newArtwork = `const GiftArtwork: React.FC<{ className: string; large?: boolean; emoji?: string; image_url?: string }> = ({
  className,
  large,
  emoji,
  image_url,
}) => {
  if (image_url) {
    return (
      <div
        className={\`gift-art \${className} \${large ? 'gift-art-large' : ''}\`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: large ? '48px' : '24px',
          background: 'transparent'
        }}
      >
        <img
          src={image_url}
          alt='gift'
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
        />
      </div>
    );
  }
  if (emoji) {`;

code = code.replace(/const GiftArtwork: React\.FC<\{ className: string; large\?: boolean; emoji\?: string \}> = \(\{\n  className,\n  large,\n  emoji,\n\}\) => \{\n  if \(emoji\) \{/g, newArtwork);
fs.writeFileSync('src/screens/Capital/CapitalScreen.tsx', code, 'utf8');
