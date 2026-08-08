const fs = require('fs');

let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

// 1. Rewrite submitOrder to accept a side param
const oldSubmit = `const submitOrder = () => {
    const numericAmount = Number(amount);
    const numericPrice = orderType === 'Market' ? 0 : Number(price);

    if (!numericAmount || numericAmount <= 0) {
      setToast('Enter amount greater than 0');
      window.setTimeout(() => setToast(''), 2800);
      return;
    }

    if (orderType === 'Limit' && (!numericPrice || numericPrice <= 0)) {
      setToast('Enter valid price');
      window.setTimeout(() => setToast(''), 2800);
      return;
    }

    if (socketRef.current) {
      socketRef.current.emit('placeOrder', {
        giftName: activeGift.id,
        side,
        type: orderType.toLowerCase(),
        price: numericPrice,
        amount: numericAmount,
      });
      setToast(\`\${side.toUpperCase()} \${orderType} order sent\`);
      window.setTimeout(() => setToast(''), 2800);
      setAmount('');
    }
  };`;

const newSubmit = `const submitOrder = (overrideSide?: 'buy' | 'sell') => {
    const finalSide = overrideSide || side;
    const numericAmount = Number(amount);
    const numericPrice = orderType === 'Market' ? 0 : Number(price);

    if (!numericAmount || numericAmount <= 0) {
      setToast('Enter amount greater than 0');
      window.setTimeout(() => setToast(''), 2800);
      return;
    }

    if (orderType === 'Limit' && (!numericPrice || numericPrice <= 0)) {
      setToast('Enter valid price');
      window.setTimeout(() => setToast(''), 2800);
      return;
    }

    if (socketRef.current) {
      socketRef.current.emit('placeOrder', {
        giftName: activeGift.id,
        side: finalSide,
        type: orderType.toLowerCase(),
        price: numericPrice,
        amount: numericAmount,
      });
      setToast(\`\${finalSide.toUpperCase()} \${orderType} order sent\`);
      window.setTimeout(() => setToast(''), 2800);
      setAmount('');
    }
  };`;

tsx = tsx.replace(oldSubmit, newSubmit);

// 2. Rewrite the buttons at the bottom of the right column
const oldButtonsRegex = /<button\s*type='button'\s*className=\{`gx-submit \$\{side === 'sell' \? 'gx-submit-sell' : ''\}`\}\s*onClick=\{submitOrder\}\s*style=\{\{ height: 48, fontSize: 14 \}\}\s*>\s*\{side === 'buy' \? 'Open Long' : 'Open Short'\}\s*<\/button>/;

const newButtons = `<div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button
                  type='button'
                  className='gx-submit gx-submit-buy'
                  onClick={() => submitOrder('buy')}
                  style={{ height: 48, fontSize: 14, flex: 1 }}
                >
                  Открыть Лонг
                </button>
                <button
                  type='button'
                  className='gx-submit gx-submit-sell'
                  onClick={() => submitOrder('sell')}
                  style={{ height: 48, fontSize: 14, flex: 1 }}
                >
                  Открыть Short
                </button>
              </div>`;

tsx = tsx.replace(oldButtonsRegex, newButtons);

// Make sure the Open / Close tabs and Limit / Market tabs use Cyrillic
tsx = tsx.replace(/>Open<\/button>/, ">Открытые</button>");
tsx = tsx.replace(/>Close<\/button>/, ">Закрытые</button>");

tsx = tsx.replace(/>\s*\{type\}\s*<\/button>/g, "> {type === 'Limit' ? 'Лимитный' : 'Рыночный'} </button>");

// Also inputs:
tsx = tsx.replace(/<span className='gx-input-prefix'>Order Price<\/span>/, "<span className='gx-input-prefix'>Цена следования</span>");
tsx = tsx.replace(/<span className='gx-input-prefix'>Qty<\/span>/, "<span className='gx-input-prefix'>К-во</span>");
tsx = tsx.replace(/<span className='gx-input-suffix'>Gift<\/span>/, "<span className='gx-input-suffix'>BTC</span>"); // From screenshot
tsx = tsx.replace(/<span className='gx-input-suffix'>GX<\/span>/g, "<span className='gx-input-suffix'>USDT</span>");

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);
