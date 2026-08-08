const fs = require('fs');
let css = fs.readFileSync('src/styles/site.css', 'utf8');

css += `
.gx-submit-buy {
  color: #fff !important;
  background: #2ebd85 !important;
}

.gx-submit-sell {
  color: #fff !important;
  background: #f6465d !important;
}

/* Tab Active State - Yellow/Orange */
.gx-order-tabs button.is-buy, 
.gx-order-tabs button.is-sell {
  color: #fff !important;
  border-bottom-color: #f7a600 !important;
}
`;

fs.writeFileSync('src/styles/site.css', css);
