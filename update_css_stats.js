const fs = require('fs');
let css = fs.readFileSync('src/styles/site.css', 'utf8');

css += `
.gx-chart-heading {
  display: flex;
  align-items: center;
  gap: 24px;
}

.gx-chart-stats {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-left: 12px;
}

.gx-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gx-stat small {
  color: var(--gx-muted);
  font-size: 11px;
}

.gx-stat span {
  font-size: 13px;
  font-weight: 500;
}

/* Slider styling */
.gx-order-slider-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}

.gx-order-slider {
  -webkit-appearance: none;
  width: 100%;
  height: 4px;
  background: var(--gx-border);
  outline: none;
  border-radius: 2px;
}

.gx-order-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--gx-accent);
  cursor: pointer;
}

.gx-order-percentages {
  display: flex;
  justify-content: space-between;
}

.gx-order-percentages button {
  background: none;
  border: none;
  color: var(--gx-muted);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}

.gx-order-percentages button:hover {
  color: #fff;
}
`;

fs.writeFileSync('src/styles/site.css', css);
