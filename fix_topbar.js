const fs = require('fs');

let tsx = fs.readFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', 'utf8');

const oldTopbarRegex = /<header className='gx-topbar'>[\s\S]*?<\/header>/;

const newTopbar = `<header className='bybit-global-header'>
          <div className='bybit-header-left'>
            <div className='bybit-logo'>
              <svg width="68" height="24" viewBox="0 0 68 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 0h20v24H0V0z" fill="#F7A600"/>
                <path d="M26 4.5h6.2c3 0 4.8 1.4 4.8 3.5 0 1.5-1 2.8-2.6 3.2 2 .4 3.2 1.6 3.2 3.5 0 2.2-2 3.8-5.2 3.8H26V4.5zm4 3.2v3h1.8c1.2 0 1.8-.6 1.8-1.5 0-1-.6-1.5-1.8-1.5H30zm0 5.6v3.2h2c1.4 0 2-.6 2-1.6 0-1-.6-1.6-2-1.6h-2z" fill="#fff"/>
              </svg>
            </div>
            <nav className='bybit-nav'>
              <a href="#">Купить криптовалюту ▾</a>
              <a href="#">Рынки</a>
              <a href="#">Торговать ▾</a>
              <a href="#">TradFi ▾</a>
              <a href="#">Инструменты ▾</a>
              <a href="#">Банкинг ▾</a>
              <a href="#">Информация о деривативах ▾</a>
              <a href="#">Card</a>
              <a href="#">Подробнее ▾</a>
              <a href="#" style={{ color: '#F7A600' }}><i className='material-icons' style={{ fontSize: 14 }}>diamond</i>RWA</a>
            </nav>
          </div>
          <div className='bybit-header-right'>
            <i className='material-icons'>search</i>
            <button className='bybit-deposit-btn'>Внести</button>
            <div className='bybit-avatar'></div>
            <i className='material-icons'>menu</i>
          </div>
        </header>`;

tsx = tsx.replace(oldTopbarRegex, newTopbar);

fs.writeFileSync('src/screens/GXTerminal/GXTerminalScreen.tsx', tsx);

let css = fs.readFileSync('src/styles/site.css', 'utf8');
css += `
.bybit-global-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 60px;
  background: #101014; /* Deep black Bybit header */
  padding: 0 24px;
  border-bottom: 1px solid #1c1c20;
}

.bybit-header-left, .bybit-header-right {
  display: flex;
  align-items: center;
}

.bybit-logo {
  margin-right: 24px;
}

.bybit-nav {
  display: flex;
  gap: 16px;
}

.bybit-nav a {
  color: #B7BDC6;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  display: flex;
  align-items: center;
  gap: 4px;
}

.bybit-nav a:hover {
  color: #fff;
}

.bybit-header-right {
  gap: 20px;
  color: #B7BDC6;
}

.bybit-deposit-btn {
  background: #F7A600;
  color: #101014;
  font-weight: 600;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
}

.bybit-deposit-btn:hover {
  background: #ffb822;
}

.bybit-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #2a2a30;
}
`;

fs.writeFileSync('src/styles/site.css', css);
